import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * sync-falcon — porta de escrita das planilhas para o Supabase.
 *
 * O Apps Script não precisa da service_role: ele manda a chave anon no
 * Authorization (que o gate de JWT da plataforma já valida) mais um token
 * compartilhado no header x-sync-token. Este código roda dentro do
 * Supabase, onde SUPABASE_SERVICE_ROLE_KEY é injetada automaticamente.
 *
 * POST body — todas as chaves são opcionais:
 *   {
 *     "dre":         [ ...linhas de monthly_metrics... ],
 *     "pessoas":     [ ...falcon_pessoas... ],
 *     "faturamento": [ ...falcon_faturamento... ],
 *     "nps":         [ ...falcon_nps... ],
 *     "parametros":  [ { chave, valor, rotulo } ]
 *   }
 */

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Comparação em tempo constante, para não vazar o token por timing. */
function tokensBatem(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);

  const enviado = req.headers.get("x-sync-token") ?? "";
  if (!enviado) return json({ erro: "x-sync-token ausente" }, 401);

  const { data: tok } = await db
    .from("sync_tokens").select("token").eq("nome", "planilhas").single();
  if (!tok?.token || !tokensBatem(enviado, tok.token)) {
    return json({ erro: "token inválido" }, 401);
  }

  let payload: Record<string, unknown[]>;
  try {
    payload = await req.json();
  } catch {
    return json({ erro: "corpo não é JSON válido" }, 400);
  }

  const resumo: Record<string, number> = {};
  const erros: string[] = [];
  const arr = (k: string) => Array.isArray(payload[k]) ? payload[k] as any[] : null;

  const guard = async (rotulo: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { erros.push(`${rotulo}: ${e.message ?? e}`); }
  };

  // ── DRE mensal: upsert por (month_order, year) ──
  const dre = arr("dre");
  if (dre?.length) await guard("dre", async () => {
    const { error } = await db.from("monthly_metrics")
      .upsert(dre, { onConflict: "month_order,year" });
    if (error) throw error;
    resumo.dre = dre.length;
  });

  // ── Pessoas: troca completa (o time muda de composição) ──
  const pessoas = arr("pessoas");
  if (pessoas?.length) await guard("pessoas", async () => {
    const del = await db.from("falcon_pessoas").delete().gt("id", 0);
    if (del.error) throw del.error;
    const { error } = await db.from("falcon_pessoas").insert(pessoas);
    if (error) throw error;
    resumo.pessoas = pessoas.length;
  });

  // ── Faturamento: troca completa dos meses presentes no payload ──
  const fat = arr("faturamento");
  if (fat?.length) await guard("faturamento", async () => {
    const chaves = new Map<string, { ano: number; mes: number }>();
    for (const f of fat as any[]) {
      chaves.set(`${f.ano}-${f.mes_order}`, { ano: f.ano, mes: f.mes_order });
    }
    for (const { ano, mes } of chaves.values()) {
      const del = await db.from("falcon_faturamento")
        .delete().eq("ano", ano).eq("mes_order", mes);
      if (del.error) throw del.error;
    }
    const { error } = await db.from("falcon_faturamento").insert(fat);
    if (error) throw error;
    resumo.faturamento = fat.length;
    resumo.meses_faturamento = chaves.size;
  });

  // ── NPS: troca completa dos anos presentes ──
  const nps = arr("nps");
  if (nps?.length) await guard("nps", async () => {
    const anos = new Set((nps as any[]).map((n) => n.ano));
    for (const ano of anos) {
      const del = await db.from("falcon_nps").delete().eq("ano", ano);
      if (del.error) throw del.error;
    }
    const { error } = await db.from("falcon_nps").insert(nps);
    if (error) throw error;
    resumo.nps = nps.length;
  });

  // ── Parâmetros: upsert por chave ──
  const par = arr("parametros");
  if (par?.length) await guard("parametros", async () => {
    const { error } = await db.from("falcon_parametros")
      .upsert(par, { onConflict: "chave" });
    if (error) throw error;
    resumo.parametros = par.length;
  });

  await db.from("sync_tokens")
    .update({ usado_em: new Date().toISOString() }).eq("nome", "planilhas");

  if (erros.length) return json({ ok: false, resumo, erros }, 500);
  if (!Object.keys(resumo).length) {
    return json({ ok: true, resumo, aviso: "payload vazio — nada foi gravado" });
  }
  return json({ ok: true, resumo });
});
