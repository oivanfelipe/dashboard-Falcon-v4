import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type MonthlyMetric = {
  id: number
  month_label: string
  month_order: number
  year: number
  faturamento: number
  mrr: number
  variavel: number
  inadimplentes: number
  ops_direta: number
  royalties_imposto: number
  margem_valor: number
  margem_percentual: number
  num_clientes: number
  ticket_medio: number
  num_investidores: number
  fat_cabeca: number
  percentual_folha: number
  is_ivan_period: boolean
}

export type FalconClient = {
  id: number
  cliente: string
  tier: string | null
  flag: 'green' | 'yellow' | 'red' | 'na'
  fee: number
  gp: string | null
  social: string | null
  trafego: string | null
  designer: string | null
  midia_projetado: number
  midia_utilizado: number
  modelo_negocio: string | null
  fase: string
}

export type FalconOpportunity = {
  id: number
  cliente: string
  oportunidade: string
  produto: string | null
  estagio: 'Identificada' | 'Proposta' | 'Validada' | 'Ganha' | 'Perdida'
  valor_proposta: number | null
  valor_fechamento: number | null
  responsavel: string | null
  proximo_passo: string | null
  data_prevista: string | null
  observacoes: string | null
  created_at: string
}
