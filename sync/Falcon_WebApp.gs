/**
 * ═══════════════════════════════════════════════════════════════════
 * FALCON SQUAD · WEB APP — a planilha vira uma API de leitura
 * ═══════════════════════════════════════════════════════════════════
 *
 * Publica os dados da DRE_FALCON (e do NPS, lido da planilha de
 * clientes por ID) numa URL que devolve JSON. O dashboard busca essa
 * URL direto — sem Supabase no meio, sem token, sem gatilhos.
 *
 * Este arquivo vai no MESMO projeto Apps Script da DRE_FALCON, ao lado
 * de DRE_Falcon_Sync.gs: ele reaproveita lerDRE(), lerPessoas() e
 * lerFaturamento() de lá.
 *
 * ─── INSTALAÇÃO ────────────────────────────────────────────────────
 *  1. DRE_FALCON → Extensões → Apps Script
 *  2. Já tendo DRE_Falcon_Sync.gs no projeto, adicione um arquivo novo
 *     (+ → Script) e cole este conteúdo
 *  3. Rode `testarWebApp` uma vez — o Google vai pedir autorização e o
 *     log mostra o resumo do que seria publicado
 *  4. Implantar → Nova implantação → tipo **App da Web**
 *       Executar como:  Eu
 *       Quem pode acessar:  Qualquer pessoa
 *  5. Copie a URL (termina em /exec) e cole em SHEETS_API, no topo do
 *     bloco <script> do index.html
 *
 * "Executar como: Eu" é o que faz isto funcionar sem ninguém logar no
 * Google: o script lê as planilhas com a SUA permissão. Em troca, quem
 * tiver a URL vê os dados — inclusive os salários. Trate a URL como
 * confidencial; para revogar, é só criar uma implantação nova.
 *
 * Ao editar a planilha, o JSON sai atualizado na hora. O botão
 * "Atualizar" do dashboard só refaz esta chamada.
 * ═══════════════════════════════════════════════════════════════════
 */

/** Planilha de clientes, onde fica a aba de NPS. */
var ID_PLANILHA_NPS = '142eHl3Y6YGfMYykGbjgGvxWCWArRFzGHA9bviPEb5Nc';

/** Segundos que a resposta fica em cache no Apps Script. Evita reler a
 *  planilha inteira a cada visita; o botão Atualizar ignora o cache. */
var CACHE_SEG = 120;

// ─── Endpoint ──────────────────────────────────────────────────────

function doGet(e) {
  var semCache = e && e.parameter && e.parameter.forcar === '1';
  var cache = CacheService.getScriptCache();

  if (!semCache) {
    var guardado = cache.get('falcon_json');
    if (guardado) return _json(guardado);
  }

  var corpo;
  try {
    corpo = JSON.stringify(montarPayload());
  } catch (err) {
    return _json(JSON.stringify({ erro: String(err && err.message || err) }));
  }

  // O cache do Apps Script aceita até 100 KB por chave.
  if (corpo.length < 100000) cache.put('falcon_json', corpo, CACHE_SEG);
  return _json(corpo);
}

function _json(texto) {
  return ContentService.createTextOutput(texto)
    .setMimeType(ContentService.MimeType.JSON);
}

function montarPayload() {
  return {
    atualizadoEm: new Date().toISOString(),
    dre:          lerDRE(),          // de DRE_Falcon_Sync.gs
    pessoas:      lerPessoas(),      // idem
    faturamento:  lerFaturamento(),  // idem
    nps:          lerNPSDaOutraPlanilha(),
    parametros:   lerParametros()
  };
}

// ─── Ponto de equilíbrio (bloco PEQUILIBRIO da DRE) ────────────────

/**
 * A planilha tem dois blocos:
 *   PEQUILIBRIO              → faturamento em que a margem zera
 *   PEQUILIBRIO FOLHA X FAT  → faturamento que põe a folha na meta
 * Em cada um, a linha FATURAMENTO logo abaixo carrega o valor.
 * As abas são varridas em ordem e a última vence, então o bloco da aba
 * mais recente é o que prevalece.
 */
function lerParametros() {
  var achados = {};

  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (aba) {
    var g = aba.getDataRange().getDisplayValues();
    for (var r = 0; r < g.length; r++) {
      for (var c = 0; c < g[r].length; c++) {
        var t = _norm(g[r][c]);
        if (t.indexOf('PEQUILIBRIO') !== 0) continue;
        var chave = t.indexOf('FOLHA') >= 0 ? 'breakeven_folha' : 'breakeven_faturamento';

        for (var r2 = r + 1; r2 < Math.min(r + 10, g.length); r2++) {
          if (_norm(g[r2][c]) !== 'FATURAMENTO') continue;
          var v = _num(g[r2][c + 1]);
          if (v !== null && v > 0) achados[chave] = v;
          break;
        }
      }
    }
  });

  var saida = [
    { chave: 'meta_folha_pct',  valor: 27,    rotulo: 'Meta de % folha' },
    { chave: 'meta_fat_cabeca', valor: 19000, rotulo: 'Meta de faturamento por cabeça' },
    { chave: 'meta_nps',        valor: 70,    rotulo: 'Meta de NPS' },
    { chave: 'meta_csat',       valor: 4,     rotulo: 'Meta de CSAT (1–5)' }
  ];
  if (achados.breakeven_faturamento) {
    saida.push({ chave: 'breakeven_faturamento', valor: achados.breakeven_faturamento,
                 rotulo: 'Faturamento para margem zero' });
  }
  if (achados.breakeven_folha) {
    saida.push({ chave: 'breakeven_folha', valor: achados.breakeven_folha,
                 rotulo: 'Faturamento para folha na meta' });
  }
  return saida;
}

