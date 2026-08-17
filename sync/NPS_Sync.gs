/**
 * ═══════════════════════════════════════════════════════════════════
 * FALCON SQUAD · SINCRONIZAÇÃO NPS/CSAT + METAS → SUPABASE
 * ═══════════════════════════════════════════════════════════════════
 *
 * Lê, na planilha de clientes, a aba de NPS e a aba de Metas, e grava
 * em falcon_nps / falcon_metas. As duas vivem no mesmo arquivo, então
 * um único sync cobre as duas.
 *
 * NPS: bloco de 10 colunas por mês, sob um cabeçalho com o mês por
 * extenso (MARÇO, ABRIL, …):
 *
 *   STATUS │ NPS │ CSAT │ atendimento │ campanhas │ copy │ design │
 *   prazos │ resultados │ COMENTÁRIO
 *
 * e uma coluna CLIENTE + uma coluna SQUAD à esquerda. Só as linhas com
 * SQUAD = FALCON são sincronizadas.
 *
 * Metas: cabeçalho "PESO | META" seguido de uma coluna por semana
 * (datas dd/mm/aaaa); o indicador fica à esquerda de PESO.
 *
 * Não precisa da service_role: a escrita passa pela Edge Function
 * `sync-falcon`, que roda dentro do Supabase.
 *
 * ─── INSTALAÇÃO ────────────────────────────────────────────────────
 *  1. Abra a planilha de clientes → Extensões → Apps Script
 *  2. Cole este arquivo, salve
 *  3. Propriedades do script:
 *       SYNC_TOKEN   <o mesmo token usado na DRE_FALCON>
 *       ABA_NPS      NPS - Q2   (opcional; sem isso ele acha a aba sozinho)
 *  4. Rode `dryRunNPS`, confira o log, depois `sincronizarNPS` e
 *     `instalarGatilhosNPS`. Um único sync grava NPS e Metas.
 * ═══════════════════════════════════════════════════════════════════
 */

var ANO_NPS = 2026;
var SQUAD   = 'FALCON';

var SYNC_URL = 'https://mzwynanvhojzyoirvxkc.supabase.co/functions/v1/sync-falcon';
var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16d3luYW52aG9qenlvaXJ2eGtjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5Mjc3NjEsImV4cCI6MjEwMTUwMzc2MX0.UniVWAVDJgyHo8QGlqXjMeTBulsjEDdZ5nyBWowYO2s';

var MES_EXT = {
  JANEIRO:1, FEVEREIRO:2, 'MARÇO':3, MARCO:3, ABRIL:4, MAIO:5, JUNHO:6,
  JULHO:7, AGOSTO:8, SETEMBRO:9, OUTUBRO:10, NOVEMBRO:11, DEZEMBRO:12
};
var SIGLA = ['','JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];

/** Ordem das colunas dentro do bloco de cada mês, a partir do STATUS. */
var BLOCO = ['status','nps','csat','atendimento','campanhas','copy',
             'design','prazos','resultados','comentario'];

function _cfgN(chave, opcional) {
  var v = PropertiesService.getScriptProperties().getProperty(chave);
  if (!v && !opcional) throw new Error('Propriedade de script ausente: ' + chave);
  return v;
}
function _n(v) {
  if (v === null || v === undefined || v === '') return '';
  return String(v).replace(/\s+/g, ' ').trim().toUpperCase();
}
function _int(v) {
  var s = String(v == null ? '' : v).trim();
  if (!/^\d+$/.test(s)) return null;
  return parseInt(s, 10);
}
function _dec(v) {
  var s = String(v == null ? '' : v).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return parseFloat(s);
}
/** Número tolerante a "R$ 1.234,56", "20%", "-": usado nas Metas. */
function _pctNum(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s || s === '-' || s === '\\-') return null;
  s = s.replace(/[R$\s%]/g, '').replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s);
  return isFinite(n) ? n : null;
}

/** Localiza a aba de NPS: a nomeada em ABA_NPS, ou a primeira que tenha
 *  uma linha de cabeçalho com STATUS + NPS + CSAT. */
function _abaNPS() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var nome = _cfgN('ABA_NPS', true);
  if (nome) {
    var a = ss.getSheetByName(nome);
    if (a) return a;
    Logger.log('Aba "%s" não encontrada; procurando automaticamente.', nome);
  }
  var achada = null;
  ss.getSheets().forEach(function (aba) {
    if (achada) return;
    var g = aba.getDataRange().getDisplayValues();
    for (var r = 0; r < Math.min(g.length, 12); r++) {
      var linha = g[r].map(_n);
      if (linha.indexOf('NPS') >= 0 && linha.indexOf('CSAT') >= 0 &&
          linha.indexOf('STATUS') >= 0) { achada = aba; return; }
    }
  });
  if (!achada) throw new Error('Nenhuma aba com cabeçalho STATUS/NPS/CSAT encontrada.');
  return achada;
}

