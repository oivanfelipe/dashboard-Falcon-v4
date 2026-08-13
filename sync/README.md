# Sincronização das planilhas → Dashboard

O dashboard (`index.html`, publicado no Vercel) não lê o Google Sheets
diretamente: ele lê o **Supabase**, que funciona como a camada de leitura
rápida. Quem alimenta o Supabase é a planilha.

```
  Google Sheets            Edge Function            Postgres          Vercel
                          (dentro do Supabase)

  DRE_FALCON      ──┐                          ┌─ monthly_metrics
  planilha NPS    ──┼─POST /sync-falcon──────► │  falcon_faturamento ──► index.html
  (Apps Script)     │   x-sync-token           │  falcon_pessoas         lê a cada
                    │                          │  falcon_nps             3 min com
                    │   a função usa a         └─ falcon_parametros      a chave
                    │   service_role, que                                anon
                    │   nunca sai do Supabase                          (só leitura)
```

**Ninguém fora do Supabase manuseia a `service_role`.** O Apps Script se
autentica com um token de sincronismo; a Edge Function valida esse token
contra a tabela `sync_tokens` e só então grava.

## Cadência de atualização

| Fonte | Planilha | Script | Gatilhos |
|---|---|---|---|
| DRE mensal | DRE_FALCON | `DRE_Falcon_Sync.gs` | `onEdit` + 2h |
| Faturamento por cliente | DRE_FALCON | idem | idem |
| Salários / time | DRE_FALCON | idem | idem |
| NPS · CSAT · comentários | planilha de clientes, aba NPS | `NPS_Sync.gs` | `onEdit` + 6h |
| Oportunidades | planilha de oportunidades | ainda manual | — |

O `index.html` busca o Supabase **a cada 3 minutos** e também sempre que a
aba volta a ficar visível. O ponto verde no canto superior direito mostra o
horário da última leitura — fica âmbar/vermelho se a busca falhar.

## Instalação do sync (uma vez)

1. Abra a **DRE_FALCON** → *Extensões* → *Apps Script*
2. Cole o conteúdo de [`DRE_Falcon_Sync.gs`](./DRE_Falcon_Sync.gs) e salve
3. *Projeto* → *Configurações* → *Propriedades do script*, adicione **uma**
   propriedade:

   | Propriedade | Valor |
   |---|---|
   | `SYNC_TOKEN` | o token de sincronismo (começa com `flc_`) |

   URL e chave pública já estão no topo do script. Não há chave secreta
   para configurar.

4. **Rode `dryRun` primeiro.** Ele lê a planilha inteira e escreve tudo no
   log sem gravar nada, inclusive um aviso quando a cascata da DRE
   (faturamento − custos = margem) não fecha. Confira contra a planilha.
5. Se estiver certo: rode `sincronizarTudo` (o Google vai pedir
   autorização) e depois `instalarGatilhos`.

### Se o token vazar

Gere outro e atualize os dois Apps Scripts:

```sql
update public.sync_tokens
   set token = 'flc_' || replace(gen_random_uuid()::text,'-','')
              || replace(gen_random_uuid()::text,'-',''),
       criado_em = now()
 where nome = 'planilhas';

select token from public.sync_tokens where nome = 'planilhas';
```

O token velho para de funcionar na hora. `select usado_em from
sync_tokens` mostra quando foi o último sync bem-sucedido.

## Por que o parser não quebra fácil

O script procura as células **pelo rótulo** (`FATURAMENTO`, `% FOLHA`,
`Pago?`, `COORDENADOR:`…), não por linha/coluna fixa. Inserir linhas,
mover blocos ou acrescentar um mês novo não exige mexer no código.

Dois pontos que **exigem** atenção ao editar a planilha:

- Os rótulos das linhas da DRE precisam continuar reconhecíveis. A lista de
  sinônimos aceitos está em `LINHAS_DRE` (ex.: `OPS DIRETA` e `PESSOAS` são
  tratados como a mesma linha, porque a planilha muda de nome entre
  JAN–MAI e JUN em diante).
- O bloco de faturamento por cliente precisa manter o cabeçalho
  `Cliente | Squad | Pago? | DISCRIMINAÇÃO | VALOR` e o nome do mês por
  extenso acima dele.

Um mês novo na planilha aparece sozinho no dashboard — inclusive no filtro
de mês da cascata e na tabela da DRE.

## Estrutura no Supabase

