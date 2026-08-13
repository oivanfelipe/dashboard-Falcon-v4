/**
 * ═══════════════════════════════════════════════════════════════════
 * FALCON SQUAD · SINCRONIZAÇÃO DRE_FALCON → SUPABASE
 * ═══════════════════════════════════════════════════════════════════
 *
 * Lê a planilha DRE_FALCON e empurra para o Supabase, que é a fonte
 * que o dashboard (index.html no Vercel) consome.
 *
 * O parser é dirigido por RÓTULO, não por coordenada: ele procura as
 * células pelo texto ("FATURAMENTO", "% FOLHA", "Pago?"…), então
 * inserir ou remover linhas na planilha não quebra a sincronização.
 *
 * ─── INSTALAÇÃO (uma vez) ──────────────────────────────────────────
 *  1. Abra a DRE_FALCON → Extensões → Apps Script
 *  2. Cole este arquivo, salve
 *  3. Projeto → Configurações → Propriedades do script, adicione:
 *       SUPABASE_URL          https://mzwynanvhojzyoirvxkc.supabase.co
 *       SUPABASE_SERVICE_KEY  <service_role key do projeto>
 *     (Supabase → Project Settings → API → service_role. Ela grava no
 *      banco; NUNCA coloque essa chave no index.html — lá vai só a anon.)
 *  4. Rode `dryRun` primeiro: ele lê tudo e escreve no log SEM gravar
 *     nada. Confira os números contra a planilha.
 *  5. Se estiver certo, rode `sincronizarTudo` uma vez (o Google vai
 *     pedir autorização) e depois `instalarGatilhos`.
 *
 * ─── GATILHOS ──────────────────────────────────────────────────────
 *  · onEdit          → qualquer edição na planilha agenda um sync
 *  · a cada 2 horas  → rede de segurança, caso o onEdit falhe
 * ═══════════════════════════════════════════════════════════════════
 */

// ─── Configuração ──────────────────────────────────────────────────

var MESES = {
  JAN:1, FEV:2, MAR:3, ABR:4, MAI:5, JUN:6,
  JUL:7, AGO:8, SET:9, OUT:10, NOV:11, DEZ:12
};
var MESES_EXTENSO = {
  JANEIRO:1, FEVEREIRO:2, 'MARÇO':3, MARCO:3, ABRIL:4, MAIO:5, JUNHO:6,
  JULHO:7, AGOSTO:8, SETEMBRO:9, OUTUBRO:10, NOVEMBRO:11, DEZEMBRO:12
};
var ANO = 2026;

/** Rótulos da DRE → coluna da tabela monthly_metrics.
 *  Aceita os dois nomes usados na planilha (JAN–MAI vs JUN em diante). */
var LINHAS_DRE = [
  { col:'faturamento',       rotulos:['FATURAMENTO'] },
  { col:'mrr',               rotulos:['MRR'] },
  { col:'variavel',          rotulos:['VARIÁVEL','VARIAVEL'] },
  { col:'inadimplentes',     rotulos:['INADIMPLENTES'] },
  { col:'ops_direta',        rotulos:['OPS DIRETA','PESSOAS'] },
  { col:'variaveis_ops',     rotulos:['VARIÁVEIS OPS DIRETA','VARIAVEIS OPS DIRETA','VARIÁVEIS','VARIAVEIS'] },
  { col:'royalties_imposto', rotulos:['ROYALTIES + IMPOSTO'] },
  { col:'over_ops',          rotulos:['OVER OPS','OVERHEAD PESSOAS'] },
  { col:'over_adm',          rotulos:['OVER ADM','OVERHEAD INFRA'] },
  { col:'over_comercial',    rotulos:['OVER COMERCIAL','OVERHEAD COMERCIAL'] },
  { col:'custos_producoes',  rotulos:['CUSTOS PRODUÇÕES','CUSTO PRODUÇÕES','CUSTOS PRODUCOES'] }
];

/** Bloco de indicadores por mês (layout rótulo | valor). */
var LINHAS_STATS = [
  { col:'num_clientes',      rotulos:['Nº CLIENTES','N CLIENTES'] },
  { col:'ticket_medio',      rotulos:['TICKET MÉDIO','TICKET MEDIO'] },
  { col:'num_investidores',  rotulos:['Nº  INVEST.','Nº INVEST.','N INVEST.'] },
  { col:'fat_cabeca',        rotulos:['FAT/CABEÇA','FAT/CABECA'] },
  { col:'percentual_folha',  rotulos:['% FOLHA'] }
];

