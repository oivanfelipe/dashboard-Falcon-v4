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

/** Planilha onde fica a aba de oportunidades. */
var ID_PLANILHA_OPORTUNIDADES = '1QTksU0kN_jOkSovEVr6OfAtHu-kkCDYGz4p6_o_LNIw';

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
  var metas = lerMetas();
  var parametros = lerParametros().concat(
    Object.keys(metas.resumo).map(function (k) {
      return { chave: k, valor: metas.resumo[k], rotulo: 'Metas · ' + k };
    })
  );
  return {
    atualizadoEm:  new Date().toISOString(),
    dre:           lerDRE(),          // de DRE_Falcon_Sync.gs
    pessoas:       lerPessoas(),      // idem
    faturamento:   lerFaturamento(),  // idem
    nps:           lerNPSDaOutraPlanilha(),
    oportunidades: lerOportunidades(),
    metas:         metas.itens,
    parametros:    parametros
  };
}

// ─── Oportunidades, lidas da planilha de account planning ──────────

/** Estágios que a tabela do dashboard reconhece. */
var _ESTAGIOS = ['Identificada','Proposta','Validada','Ganha','Perdida'];

/**
 * A aba tem um cabeçalho nomeado (Cliente, Squad, Oportunidade, Estágio,
 * Valor Proposta Prevista, Valor Fechamento, Mês Ass. Previsto…).
 * As colunas são localizadas pelo nome, então reordenar a planilha não
 * quebra a leitura. Só as linhas com Squad = FALCON entram.
 */