| Tabela | O que guarda | Chave de upsert |
|---|---|---|
| `monthly_metrics` | uma linha por mês da DRE | `month_order, year` |
| `falcon_faturamento` | um lançamento por linha das abas mensais | `ano, mes_order, linha` |
| `falcon_pessoas` | time ativo com salário | troca completa a cada sync |
| `falcon_nps` | NPS, CSAT, 6 drivers e comentário por cliente/mês | troca completa do ano |
| `falcon_parametros` | ponto de equilíbrio e metas do squad | `chave` |
| `falcon_opportunities` | pipeline comercial | `id` |

`falcon_faturamento` é apagada e reinserida por mês a cada sync, porque
linhas podem ser removidas da planilha. Por isso a chave é a **posição da
linha** (`linha`) e não cliente+discriminação: o mesmo cliente aparece
várias vezes com a mesma descrição no mesmo mês (ex.: Viagem do Sonho
Bispo / Performance Inside Sales, 3× em agosto).


## Instalação do sync de NPS

Mesma receita, mas na **planilha de clientes** (a que tem a aba `NPS - Q2`):
cole [`NPS_Sync.gs`](./NPS_Sync.gs), configure o mesmo `SYNC_TOKEN`, rode
`dryRunNPS`, depois `sincronizarNPS` e `instalarGatilhosNPS`.

Opcionalmente defina `ABA_NPS` com o nome exato da aba. Sem isso o script
procura sozinho a primeira aba que tenha um cabeçalho com `STATUS`, `NPS` e
`CSAT` — então trocar `NPS - Q2` por `NPS - Q3` no fim do trimestre não
quebra nada.

Só as linhas com `SQUAD = FALCON` são sincronizadas.

## Parâmetros do squad

`falcon_parametros` guarda o que hoje está fixo no bloco **PEQUILIBRIO** da
DRE_FALCON e alimenta o medidor de ponto de equilíbrio e a aba de Metas:

| Chave | Valor atual | O que é |
|---|---|---|
| `breakeven_faturamento` | R$ 113.500 | faturamento em que a margem zera |
| `breakeven_folha` | R$ 109.000 | faturamento que põe a folha em 30% |
| `meta_folha_pct` | 27 | meta de % folha |
| `meta_fat_cabeca` | R$ 19.000 | meta de faturamento por pessoa |
| `meta_nps` | 70 | meta de NPS |
| `meta_csat` | 4 | meta de CSAT (escala 1–5) |

Esses valores mudam quando o time muda de tamanho. Hoje são atualizados à
mão (`update falcon_parametros set valor = … where chave = …`); o parser da
DRE ainda não lê o bloco PEQUILIBRIO automaticamente.


## A Edge Function `sync-falcon`

Código em [`edge/sync-falcon.ts`](./edge/sync-falcon.ts), já publicada no
projeto. Recebe um POST com qualquer combinação destas chaves:

```json
{
  "dre":         [ /* linhas de monthly_metrics    */ ],
  "pessoas":     [ /* falcon_pessoas               */ ],
  "faturamento": [ /* falcon_faturamento           */ ],
  "nps":         [ /* falcon_nps                   */ ],
  "parametros":  [ { "chave": "...", "valor": 0 }    ]
}
```

Cada bloco tem a semântica certa embutida: `dre` e `parametros` fazem
upsert; `pessoas` e `nps` são trocados por inteiro; `faturamento` apaga e
reinsere só os meses presentes no payload. Responde
`{ ok: true, resumo: { ... } }` com a contagem do que foi gravado, ou 401
se o token não bater.

Para republicar depois de editar o arquivo, use o MCP do Supabase ou
`supabase functions deploy sync-falcon`.

## O que a chave pública (`anon`) pode fazer

Ela está dentro do `index.html`, então vale tratar como pública. Foi testada:

| Ação | Resultado |
|---|---|
| Ler `monthly_metrics`, `falcon_faturamento`, `falcon_pessoas`, `falcon_nps`, `falcon_parametros` | permitido — é o que o dashboard faz |
| Ler `sync_tokens` | bloqueado |
| Inserir, alterar ou apagar qualquer tabela | bloqueado (RLS só tem política de `SELECT`) |

Vale lembrar que os salários do time são legíveis por quem tiver essa
chave, e o dashboard no Vercel está sem autenticação. Se isso for um
problema, o caminho é pôr proteção de acesso no projeto do Vercel.