var PRIMEIRO_MES_IVAN = 4; // abril/2026 — Ivan assume o squad

// ─── Utilitários ───────────────────────────────────────────────────

function _cfg(chave) {
  var v = PropertiesService.getScriptProperties().getProperty(chave);
  if (!v) throw new Error('Propriedade de script ausente: ' + chave +
    ' (Projeto → Configurações → Propriedades do script)');
  return v;
}

/** Normaliza texto de célula para comparação: sem acento duplo, sem
 *  espaços extras, maiúsculo. */
function _norm(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Converte célula em número. Aceita number puro, "R$ 1.234,56",
 *  "-R$ 1.234,56", "27,36%" e devolve null para #DIV/0!, vazio, etc. */
function _num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v).trim();
  if (!s || s.charAt(0) === '#') return null;          // #DIV/0!, #REF!
  var pct = s.indexOf('%') >= 0;
  s = s.replace(/[R$\s%]/g, '').replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s);
  if (!isFinite(n)) return null;
  return pct ? n : n;                                   // % já vem como 27,36
}

/** Percentual: no Sheets pode vir como 0.2736 (formatado) ou 27,36. */
function _pct(v) {
  var n = _num(v);
  if (n === null) return null;
  return (typeof v === 'number' && Math.abs(n) <= 1.5) ? n * 100 : n;
}

/** Varre a grade e devolve {linha, coluna} da primeira célula cujo
 *  texto normalizado bate com um dos rótulos. */
function _acharCelula(grade, rotulos) {
  var alvos = rotulos.map(_norm);
  for (var r = 0; r < grade.length; r++) {
    for (var c = 0; c < grade[r].length; c++) {
      if (alvos.indexOf(_norm(grade[r][c])) >= 0) return { linha:r, coluna:c };
    }
  }
  return null;
}

// ─── 1. DRE mensal → monthly_metrics ───────────────────────────────

function lerDRE() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var porMes = {}; // mes_order → registro

  ss.getSheets().forEach(function (aba) {
    var grade = aba.getDataRange().getDisplayValues();

    // Cabeçalho de meses: a linha imediatamente acima de FATURAMENTO
    var celFat = _acharCelula(grade, ['FATURAMENTO']);
    if (!celFat) return;

    // Procura, nas linhas acima, a que tem 2+ siglas de mês
    var linhaMeses = -1, colunasMes = {};
    for (var r = celFat.linha - 1; r >= 0 && r >= celFat.linha - 4; r--) {
      var achados = {}, n = 0;
      for (var c = 0; c < grade[r].length; c++) {
        var t = _norm(grade[r][c]);
        if (MESES[t] && !achados[t]) { achados[t] = c; n++; }
      }
      if (n >= 2) { linhaMeses = r; colunasMes = achados; break; }
    }
    if (linhaMeses < 0) return;

    // Registra os meses desta aba
    Object.keys(colunasMes).forEach(function (sigla) {
      var ord = MESES[sigla];
      if (!porMes[ord]) porMes[ord] = { month_label:sigla, month_order:ord, year:ANO };
    });

    // Lê cada linha da DRE
    LINHAS_DRE.forEach(function (def) {
      var cel = _acharCelula(grade, def.rotulos);
      if (!cel || cel.linha <= linhaMeses) return;
      Object.keys(colunasMes).forEach(function (sigla) {
        var v = _num(grade[cel.linha][colunasMes[sigla]]);
        if (v !== null) porMes[MESES[sigla]][def.col] = v;
      });
    });

    // Linhas de MARGEM: são duas seguidas (R$ e %), ambas rotuladas "MARGEM"
    var margens = [];
    for (var r2 = 0; r2 < grade.length; r2++) {
      for (var c2 = 0; c2 < grade[r2].length; c2++) {
        if (_norm(grade[r2][c2]) === 'MARGEM') { margens.push(r2); break; }
      }
    }
    if (margens.length >= 1) {
      Object.keys(colunasMes).forEach(function (sigla) {
        var reg = porMes[MESES[sigla]], cm = colunasMes[sigla];
        var v1 = _num(grade[margens[0]][cm]);
        if (v1 !== null) reg.margem_valor = v1;
        if (margens.length >= 2) {
          var v2 = _pct(grade[margens[1]][cm]);
          if (v2 !== null) reg.margem_percentual = v2;
        }
      });
    }

    // Bloco de indicadores: rótulo numa célula, valor na célula à direita,
    // sob um cabeçalho com o mês por extenso (JUNHO, JULHO…).
    for (var r3 = 0; r3 < grade.length; r3++) {
      for (var c3 = 0; c3 < grade[r3].length; c3++) {
        var ord = MESES_EXTENSO[_norm(grade[r3][c3])];
        if (!ord || !porMes[ord]) continue;
        // varre as ~8 linhas abaixo procurando os rótulos de indicador
        for (var r4 = r3 + 1; r4 < Math.min(r3 + 9, grade.length); r4++) {
          LINHAS_STATS.forEach(function (def) {
            var alvos = def.rotulos.map(_norm);
            for (var c4 = c3; c4 < Math.min(c3 + 2, grade[r4].length); c4++) {
              if (alvos.indexOf(_norm(grade[r4][c4])) >= 0) {
                var bruto = grade[r4][c4 + 1];
                var v = def.col === 'percentual_folha' ? _pct(bruto) : _num(bruto);
                if (v !== null) {
                  porMes[ord][def.col] =
                    (def.col === 'num_clientes' || def.col === 'num_investidores')
                      ? Math.round(v) : v;
                }
              }
            }
          });
        }
      }
    }
  });

  // Só meses com faturamento; marca o período do Ivan
  return Object.keys(porMes)
    .map(function (k) { return porMes[k]; })
    .filter(function (m) { return m.faturamento > 0; })
    .map(function (m) { m.is_ivan_period = m.month_order >= PRIMEIRO_MES_IVAN; return m; })
    .sort(function (a, b) { return a.month_order - b.month_order; });
}