function lerNPS() {
  var g = _abaNPS().getDataRange().getDisplayValues();

  // Linha de cabeçalho dos campos (a que tem STATUS, NPS e CSAT)
  var rCab = -1;
  for (var r = 0; r < Math.min(g.length, 12) && rCab < 0; r++) {
    var l = g[r].map(_n);
    if (l.indexOf('NPS') >= 0 && l.indexOf('CSAT') >= 0 && l.indexOf('STATUS') >= 0) rCab = r;
  }
  if (rCab < 0) throw new Error('Cabeçalho STATUS/NPS/CSAT não localizado.');

  // Colunas CLIENTE e SQUAD (na própria linha de cabeçalho)
  var cCliente = -1, cSquad = -1;
  for (var c = 0; c < g[rCab].length; c++) {
    var t = _n(g[rCab][c]);
    if (t === 'CLIENTE' && cCliente < 0) cCliente = c;
    if (t === 'SQUAD'   && cSquad   < 0) cSquad   = c;
  }
  if (cCliente < 0) throw new Error('Coluna CLIENTE não localizada.');

  // Início de cada bloco de mês: célula com o mês por extenso, nas
  // linhas acima do cabeçalho. A coluna dela é o STATUS daquele mês.
  var blocos = {};
  for (var r2 = 0; r2 < rCab; r2++) {
    for (var c2 = 0; c2 < g[r2].length; c2++) {
      var ord = MES_EXT[_n(g[r2][c2]).replace(/[^A-ZÇÃÁÉÍÓÚ]/g, '')];
      if (ord && _n(g[rCab][c2]) === 'STATUS') blocos[ord] = c2;
    }
  }
  if (!Object.keys(blocos).length) throw new Error('Nenhum bloco de mês localizado.');

  var itens = [];
  for (var r3 = rCab + 1; r3 < g.length; r3++) {
    var cliente = String(g[r3][cCliente] || '').trim();
    if (!cliente) continue;
    if (cSquad >= 0 && _n(g[r3][cSquad]) !== SQUAD) continue;

    Object.keys(blocos).forEach(function (ord) {
      var base = blocos[ord], reg = { cliente: cliente,
        mes_label: SIGLA[ord], mes_order: Number(ord), ano: ANO_NPS };
      var temAlgo = false;

      BLOCO.forEach(function (campo, i) {
        var bruto = g[r3][base + i];
        if (bruto === undefined || String(bruto).trim() === '') return;
        var s = String(bruto).trim();
        if (s === '-' || s === '\\-') return;
        temAlgo = true;
        if (campo === 'status')          reg.status = s.toLowerCase();
        else if (campo === 'comentario') reg.comentario = s;
        else if (campo === 'csat')       reg.csat = _dec(s);
        else                             reg[campo] = _int(s);
      });

      if (temAlgo) itens.push(reg);
    });
  }
  return itens;
}

// ─── Metas: mesma planilha, aba com cabeçalho "PESO | META" ────────

var _DATA_RE = /^\d{2}\/\d{2}\/\d{4}$/;

