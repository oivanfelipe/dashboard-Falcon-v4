# Sincronização das planilhas → Dashboard

O dashboard (`index.html`, publicado no Vercel) não lê o Google Sheets
diretamente: ele lê o **Supabase**, que funciona como a camada de leitura
rápida. Quem alimenta o Supabase é a planilha.

```
DRE_FALCON (Google Sheets)          Supabase                 index.html
  ├── DRE mensal            ──┐                             (Vercel)
  ├── Investidores Time     ──┼──> monthly_metrics    ──┐
  └── Abas mensais/cliente  ──┤    falcon_pessoas     ──┼──> fetch a cada
                              └──> falcon_faturamento ──┤    3 min + ao
Aba de oportunidades        ─────> falcon_opportunities ─┘    voltar pra aba
```

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
3. *Projeto* → *Configurações* → *Propriedades do script*:

   | Propriedade | Valor |
   |---|---|
   | `SUPABASE_URL` | `https://mzwynanvhojzyoirvxkc.supabase.co` |
   | `SUPABASE_SERVICE_KEY` | a chave `service_role` do projeto |

   A `service_role` fica **só** no Apps Script. O `index.html` usa a chave
   `anon`, que tem permissão apenas de leitura (política RLS `SELECT`).

4. **Rode `dryRun` primeiro.** Ele lê a planilha inteira e escreve tudo no
   log sem gravar nada, inclusive um aviso quando a cascata da DRE
   (faturamento − custos = margem) não fecha. Confira contra a planilha.
5. Se estiver certo: rode `sincronizarTudo` (o Google vai pedir
   autorização) e depois `instalarGatilhos`.

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
cole [`NPS_Sync.gs`](./NPS_Sync.gs), configure `SUPABASE_URL` e
`SUPABASE_SERVICE_KEY`, rode `dryRunNPS`, depois `sincronizarNPS` e
`instalarGatilhosNPS`.

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