// ─── 2. Pessoas → falcon_pessoas ───────────────────────────────────

/** Cabeçalhos de área no bloco "INVESTIDORES TIME". */
var AREAS = [
  { rotulo:'ACCOUNTS',        area:'Accounts',     cargo:'Account' },
  { rotulo:'DESIGNER',        area:'Design',       cargo:'Designer' },
  { rotulo:'SOCIAL MEDIA',    area:'Social Media', cargo:'Social Media' },
  { rotulo:'GESTOR TRÁFEGO',  area:'Tráfego',      cargo:'Gestor de Tráfego' },
  { rotulo:'GESTOR TRAFEGO',  area:'Tráfego',      cargo:'Gestor de Tráfego' }
];

function lerPessoas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pessoas = [], vistos = {};

  ss.getSheets().forEach(function (aba) {
    var grade = aba.getDataRange().getDisplayValues();

    // Coordenador: rótulo "COORDENADOR: <nome>" com o salário na mesma linha
    for (var r = 0; r < grade.length; r++) {
      for (var c = 0; c < grade[r].length; c++) {
        var t = _norm(grade[r][c]);
        if (t.indexOf('COORDENADOR:') !== 0) continue;
        var nome = String(grade[r][c]).split(':')[1];
        nome = nome ? nome.trim() : 'Coordenador';
        // o salário é o último número da linha
        var sal = null;
        for (var c2 = grade[r].length - 1; c2 > c; c2--) {
          var v = _num(grade[r][c2]);
          if (v !== null && v > 0) { sal = v; break; }
        }
        if (sal && !vistos[_norm(nome)]) {
          vistos[_norm(nome)] = true;
          pessoas.push({ nome:_titulo(nome), cargo:'Coordenador',
                         area:'Coordenação', salario:sal, ativo:true, ordem:1 });
        }
      }
    }

    // Áreas: sob cada cabeçalho, pares (nome, salário) até a linha
    // "CUSTO TOTAL" ou o fim do bloco.
    AREAS.forEach(function (def) {
      var cel = _acharCelula(grade, [def.rotulo]);
      if (!cel) return;
      for (var r3 = cel.linha + 1; r3 < Math.min(cel.linha + 12, grade.length); r3++) {
        var nome = String(grade[r3][cel.coluna] || '').trim();
        var chave = _norm(nome);
        if (!nome) continue;
        if (chave === 'CUSTO' ) continue;                 // linha de subtotal
        if (chave.indexOf('CUSTO TOTAL') >= 0) break;     // fim do bloco
        if (MESES[chave] || MESES_EXTENSO[chave]) break;  // entrou noutro bloco
        var sal = _num(grade[r3][cel.coluna + 1]);
        if (sal === null || sal <= 0) continue;
        if (vistos[chave]) continue;
        vistos[chave] = true;
        pessoas.push({ nome:_titulo(nome), cargo:def.cargo, area:def.area,
                       salario:sal, ativo:true, ordem:pessoas.length + 2 });
      }
    });
  });

  return pessoas;
}