// ─── NPS, lido da planilha de clientes ─────────────────────────────

var _MES_EXT_WA = {
  JANEIRO:1, FEVEREIRO:2, 'MARÇO':3, MARCO:3, ABRIL:4, MAIO:5, JUNHO:6,
  JULHO:7, AGOSTO:8, SETEMBRO:9, OUTUBRO:10, NOVEMBRO:11, DEZEMBRO:12
};
var _SIGLA_WA = ['','JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
var _BLOCO_WA = ['status','nps','csat','atendimento','campanhas','copy',
                 'design','prazos','resultados','comentario'];

function lerNPSDaOutraPlanilha() {
  var ss;
  try {
    ss = SpreadsheetApp.openById(ID_PLANILHA_NPS);
  } catch (err) {
    Logger.log('NPS: não consegui abrir a planilha (%s)', err);
    return [];
  }

  // Aba com cabeçalho STATUS + NPS + CSAT
  var g = null, rCab = -1;
  var abas = ss.getSheets();
  for (var i = 0; i < abas.length && rCab < 0; i++) {
    var grade = abas[i].getDataRange().getDisplayValues();
    for (var r = 0; r < Math.min(grade.length, 12); r++) {
      var l = grade[r].map(_norm);
      if (l.indexOf('NPS') >= 0 && l.indexOf('CSAT') >= 0 && l.indexOf('STATUS') >= 0) {
        g = grade; rCab = r; break;
      }
    }
  }
  if (rCab < 0) { Logger.log('NPS: cabeçalho STATUS/NPS/CSAT não encontrado.'); return []; }

  var cCliente = -1, cSquad = -1;
  for (var c = 0; c < g[rCab].length; c++) {
    var t = _norm(g[rCab][c]);
    if (t === 'CLIENTE' && cCliente < 0) cCliente = c;
    if (t === 'SQUAD'   && cSquad   < 0) cSquad   = c;
  }
  if (cCliente < 0) { Logger.log('NPS: coluna CLIENTE não encontrada.'); return []; }

  // Cada mês é um bloco de 10 colunas começando no STATUS daquele mês
  var blocos = {};
  for (var r2 = 0; r2 < rCab; r2++) {
    for (var c2 = 0; c2 < g[r2].length; c2++) {
      var ord = _MES_EXT_WA[_norm(g[r2][c2]).replace(/[^A-ZÇÃÁÉÍÓÚ]/g, '')];
      if (ord && _norm(g[rCab][c2]) === 'STATUS') blocos[ord] = c2;
    }
  }
  if (!Object.keys(blocos).length) { Logger.log('NPS: nenhum bloco de mês.'); return []; }

  var ano = new Date().getFullYear(), itens = [];
  for (var r3 = rCab + 1; r3 < g.length; r3++) {
    var cliente = String(g[r3][cCliente] || '').trim();
    if (!cliente) continue;
    if (cSquad >= 0 && _norm(g[r3][cSquad]) !== 'FALCON') continue;

    Object.keys(blocos).forEach(function (ord) {
      var base = blocos[ord], temAlgo = false;
      var reg = { cliente: cliente, mes_label: _SIGLA_WA[ord],
                  mes_order: Number(ord), ano: ano };

      _BLOCO_WA.forEach(function (campo, k) {
        var bruto = g[r3][base + k];
        if (bruto === undefined || String(bruto).trim() === '') return;
        var s = String(bruto).trim();
        if (s === '-' || s === '\\-') return;
        temAlgo = true;
        if (campo === 'status')          reg.status = s.toLowerCase();
        else if (campo === 'comentario') reg.comentario = s;
        else if (campo === 'csat')       reg.csat = _num(s);
        else {
          var n = _num(s);
          reg[campo] = (n === null) ? null : Math.round(n);
        }
      });

      if (temAlgo) itens.push(reg);
    });
  }
  return itens;
}

// ─── Diagnóstico ───────────────────────────────────────────────────

/** Monta o payload e escreve um resumo no log, sem publicar nada. */
function testarWebApp() {
  var d = montarPayload();
  Logger.log('DRE .......... %s meses', d.dre.length);
  d.dre.forEach(function (m) {
    Logger.log('   %s  fat=%s  margem=%s  folha=%s%%',
      m.month_label, m.faturamento, m.margem_valor, m.percentual_folha);
  });

  var folha = 0;
  d.pessoas.forEach(function (p) { folha += p.salario; });
  Logger.log('Pessoas ...... %s · folha R$ %s', d.pessoas.length, folha);

  var meses = {};
  d.faturamento.forEach(function (f) {
    meses[f.mes_label] = (meses[f.mes_label] || 0) + f.valor;
  });
  Logger.log('Faturamento .. %s lançamentos', d.faturamento.length);
  Object.keys(meses).forEach(function (m) {
    Logger.log('   %s: R$ %s', m, meses[m].toFixed(2));
  });

  var resp = d.nps.filter(function (n) { return n.status === 'respondida'; });
  Logger.log('NPS .......... %s registros · %s respondidas', d.nps.length, resp.length);

  Logger.log('Parâmetros ...');
  d.parametros.forEach(function (p) { Logger.log('   %s = %s', p.chave, p.valor); });

  var tamanho = JSON.stringify(d).length;
  Logger.log('\nJSON: %s KB%s', (tamanho / 1024).toFixed(1),
    tamanho >= 100000 ? ' (acima de 100 KB — o cache será ignorado)' : '');
  return d;
}
