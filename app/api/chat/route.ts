import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'

const SYSTEM_PROMPT = `Você é o Falcon AI, assistente de análise de performance do Squad Falcon da V4 Company.

Você tem acesso aos seguintes dados do squad (agosto/2026):

FINANCEIRO (DRE - Jan a Ago/2026):
- JAN: Fat R$47.726 | Margem -137,71% | 8 clientes | 6 investidores
- FEV: Fat R$47.671 | Margem -43,05% | 7 clientes | 5 investidores
- MAR: Fat R$41.685 | Margem -100,81% | 8 clientes | 5 investidores
- ABR: Fat R$78.451 | Margem -28,24% | 10 clientes | 7 investidores [IVAN ASSUME]
- MAI: Fat R$74.760 | Margem -28,21% | 10 clientes | 6 investidores
- JUN: Fat R$114.949 | Margem +8,34% | 17 clientes | 6 investidores
- JUL: Fat R$100.556 | Margem +2,44% | 20 clientes | 7 investidores
- AGO: Fat R$101.468 | Margem -5,68% | 20 clientes | 7 investidores

CLIENTES ATIVOS (Agosto):
- Drogalis (🟡 Yellow) | Fee R$7.332 | GP: Thayla | Tráfego: Igor
- Official Time (🟡 Yellow) | Fee R$7.500 | GP: Thayla
- PetTreats (🟡 Yellow) | Fee R$8.500 | GP: Thayla
- GSC Segurança (🟡 Yellow) | Fee R$5.150 | GP: Thayla
- Clube da Casa (🟢 Green) | Fee R$5.855 | GP: Thayla
- Super Carros (🟢 Green) | Fee R$5.500 | GP: Ivan
- MasterMed (🔴 Red) | Fee R$7.000 | GP: Thayla
- Miyamura (🟡 Yellow) | Fee R$3.500 | GP: Thayla
- TB Rio (🟡 Yellow) | Fee R$7.500 | GP: Thayla
- Positive SEO (⚪ n/a) | Fee R$3.618 | GP: Ivan
- A.Dias (🟡 Yellow) | Fee R$1.735
- Alice Salazar (🟢 Green) | Fee R$5.084 | GP: Luma
- Nagaura (🟡 Yellow) | Fee R$4.000 | GP: Luma
- Point Thermic (🟡 Yellow) | Fee R$4.725 | GP: Luma

TIME:
- Ivan (Coordenador) — R$9.500
- Thayla (Account) — 8 contas
- Luma (Account) — 3 contas
- Igor (Gestor de Tráfego)
- Iris (Social Media)
- Alexandra (Designer)

OKRs:
- MRR atual: R$79.434 | Meta MRR: R$180.000
- % Clientes c/ ROI: meta 40%
- Logo Churn: meta < 3%

Responda de forma direta, analítica e estratégica. Use dados reais. Seja conciso.
Quando fizer análises, compare com benchmarks e mostre o caminho de ação.
Fale em português do Brasil.`

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'GROQ_API_KEY não configurada.' }, { status: 500 })
    }

    const groq = new Groq({ apiKey })
    const { messages } = await req.json()

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages,
      ],
      max_tokens: 1024,
      temperature: 0.3,
    })

    const content = response.choices[0]?.message?.content || 'Sem resposta.'
    return NextResponse.json({ content })
  } catch (error) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: 'Erro ao processar mensagem' }, { status: 500 })
  }
}