/** "LUMA LORENZON" → "Luma Lorenzon" (preserva nomes já capitalizados). */
function _titulo(s) {
  s = String(s).replace(/\s+/g, ' ').trim();
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|\s)([a-zà-ú])/g, function (m, a, b) {
    return a + b.toUpperCase();
  });
}

// ─── 3. Faturamento por cliente → falcon_faturamento ───────────────

function lerFaturamento() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var itens = [];

  ss.getSheets().forEach(function (aba) {
    var grade = aba.getDataRange().getDisplayValues();

    // Cada bloco começa num cabeçalho "Cliente | Squad | Pago? | ... | VALOR"
    for (var r = 0; r < grade.length; r++) {
      for (var c = 0; c < grade[r].length; c++) {
        if (_norm(grade[r][c]) !== 'CLIENTE') continue;
        if (_norm(grade[r][c + 2]) !== 'PAGO?') continue;

        // Mês: célula com o nome por extenso acima do cabeçalho
        var ord = null;
        for (var rr = r - 1; rr >= 0 && rr >= r - 3 && !ord; rr--) {
          for (var cc = c; cc < Math.min(c + 5, grade[rr].length); cc++) {
            var m = MESES_EXTENSO[_norm(grade[rr][cc]).replace(/[^A-ZÇÃÁ]/g, '')];
            if (m) { ord = m; break; }
          }
        }
        if (!ord) continue;

        var sigla = Object.keys(MESES).filter(function (k) { return MESES[k] === ord; })[0];
        var linha = 0;

        for (var r2 = r + 1; r2 < grade.length; r2++) {
          var cliente = String(grade[r2][c] || '').trim();
          var valor   = _num(grade[r2][c + 4]);
          if (!cliente) {
            // linha de total (só valor) encerra o bloco
            if (valor !== null) break;
            continue;
          }
          if (valor === null) continue;
          linha++;
          itens.push({
            mes_label: sigla, mes_order: ord, ano: ANO, linha: linha,
            cliente: _titulo(cliente),
            squad: String(grade[r2][c + 1] || 'FALCON').trim().toUpperCase(),
            discriminacao: String(grade[r2][c + 3] || '').trim(),
            pago: _norm(grade[r2][c + 2]) === 'SIM',
            valor: valor
          });
        }
      }
    }
  });

  return itens;
}

// ─── Escrita no Supabase ───────────────────────────────────────────

function _req(metodo, caminho, corpo, prefer) {
  var res = UrlFetchApp.fetch(_cfg('SUPABASE_URL') + '/rest/v1/' + caminho, {
    method: metodo,
    contentType: 'application/json',
    headers: {
      apikey: _cfg('SUPABASE_SERVICE_KEY'),
      Authorization: 'Bearer ' + _cfg('SUPABASE_SERVICE_KEY'),
      Prefer: prefer || 'return=minimal'
    },
    payload: corpo ? JSON.stringify(corpo) : undefined,
    muteHttpExceptions: true
  });
  var cod = res.getResponseCode();
  if (cod >= 300) throw new Error(metodo + ' ' + caminho + ' → ' + cod + ' ' + res.getContentText());
  return res.getContentText();
}

function _upsert(tabela, linhas, conflito) {
  if (!linhas.length) return 0;
  for (var i = 0; i < linhas.length; i += 200) {
    _req('POST', tabela + '?on_conflict=' + conflito, linhas.slice(i, i + 200),
         'resolution=merge-duplicates,return=minimal');
  }
  return linhas.length;
}

// ─── Entradas ──────────────────────────────────────────────────────