function lerMetas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var g = null, rCab = -1, cPeso = -1;
  var abas = ss.getSheets();
  for (var i = 0; i < abas.length && rCab < 0; i++) {
    var grade = abas[i].getDataRange().getDisplayValues();
    for (var r = 0; r < grade.length && rCab < 0; r++) {
      for (var c = 0; c < grade[r].length - 1; c++) {
        if (_n(grade[r][c]) === 'PESO' && _n(grade[r][c + 1]) === 'META') {
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
    if (_DATA_RE.test(t)) semanaCols.push({ col: c2, label: t.slice(0, 5) });
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
      var notaNorm = _n(notaBruto);
      if (notaNorm.indexOf('ATINGIMENTO DA META') >= 0) {
        resumo.metas_atingimento_total = _pctNum(atingBruto);
      } else if (notaNorm.indexOf('DESCONTO APLICADO') >= 0) {
        resumo.metas_desconto_aplicado = _pctNum(atingBruto);
      }
      if (!pesoBruto && !atingBruto && !notaBruto) break;
      continue;
    }

    itens.push({
      indicador: indicador,
      ordem: itens.length + 1,
      peso_pct: _pctNum(pesoBruto),
      meta: String(linha[cMeta] || '').trim() || null,
      semanas: semanaCols.map(function (s) {
        var v = String(linha[s.col] || '').trim();
        return { label: s.label, valor: v || null };
      }),
      atingimento_pct: atingBruto ? _pctNum(atingBruto) : null,
      nota: notaBruto || null
    });
  }

  for (var r3 = rCab; r3 < g.length; r3++) {
    for (var c3 = 0; c3 < g[r3].length; c3++) {
      var texto = String(g[r3][c3] || '').trim();
      if (_n(texto).indexOf('VALOR 100% DA META') === 0) {
        var m = texto.match(/(\d+(?:[.,]\d+)?)\s*%/);
        if (m) resumo.metas_valor_100pct_fat_pct = parseFloat(m[1].replace(',', '.'));
        r3 = g.length; break;
      }
    }
  }

  return { itens: itens, resumo: resumo };
}

function _enviar(payload) {
  var res = UrlFetchApp.fetch(SYNC_URL, {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ANON_KEY,
               'x-sync-token': _cfgN('SYNC_TOKEN') },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var cod = res.getResponseCode(), txt = res.getContentText();
  if (cod === 401) throw new Error('SYNC_TOKEN inválido ou ausente — confira as Propriedades do script.');
  if (cod >= 300) throw new Error('sync-falcon → ' + cod + ' ' + txt);
  return JSON.parse(txt);
}

/** Lê e imprime, sem gravar. */
function dryRunNPS() {
  var itens = lerNPS();
  Logger.log('═══ %s registros de NPS (squad %s) ═══', itens.length, SQUAD);

  var porMes = {};
  itens.forEach(function (i) {
    porMes[i.mes_label] = porMes[i.mes_label] || { resp: [], outros: 0 };
    if (i.status === 'respondida' && i.nps != null) porMes[i.mes_label].resp.push(i.nps);
    else porMes[i.mes_label].outros++;
  });
  Object.keys(porMes).forEach(function (m) {
    var r = porMes[m].resp, n = r.length;
    var p = r.filter(function (x) { return x >= 9; }).length;
    var d = r.filter(function (x) { return x <= 6; }).length;
    Logger.log('%s: %s respondida(s) · NPS %s · %s sem resposta',
      m, n, n ? Math.round((p - d) / n * 100) : '—', porMes[m].outros);
  });

  Logger.log('\n--- detalhe ---');
  itens.forEach(function (i) {
    Logger.log('%s / %s · %s · nps=%s csat=%s%s',
      i.cliente, i.mes_label, i.status, i.nps, i.csat,
      i.comentario ? ' · "' + i.comentario.slice(0, 60) + '…"' : '');
  });
  Logger.log('\nNada foi gravado.');
  return itens;
}

/** Lê a aba de Metas e imprime no log, sem gravar. */
function dryRunMetas() {
  var r = lerMetas();
  Logger.log('═══ %s indicadores · peso total %s%% ═══', r.itens.length,
    r.itens.reduce(function (s, m) { return s + (m.peso_pct || 0); }, 0));
  r.itens.forEach(function (m) {
    Logger.log('%s · peso %s%% · meta %s · atingimento %s',
      m.indicador, m.peso_pct, m.meta, m.atingimento_pct == null ? 'sem dado' : m.atingimento_pct + '%');
  });
  Logger.log('Resumo: %s', JSON.stringify(r.resumo));
  Logger.log('\nNada foi gravado.');
  return r;
}

/** Sincroniza NPS e Metas num único POST, já que vivem na mesma planilha. */
function sincronizarNPS() {
  var nps = lerNPS();
  var metas = lerMetas();
  if (!nps.length && !metas.itens.length)
    throw new Error('Nada para sincronizar — confira as abas de NPS e Metas.');

  var payload = {};
  if (nps.length) payload.nps = nps;
  if (metas.itens.length) payload.metas = metas.itens;
  var parametros = Object.keys(metas.resumo).map(function (k) {
    return { chave: k, valor: metas.resumo[k], rotulo: 'Metas · ' + k };
  });
  if (parametros.length) payload.parametros = parametros;

  var r = _enviar(payload);
  var msg = 'Sync OK · ' + (r.resumo.nps || 0) + ' NPS · ' + (r.resumo.metas || 0) + ' metas';
  Logger.log(msg);
  PropertiesService.getScriptProperties()
    .setProperty('ULTIMO_SYNC_NPS', new Date().toISOString() + ' — ' + msg);
  return msg;
}

function aoEditarNPS() {
  var props = PropertiesService.getScriptProperties();
  var agora = Date.now();
  if (agora - Number(props.getProperty('SYNC_NPS_AGENDADO') || 0) < 60000) return;
  props.setProperty('SYNC_NPS_AGENDADO', String(agora));
  ScriptApp.newTrigger('sincronizarNPS').timeBased().after(60 * 1000).create();
}

function instalarGatilhosNPS() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger('aoEditarNPS').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('sincronizarNPS').timeBased().everyHours(6).create();
  Logger.log('Gatilhos NPS instalados: onEdit + a cada 6 horas.');
}