function lerOportunidades() {
  var ss;
  try {
    ss = SpreadsheetApp.openById(ID_PLANILHA_OPORTUNIDADES);
  } catch (err) {
    Logger.log('Oportunidades: não consegui abrir a planilha (%s)', err);
    return [];
  }

  var COLUNAS = {
    cliente:          ['CLIENTE'],
    squad:            ['SQUAD'],
    oportunidade:     ['OPORTUNIDADE'],
    produto:          ['PRODUTO V4','PRODUTO'],
    estagio:          ['ESTÁGIO','ESTAGIO'],
    valor_proposta:   ['VALOR PROPOSTA PREVISTA','VALOR PROPOSTA'],
    valor_fechamento: ['VALOR FECHAMENTO'],
    data_prevista:    ['MÊS ASS. PREVISTO','MES ASS. PREVISTO','MÊS PREVISTO'],
    responsavel:      ['RESPONSÁVEL','RESPONSAVEL'],
    proximo_passo:    ['PRÓXIMO PASSO','PROXIMO PASSO'],
    observacoes:      ['OBSERVAÇÕES','OBSERVACOES']
  };

  // Aba cujo cabeçalho tem Cliente + Oportunidade + Estágio
  var g = null, rCab = -1, col = {};
  var abas = ss.getSheets();
  for (var i = 0; i < abas.length && rCab < 0; i++) {
    var grade = abas[i].getDataRange().getDisplayValues();
    for (var r = 0; r < Math.min(grade.length, 12); r++) {
      var mapa = {}, achou = 0;
      for (var c = 0; c < grade[r].length; c++) {
        var t = _norm(grade[r][c]);
        for (var campo in COLUNAS) {
          if (mapa[campo] !== undefined) continue;
          if (COLUNAS[campo].indexOf(t) >= 0) { mapa[campo] = c; achou++; }
        }
      }
      if (mapa.cliente !== undefined && mapa.oportunidade !== undefined &&
          mapa.estagio !== undefined) {
        g = grade; rCab = r; col = mapa; break;
      }
    }
  }
  if (rCab < 0) { Logger.log('Oportunidades: cabeçalho não encontrado.'); return []; }

  var pega = function (linha, campo) {
    return col[campo] === undefined ? '' : String(linha[col[campo]] || '').trim();
  };

  var itens = [];
  for (var r2 = rCab + 1; r2 < g.length; r2++) {
    var linha = g[r2];
    var cliente = pega(linha, 'cliente');
    if (!cliente) continue;
    if (col.squad !== undefined && _norm(linha[col.squad]) !== 'FALCON') continue;

    // Normaliza o estágio para um dos valores conhecidos
    var estBruto = _norm(pega(linha, 'estagio')), estagio = null;
    for (var k = 0; k < _ESTAGIOS.length; k++) {
      if (_norm(_ESTAGIOS[k]) === estBruto) { estagio = _ESTAGIOS[k]; break; }
    }
    if (!estagio) continue;   // linha em branco ou estágio fora do padrão

    itens.push({
      cliente:          cliente,
      oportunidade:     pega(linha, 'oportunidade') || null,
      produto:          pega(linha, 'produto') || null,
      estagio:          estagio,
      valor_proposta:   _num(pega(linha, 'valor_proposta')),
      valor_fechamento: _num(pega(linha, 'valor_fechamento')),
      responsavel:      pega(linha, 'responsavel') || null,
      proximo_passo:    pega(linha, 'proximo_passo') || null,
      data_prevista:    pega(linha, 'data_prevista') || null,
      observacoes:      pega(linha, 'observacoes') || null
    });
  }
  return itens;
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

// ─── Metas, lidas da mesma planilha do NPS ──────────────────────────

/**
 * A aba de Metas tem um cabeçalho "PESO | META" seguido de uma coluna
 * por semana (datas dd/mm/aaaa). O indicador fica na coluna à esquerda
 * de PESO; depois das semanas vêm o % de atingimento e uma nota — nessa
 * ordem, sem rótulo próprio, então são localizadas pela posição relativa
 * ao cabeçalho, não por texto fixo (a planilha não rotula essas duas).
 *
 * Duas linhas sem indicador fecham a tabela: a de total (peso "100%",
 * nota "atingimento da meta") e a linha seguinte ("desconto aplicado").
 * Essas duas viram parâmetros, não itens.
 */
var _DATA_RE_WA = /^\d{2}\/\d{2}\/\d{4}$/;

function lerMetas() {
  var ss;
  try {
    ss = SpreadsheetApp.openById(ID_PLANILHA_NPS);
  } catch (err) {
    Logger.log('Metas: não consegui abrir a planilha (%s)', err);
    return { itens: [], resumo: {} };
  }

  var g = null, rCab = -1, cPeso = -1;
  var abas = ss.getSheets();
  for (var i = 0; i < abas.length && rCab < 0; i++) {
    var grade = abas[i].getDataRange().getDisplayValues();
    for (var r = 0; r < grade.length && rCab < 0; r++) {
      for (var c = 0; c < grade[r].length - 1; c++) {
        if (_norm(grade[r][c]) === 'PESO' && _norm(grade[r][c + 1]) === 'META') {
          g = grade; rCab = r; cPeso = c; break;
        }
      }
    }
  }
  if (rCab < 0) { Logger.log('Metas: cabeçalho PESO/META não encontrado.'); return { itens: [], resumo: {} }; }

  var cIndicador = cPeso - 1, cMeta = cPeso + 1;
  var semanaCols = [];
  for (var c2 = cMeta + 1; c2 < g[rCab].length; c2++) {
    var t = String(g[rCab][c2] || '').trim();
    if (_DATA_RE_WA.test(t)) semanaCols.push({ col: c2, label: t.slice(0, 5) });
    else break;
  }
  var cAting = cMeta + 1 + semanaCols.length;
  var cNota  = cAting + 1;

  var itens = [], resumo = {};
  for (var r2 = rCab + 1; r2 < g.length; r2++) {
    var linha = g[r2];
    var indicador = String(linha[cIndicador] || '').trim();
    var pesoBruto = String(linha[cPeso] || '').trim();
    var atingBruto = String(linha[cAting] || '').trim();
    var notaBruto = String(linha[cNota] || '').trim();

    if (!indicador) {
      var notaNorm = _norm(notaBruto);
      if (notaNorm.indexOf('ATINGIMENTO DA META') >= 0) {
        resumo.metas_atingimento_total = _num(atingBruto);
      } else if (notaNorm.indexOf('DESCONTO APLICADO') >= 0) {
        resumo.metas_desconto_aplicado = _num(atingBruto);
      }
      // linha totalmente vazia (indicador + peso + atingimento) encerra a tabela
      if (!pesoBruto && !atingBruto && !notaBruto) break;
      continue;
    }

    itens.push({
      indicador: indicador,
      ordem: itens.length + 1,
      peso_pct: _num(pesoBruto),
      meta: String(linha[cMeta] || '').trim() || null,
      semanas: semanaCols.map(function (s) {
        var v = String(linha[s.col] || '').trim();
        return { label: s.label, valor: v || null };
      }),
      atingimento_pct: atingBruto ? _num(atingBruto) : null,
      nota: notaBruto || null
    });
  }

  // Frase com a regra do bônus, ex.: "VALOR 100% DA META - 0,8% do
  // faturamento do mês de referência" — extrai só o número.
  for (var r3 = rCab; r3 < g.length; r3++) {
    for (var c3 = 0; c3 < g[r3].length; c3++) {
      var texto = String(g[r3][c3] || '').trim();
      if (_norm(texto).indexOf('VALOR 100% DA META') === 0) {
        var m = texto.match(/(\d+(?:[.,]\d+)?)\s*%/);
        if (m) resumo.metas_valor_100pct_fat_pct = parseFloat(m[1].replace(',', '.'));
        r3 = g.length; break;
      }
    }
  }

  return { itens: itens, resumo: resumo };
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

  var porEstagio = {};
  d.oportunidades.forEach(function (o) {
    porEstagio[o.estagio] = (porEstagio[o.estagio] || 0) + 1;
  });
  Logger.log('Oportunidades. %s', d.oportunidades.length);
  Object.keys(porEstagio).forEach(function (e) {
    Logger.log('   %s: %s', e, porEstagio[e]);
  });

  Logger.log('Metas ......... %s indicadores · peso total %s%%', d.metas.length,
    d.metas.reduce(function (s, m) { return s + (m.peso_pct || 0); }, 0));
  d.metas.forEach(function (m) {
    Logger.log('   %s · peso %s%% · meta %s · atingimento %s',
      m.indicador, m.peso_pct, m.meta, m.atingimento_pct == null ? 'sem dado' : m.atingimento_pct + '%');
  });

  Logger.log('Parâmetros ...');
  d.parametros.forEach(function (p) { Logger.log('   %s = %s', p.chave, p.valor); });

  var tamanho = JSON.stringify(d).length;
  Logger.log('\nJSON: %s KB%s', (tamanho / 1024).toFixed(1),
    tamanho >= 100000 ? ' (acima de 100 KB — o cache será ignorado)' : '');
  return d;
}