/** Lê tudo e imprime no log, SEM gravar. Rode isto primeiro. */
function dryRun() {
  var dre = lerDRE(), pessoas = lerPessoas(), fat = lerFaturamento();

  Logger.log('═══ DRE (%s meses) ═══', dre.length);
  dre.forEach(function (m) {
    Logger.log('%s  fat=%s  mrr=%s  ops=%s  margem=%s (%s%%)  folha=%s%%',
      m.month_label, m.faturamento, m.mrr, m.ops_direta,
      m.margem_valor, m.margem_percentual, m.percentual_folha);
    var somaCustos = (m.ops_direta||0)+(m.variaveis_ops||0)+(m.royalties_imposto||0)+
                     (m.over_ops||0)+(m.over_adm||0)+(m.over_comercial||0)+(m.custos_producoes||0);
    var conferido = (m.faturamento||0) - somaCustos;
    if (m.margem_valor != null && Math.abs(conferido - m.margem_valor) > 1) {
      Logger.log('   ⚠ cascata não fecha: calculado %s vs planilha %s',
        conferido.toFixed(2), m.margem_valor);
    }
  });

  Logger.log('\n═══ PESSOAS (%s) ═══', pessoas.length);
  var folha = 0;
  pessoas.forEach(function (p) {
    folha += p.salario;
    Logger.log('%s · %s · %s → R$ %s', p.nome, p.cargo, p.area, p.salario);
  });
  Logger.log('FOLHA TOTAL: R$ %s', folha);

  Logger.log('\n═══ FATURAMENTO POR CLIENTE ═══');
  var porMes = {};
  fat.forEach(function (f) {
    porMes[f.mes_label] = porMes[f.mes_label] || { n:0, total:0, pago:0 };
    porMes[f.mes_label].n++;
    porMes[f.mes_label].total += f.valor;
    if (f.pago) porMes[f.mes_label].pago += f.valor;
  });
  Object.keys(porMes).forEach(function (m) {
    Logger.log('%s: %s lançamentos · total R$ %s · recebido R$ %s',
      m, porMes[m].n, porMes[m].total.toFixed(2), porMes[m].pago.toFixed(2));
  });

  Logger.log('\nNada foi gravado. Confira os números e rode sincronizarTudo().');
  return { dre:dre, pessoas:pessoas, faturamento:fat };
}

/** Lê a planilha e grava no Supabase. */
function sincronizarTudo() {
  var dre = lerDRE();
  if (!dre.length) throw new Error('Nenhum mês lido da DRE — verifique os rótulos da planilha.');
  _upsert('monthly_metrics', dre, 'month_order,year');

  var pessoas = lerPessoas();
  if (pessoas.length) {
    // troca completa: o time muda de composição, não só de valor
    _req('DELETE', 'falcon_pessoas?id=gt.0');
    _req('POST', 'falcon_pessoas', pessoas);
  }

  var fat = lerFaturamento();
  if (fat.length) {
    var meses = {};
    fat.forEach(function (f) { meses[f.mes_order] = f.ano; });
    // apaga e reinsere mês a mês (linhas podem sair da planilha)
    Object.keys(meses).forEach(function (ord) {
      _req('DELETE', 'falcon_faturamento?ano=eq.' + meses[ord] + '&mes_order=eq.' + ord);
    });
    _upsert('falcon_faturamento', fat, 'ano,mes_order,linha');
  }

  var msg = Utilities.formatString('Sync OK · %s meses · %s pessoas · %s lançamentos',
    dre.length, pessoas.length, fat.length);
  Logger.log(msg);
  PropertiesService.getScriptProperties()
    .setProperty('ULTIMO_SYNC', new Date().toISOString() + ' — ' + msg);
  return msg;
}

/** Chamado pelo gatilho de edição: agenda um sync em ~1 min para não
 *  disparar uma gravação a cada tecla digitada. */
function aoEditar() {
  var props = PropertiesService.getScriptProperties();
  var agora = Date.now();
  if (agora - Number(props.getProperty('SYNC_AGENDADO') || 0) < 60000) return;
  props.setProperty('SYNC_AGENDADO', String(agora));
  ScriptApp.newTrigger('sincronizarTudo').timeBased().after(60 * 1000).create();
}

function instalarGatilhos() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger('aoEditar').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('sincronizarTudo').timeBased().everyHours(2).create();
  Logger.log('Gatilhos instalados: onEdit + a cada 2 horas.');
}
