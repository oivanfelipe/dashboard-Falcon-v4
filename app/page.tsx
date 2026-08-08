'use client'

import { useEffect, useState, useRef } from 'react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell, ComposedChart, Area
} from 'recharts'
import { supabase, MonthlyMetric, FalconClient, FalconOpportunity } from '@/lib/supabase'

// ─── Utils ────────────────────────────────────────────────────────────────────

const fmt = (v: number | null | undefined) => {
  if (v == null) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
}

const fmtPct = (v: number | null | undefined) => {
  if (v == null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

const flagConfig = {
  green: { color: '#00c87a', emoji: '🟢', label: 'Verde' },
  yellow: { color: '#f0a500', emoji: '🟡', label: 'Amarelo' },
  red: { color: '#e03a3a', emoji: '🔴', label: 'Vermelho' },
  na: { color: '#8888aa', emoji: '⚪', label: 'N/A' },
}

const estagioConfig: Record<string, { color: string; bg: string }> = {
  'Identificada': { color: '#8888aa', bg: '#1a1a2e' },
  'Proposta':     { color: '#f0a500', bg: '#2a1f00' },
  'Validada':     { color: '#60a5fa', bg: '#0f1e35' },
  'Ganha':        { color: '#00c87a', bg: '#002a1a' },
  'Perdida':      { color: '#e03a3a', bg: '#2a0a0a' },
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#16161f', border: '1px solid #1e1e2e', borderRadius: 8, padding: '10px 14px' }}>
      <p style={{ color: '#8888aa', fontSize: 11, marginBottom: 6 }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color || '#e0e0f0', fontSize: 13, fontWeight: 500 }}>
          {p.name}: {typeof p.value === 'number' && p.name?.includes('%') ? fmtPct(p.value) : fmt(p.value)}
        </p>
      ))}
    </div>
  )
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: '#16161f', border: '1px solid #1e1e2e', borderRadius: 10,
      padding: '16px 20px', flex: 1, minWidth: 160
    }}>
      <p style={{ color: '#8888aa', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{label}</p>
      <p style={{ color: color || '#e0e0f0', fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>{value}</p>
      {sub && <p style={{ color: '#8888aa', fontSize: 11, marginTop: 4 }}>{sub}</p>}
    </div>
  )
}

// ─── ABA 1: FINANCEIRO ────────────────────────────────────────────────────────

function FinanceiroTab({ metrics }: { metrics: MonthlyMetric[] }) {
  const latest = metrics[metrics.length - 1]
  const prev = metrics[metrics.length - 2]

  const chartData = metrics.map(m => ({
    name: m.month_label,
    faturamento: m.faturamento,
    mrr: m.mrr,
    variavel: m.variavel,
    margem: m.margem_percentual,
    margemValor: m.margem_valor,
    clientes: m.num_clientes,
    fatCabeca: m.fat_cabeca,
    folha: m.percentual_folha,
    isIvan: m.is_ivan_period,
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* KPIs */}
      <div className='kpi-row' style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KpiCard
          label="Faturamento (Ago)"
          value={fmt(latest?.faturamento)}
          sub={prev && latest ? `${latest.faturamento > prev.faturamento ? '+' : ''}${(((latest.faturamento - prev.faturamento) / prev.faturamento) * 100).toFixed(1)}% vs Jul` : undefined}
          color="#e0e0f0"
        />
        <KpiCard
          label="MRR (Ago)"
          value={fmt(latest?.mrr)}
          sub="Meta: R$180.000"
          color="#60a5fa"
        />
        <KpiCard
          label="Variável (Ago)"
          value={fmt(latest?.variavel)}
        />
        <KpiCard
          label="Margem (Ago)"
          value={fmtPct(latest?.margem_percentual)}
          sub={fmt(latest?.margem_valor)}
          color={(latest?.margem_percentual ?? 0) >= 0 ? '#00c87a' : '#e03a3a'}
        />
        <KpiCard
          label="OPS Direta"
          value={fmt(latest?.ops_direta)}
          sub={`${latest?.num_investidores} pessoas`}
        />
        <KpiCard
          label="% Folha"
          value={fmtPct(latest?.percentual_folha)}
          sub="Meta: ≤ 30%"
          color={(latest?.percentual_folha ?? 100) <= 30 ? '#00c87a' : '#f0a500'}
        />
        <KpiCard
          label="Clientes"
          value={String(latest?.num_clientes ?? '—')}
          sub={`Ticket médio: ${fmt(latest?.ticket_medio)}`}
        />
        <KpiCard
          label="FAT / Cabeça"
          value={fmt(latest?.fat_cabeca)}
          sub="(Faturamento ÷ Investidores)"
        />
      </div>

      {/* Marco Ivan */}
      <div style={{
        background: 'linear-gradient(90deg, #1a1200 0%, #111118 100%)',
        border: '1px solid #f0a50033', borderRadius: 8, padding: '10px 16px',
        display: 'flex', alignItems: 'center', gap: 10
      }}>
        <span style={{ color: '#f0a500', fontSize: 20 }}>⚡</span>
        <div>
          <p style={{ color: '#f0a500', fontSize: 12, fontWeight: 600 }}>Marco: Abril/2026 — Ivan assume o Squad Falcon</p>
          <p style={{ color: '#8888aa', fontSize: 11 }}>
            As barras mais claras nos gráficos indicam o período pré-gestão Ivan (Jan–Mar).
          </p>
        </div>
      </div>

      {/* Gráfico: Faturamento */}
      <div style={{ background: '#16161f', border: '1px solid #1e1e2e', borderRadius: 10, padding: '20px 16px' }}>
        <p style={{ color: '#8888aa', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
          Faturamento Mensal — MRR + Variável
        </p>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" />
            <XAxis dataKey="name" tick={{ fill: '#8888aa', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#8888aa', fontSize: 11 }} axisLine={false} tickLine={false}
              tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} width={56} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine x="ABR" stroke="#f0a50055" strokeWidth={2} strokeDasharray="4 4"
              label={{ value: 'Ivan', fill: '#f0a500', fontSize: 10, position: 'top' }} />
            <Bar dataKey="mrr" name="MRR" stackId="a" radius={[0,0,0,0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.isIvan ? '#2a4080' : '#1a2850'} />
              ))}
            </Bar>
            <Bar dataKey="variavel" name="Variável" stackId="a" radius={[4,4,0,0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.isIvan ? '#f0a500' : '#7a5200'} />
              ))}
            </Bar>
            <Line dataKey="faturamento" name="Total" type="monotone"
              stroke="#60a5fa" strokeWidth={2} dot={{ fill: '#60a5fa', r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Gráfico: Margem */}
      <div style={{ background: '#16161f', border: '1px solid #1e1e2e', borderRadius: 10, padding: '20px 16px' }}>
        <p style={{ color: '#8888aa', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
          Margem Percentual (%)
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" />
            <XAxis dataKey="name" tick={{ fill: '#8888aa', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#8888aa', fontSize: 11 }} axisLine={false} tickLine={false}
              tickFormatter={v => `${v}%`} width={48} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="#4a4a6a" />
            <ReferenceLine x="ABR" stroke="#f0a50055" strokeWidth={2} strokeDasharray="4 4" />
            <Bar dataKey="margem" name="Margem %" radius={[4,4,0,0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.margem >= 0 ? '#00c87a' : '#e03a3a'} opacity={d.isIvan ? 1 : 0.5} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Gráfico: Nº Clientes + FAT/Cabeça */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#16161f', border: '1px solid #1e1e2e', borderRadius: 10, padding: '20px 16px' }}>
          <p style={{ color: '#8888aa', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
            Número de Clientes
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" />
              <XAxis dataKey="name" tick={{ fill: '#8888aa', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#8888aa', fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine x="ABR" stroke="#f0a50055" strokeWidth={2} strokeDasharray="4 4" />
              <Line dataKey="clientes" name="Clientes" type="monotone"
                stroke="#a78bfa" strokeWidth={2} dot={{ fill: '#a78bfa', r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background: '#16161f', border: '1px solid #1e1e2e', borderRadius: 10, padding: '20px 16px' }}>
          <p style={{ color: '#8888aa', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
            % Folha vs Meta 30%
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" />
              <XAxis dataKey="name" tick={{ fill: '#8888aa', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#8888aa', fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={v => `${v}%`} width={40} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={30} stroke="#00c87a55" strokeDasharray="4 4"
                label={{ value: 'Meta 30%', fill: '#00c87a', fontSize: 10, position: 'right' }} />
              <ReferenceLine x="ABR" stroke="#f0a50055" strokeWidth={2} strokeDasharray="4 4" />
              <Line dataKey="folha" name="% Folha" type="monotone"
                stroke="#f0a500" strokeWidth={2} dot={{ fill: '#f0a500', r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tabela histórica */}
      <div style={{ background: '#16161f', border: '1px solid #1e1e2e', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #1e1e2e' }}>
          <p style={{ color: '#8888aa', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Histórico Completo</p>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e1e2e' }}>
                {['Mês', 'Faturamento', 'MRR', 'Variável', 'OPS Direta', 'Margem R$', 'Margem %', 'Clientes', 'Invest.', '% Folha'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', color: '#8888aa', textAlign: h === 'Mês' ? 'left' : 'right', fontWeight: 500, ...(h !== 'Mês' ? { whiteSpace: 'nowrap' as const } : {}) }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((m, i) => (
                <tr key={m.id} style={{
                  borderBottom: '1px solid #1e1e2e',
                  background: m.is_ivan_period ? 'transparent' : '#0f0f16',
                }}>
                  <td style={{ padding: '10px 16px', color: '#e0e0f0', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {m.is_ivan_period && <span style={{ color: '#f0a500', marginRight: 6, fontSize: 10 }}>⚡</span>}
                    {m.month_label}/{m.year.toString().slice(2)}
                  </td>
                  <td style={{ padding: '10px 16px', color: '#e0e0f0', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(m.faturamento)}</td>
                  <td style={{ padding: '10px 16px', color: '#60a5fa', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(m.mrr)}</td>
                  <td style={{ padding: '10px 16px', color: '#f0a500', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(m.variavel)}</td>
                  <td style={{ padding: '10px 16px', color: '#8888aa', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(m.ops_direta)}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'monospace',
                    color: m.margem_valor >= 0 ? '#00c87a' : '#e03a3a' }}>{fmt(m.margem_valor)}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'monospace',
                    color: m.margem_percentual >= 0 ? '#00c87a' : '#e03a3a',
                    fontWeight: 700 }}>{fmtPct(m.margem_percentual)}</td>
                  <td style={{ padding: '10px 16px', color: '#e0e0f0', textAlign: 'right' }}>{m.num_clientes}</td>
                  <td style={{ padding: '10px 16px', color: '#8888aa', textAlign: 'right' }}>{m.num_investidores}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'monospace',
                    color: m.percentual_folha <= 30 ? '#00c87a' : m.percentual_folha <= 40 ? '#f0a500' : '#e03a3a' }}>
                    {fmtPct(m.percentual_folha)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── ABA 2: CLIENTES ──────────────────────────────────────────────────────────

function ClientesTab({ clients }: { clients: FalconClient[] }) {
  const [filter, setFilter] = useState<string>('all')

  const flagCounts = {
    all: clients.length,
    green: clients.filter(c => c.flag === 'green').length,
    yellow: clients.filter(c => c.flag === 'yellow').length,
    red: clients.filter(c => c.flag === 'red').length,
    na: clients.filter(c => c.flag === 'na').length,
  }

  const filtered = filter === 'all' ? clients : clients.filter(c => c.flag === filter)
  const totalFee = clients.reduce((sum, c) => sum + (c.fee || 0), 0)
  const totalMidiaProj = clients.reduce((sum, c) => sum + (c.midia_projetado || 0), 0)
  const totalMidiaUtil = clients.reduce((sum, c) => sum + (c.midia_utilizado || 0), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Resumo flags */}
      <div className='kpi-row' style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: 'Todos', count: flagCounts.all, color: '#e0e0f0' },
          { key: 'green', label: '🟢 Saudável', count: flagCounts.green, color: '#00c87a' },
          { key: 'yellow', label: '🟡 Atenção', count: flagCounts.yellow, color: '#f0a500' },
          { key: 'red', label: '🔴 Crítico', count: flagCounts.red, color: '#e03a3a' },
          { key: 'na', label: '⚪ N/A', count: flagCounts.na, color: '#8888aa' },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            style={{
              background: filter === f.key ? '#1e1e2e' : '#16161f',
              border: `1px solid ${filter === f.key ? f.color + '66' : '#1e1e2e'}`,
              borderRadius: 8, padding: '10px 16px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8
            }}>
            <span style={{ color: f.color, fontSize: 20, fontWeight: 700 }}>{f.count}</span>
            <span style={{ color: '#8888aa', fontSize: 12 }}>{f.label}</span>
          </button>
        ))}
        <div style={{ flex: 1, minWidth: 200 }}>
          <KpiCard label="MRR Total (fee)" value={fmt(totalFee)} sub={`${clients.length} clientes`} />
        </div>
      </div>

      {/* Investimento em mídia summary */}
      <div style={{ display: 'flex', gap: 12 }}>
        <KpiCard label="Mídia Projetada (Ago)" value={fmt(totalMidiaProj)} />
        <KpiCard label="Mídia Utilizada (Ago)" value={fmt(totalMidiaUtil)}
          sub={`${totalMidiaProj > 0 ? ((totalMidiaUtil / totalMidiaProj) * 100).toFixed(1) : 0}% do projetado`}
          color={totalMidiaUtil / totalMidiaProj > 0.5 ? '#00c87a' : '#f0a500'} />
      </div>

      {/* Grid de clientes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {filtered.map(c => {
          const flag = flagConfig[c.flag] || flagConfig.na
          const midiaUtil = c.midia_projetado > 0 ? (c.midia_utilizado / c.midia_projetado) * 100 : null

          return (
            <div key={c.id} style={{
              background: '#16161f',
              border: `1px solid ${flag.color}33`,
              borderLeft: `3px solid ${flag.color}`,
              borderRadius: 10, padding: '16px 18px',
              display: 'flex', flexDirection: 'column', gap: 10
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <p style={{ color: '#e0e0f0', fontWeight: 700, fontSize: 15 }}>{c.cliente}</p>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    {c.tier && (
                      <span style={{
                        background: '#1e1e2e', color: '#8888aa', fontSize: 10,
                        padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase'
                      }}>{c.tier}</span>
                    )}
                    {c.modelo_negocio && (
                      <span style={{
                        background: '#1e1e2e', color: '#8888aa', fontSize: 10,
                        padding: '2px 6px', borderRadius: 4
                      }}>{c.modelo_negocio}</span>
                    )}
                  </div>
                </div>
                <span style={{ fontSize: 22 }}>{flag.emoji}</span>
              </div>

              {/* Fee */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#8888aa', fontSize: 12 }}>Fee</span>
                <span style={{ color: '#e0e0f0', fontWeight: 600, fontFamily: 'monospace' }}>{fmt(c.fee)}</span>
              </div>

              {/* Time */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {c.gp && <Tag label={`GP: ${c.gp}`} color="#60a5fa" />}
                {c.trafego && <Tag label={`Tráfego: ${c.trafego}`} color="#a78bfa" />}
                {c.social && <Tag label={`Social: ${c.social}`} color="#34d399" />}
                {c.designer && <Tag label={`Design: ${c.designer}`} color="#f472b6" />}
              </div>

              {/* Mídia */}
              {(c.midia_projetado > 0 || c.midia_utilizado > 0) && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#8888aa', fontSize: 11 }}>Mídia Utilizada</span>
                    <span style={{ color: '#8888aa', fontSize: 11 }}>
                      {fmt(c.midia_utilizado)} / {fmt(c.midia_projetado)}
                      {midiaUtil != null && ` (${midiaUtil.toFixed(0)}%)`}
                    </span>
                  </div>
                  {midiaUtil != null && (
                    <div style={{ background: '#1e1e2e', borderRadius: 4, height: 4 }}>
                      <div style={{
                        width: `${Math.min(midiaUtil, 100)}%`, height: '100%',
                        background: midiaUtil > 70 ? '#00c87a' : midiaUtil > 30 ? '#f0a500' : '#e03a3a',
                        borderRadius: 4, transition: 'width 0.5s'
                      }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      background: color + '15', border: `1px solid ${color}33`,
      color, fontSize: 11, padding: '2px 8px', borderRadius: 20
    }}>{label}</span>
  )
}

// ─── ABA 3: OPORTUNIDADES ─────────────────────────────────────────────────────

function OportunidadesTab({ opportunities }: { opportunities: FalconOpportunity[] }) {
  const [filterEstagio, setFilterEstagio] = useState<string>('all')

  const filtered = filterEstagio === 'all' ? opportunities : opportunities.filter(o => o.estagio === filterEstagio)

  const estagios = ['Identificada', 'Proposta', 'Validada', 'Ganha', 'Perdida']
  const estagioCount = Object.fromEntries(estagios.map(e => [e, opportunities.filter(o => o.estagio === e).length]))

  const pipeline = opportunities
    .filter(o => o.estagio !== 'Perdida' && o.valor_proposta)
    .reduce((sum, o) => sum + (o.valor_proposta || 0), 0)

  const ganho = opportunities
    .filter(o => o.estagio === 'Ganha' && o.valor_fechamento)
    .reduce((sum, o) => sum + (o.valor_fechamento || 0), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* KPIs pipeline */}
      <div className='kpi-row' style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KpiCard label="Pipeline Ativo" value={fmt(pipeline)} sub="excl. perdidas" color="#f0a500" />
        <KpiCard label="Receita Ganha" value={fmt(ganho)} color="#00c87a" />
        <KpiCard label="Total Oportunidades" value={String(opportunities.length)} sub={`${opportunities.filter(o => o.estagio !== 'Perdida').length} ativas`} />
      </div>

      {/* Filtro por estágio */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setFilterEstagio('all')}
          style={{
            background: filterEstagio === 'all' ? '#1e1e2e' : '#16161f',
            border: `1px solid ${filterEstagio === 'all' ? '#e0e0f033' : '#1e1e2e'}`,
            color: '#e0e0f0', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12
          }}>
          Todos ({opportunities.length})
        </button>
        {estagios.map(e => {
          const cfg = estagioConfig[e]
          return (
            <button key={e} onClick={() => setFilterEstagio(e)}
              style={{
                background: filterEstagio === e ? cfg.bg : '#16161f',
                border: `1px solid ${filterEstagio === e ? cfg.color + '66' : '#1e1e2e'}`,
                color: cfg.color, borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12
              }}>
              {e} ({estagioCount[e]})
            </button>
          )
        })}
      </div>

      {/* Lista de oportunidades */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(o => {
          const cfg = estagioConfig[o.estagio] || estagioConfig['Identificada']
          return (
            <div key={o.id} style={{
              background: '#16161f', border: `1px solid #1e1e2e`,
              borderLeft: `3px solid ${cfg.color}`,
              borderRadius: 8, padding: '14px 18px',
              display: 'grid', gridTemplateColumns: '1fr auto',
              gap: 12, alignItems: 'start'
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ color: '#e0e0f0', fontWeight: 600 }}>{o.cliente}</span>
                  <span style={{ color: '#8888aa', fontSize: 12 }}>→</span>
                  <span style={{ color: '#e0e0f0' }}>{o.oportunidade}</span>
                  {o.produto && (
                    <span style={{
                      background: '#1e1e2e', color: '#8888aa', fontSize: 10,
                      padding: '2px 6px', borderRadius: 4
                    }}>{o.produto}</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {o.responsavel && (
                    <span style={{ color: '#8888aa', fontSize: 12 }}>👤 {o.responsavel}</span>
                  )}
                  {o.proximo_passo && (
                    <span style={{ color: '#8888aa', fontSize: 12 }}>→ {o.proximo_passo}</span>
                  )}
                  {o.data_prevista && (
                    <span style={{ color: '#8888aa', fontSize: 12 }}>📅 {o.data_prevista}</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                <span style={{
                  background: cfg.bg, color: cfg.color, fontSize: 11,
                  padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap', fontWeight: 600
                }}>{o.estagio}</span>
                {o.valor_proposta && (
                  <span style={{ color: '#e0e0f0', fontFamily: 'monospace', fontWeight: 600, fontSize: 14 }}>
                    {fmt(o.valor_proposta)}
                  </span>
                )}
                {o.valor_fechamento && o.estagio === 'Ganha' && (
                  <span style={{ color: '#00c87a', fontSize: 11 }}>✓ {fmt(o.valor_fechamento)}</span>
                )}
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <p style={{ color: '#8888aa', textAlign: 'center', padding: 40 }}>Nenhuma oportunidade encontrada.</p>
        )}
      </div>
    </div>
  )
}

// ─── CHAT WIDGET ─────────────────────────────────────────────────────────────

type Message = { role: 'user' | 'assistant'; content: string }

function ChatWidget({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Olá! Sou o Falcon AI. Posso analisar os dados do squad, comparar meses, calcular projeções e dar insights estratégicos. Como posso ajudar?' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    if (!input.trim() || loading) return
    const userMsg: Message = { role: 'user', content: input }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages, userMsg] }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.content || data.error || 'Erro.' }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Erro de conexão.' }])
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div style={{
      position: 'fixed', right: 0, top: 0, bottom: 0, width: 380,
      background: '#111118', borderLeft: '1px solid #1e1e2e',
      display: 'flex', flexDirection: 'column', zIndex: 100,
      boxShadow: '-8px 0 32px #00000066'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid #1e1e2e',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🦅</span>
          <div>
            <p style={{ color: '#e0e0f0', fontWeight: 600, fontSize: 14 }}>Falcon AI</p>
            <p style={{ color: '#00c87a', fontSize: 10 }}>● Online</p>
          </div>
        </div>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#8888aa', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>

      {/* Messages */}
      <div className="chat-messages" style={{ flex: 1, overflowY: 'auto', padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex', flexDirection: m.role === 'user' ? 'row-reverse' : 'row', gap: 8
          }}>
            <div style={{
              maxWidth: '85%',
              background: m.role === 'user' ? '#1e2a4a' : '#16161f',
              border: `1px solid ${m.role === 'user' ? '#2a3a6a' : '#1e1e2e'}`,
              borderRadius: m.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              padding: '10px 14px',
              color: '#e0e0f0', fontSize: 13, lineHeight: 1.6,
              whiteSpace: 'pre-wrap'
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{
              background: '#16161f', border: '1px solid #1e1e2e',
              borderRadius: '12px 12px 12px 2px', padding: '10px 14px',
              color: '#8888aa', fontSize: 13
            }}>
              <span style={{ animation: 'pulse 1s infinite' }}>Analisando...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #1e1e2e' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Pergunte sobre o squad..."
            style={{
              flex: 1, background: '#16161f', border: '1px solid #1e1e2e',
              borderRadius: 8, padding: '10px 14px', color: '#e0e0f0',
              fontSize: 13, outline: 'none'
            }}
          />
          <button onClick={send} disabled={loading || !input.trim()}
            style={{
              background: input.trim() && !loading ? '#f0a500' : '#1e1e2e',
              border: 'none', borderRadius: 8, padding: '10px 16px',
              cursor: input.trim() && !loading ? 'pointer' : 'default',
              color: input.trim() && !loading ? '#000' : '#4a4a6a',
              fontWeight: 700, fontSize: 14, transition: 'all 0.2s'
            }}>
            ↑
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function Page() {
  const [tab, setTab] = useState<'financeiro' | 'clientes' | 'oportunidades'>('financeiro')
  const [chatOpen, setChatOpen] = useState(false)
  const [metrics, setMetrics] = useState<MonthlyMetric[]>([])
  const [clients, setClients] = useState<FalconClient[]>([])
  const [opps, setOpps] = useState<FalconOpportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const loadData = async () => {
    setLoading(true)
    const [{ data: m }, { data: c }, { data: o }] = await Promise.all([
      supabase.from('monthly_metrics').select('*').order('month_order'),
      supabase.from('falcon_clients').select('*').order('fee', { ascending: false }),
      supabase.from('falcon_opportunities').select('*').order('created_at', { ascending: false }),
    ])
    if (m) setMetrics(m)
    if (c) setClients(c)
    if (o) setOpps(o)
    setLastRefresh(new Date())
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const tabs = [
    { id: 'financeiro', label: '📊 Financeiro', desc: 'DRE & Margem' },
    { id: 'clientes', label: '🦅 Clientes', desc: `${clients.length} ativos` },
    { id: 'oportunidades', label: '💰 Pipeline', desc: `${opps.length} oports.` },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f' }}>
      {/* Header */}
      <header className="dash-header" style={{
        background: '#111118', borderBottom: '1px solid #1e1e2e',
        padding: '0 32px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', height: 64, position: 'sticky', top: 0, zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            background: 'linear-gradient(135deg, #f0a500, #e05a00)',
            borderRadius: 8, width: 36, height: 36,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18
          }}>🦅</div>
          <div>
            <p style={{ color: '#e0e0f0', fontWeight: 700, fontSize: 16, lineHeight: 1.2 }}>FALCON</p>
            <p style={{ color: '#8888aa', fontSize: 11 }}>Squad Dashboard · V4 Company</p>
          </div>
        </div>

        <div className="dash-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <p style={{ color: '#4a4a6a', fontSize: 11 }}>
            Atualizado {lastRefresh.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <button onClick={loadData}
            style={{
              background: '#16161f', border: '1px solid #1e1e2e',
              borderRadius: 6, padding: '6px 12px', color: '#8888aa',
              cursor: 'pointer', fontSize: 12
            }}>
            ↻ Refresh
          </button>
          <button onClick={() => setChatOpen(!chatOpen)}
            style={{
              background: chatOpen ? '#f0a500' : 'linear-gradient(135deg, #f0a500, #e05a00)',
              border: 'none', borderRadius: 8, padding: '8px 16px',
              color: '#000', fontWeight: 700, cursor: 'pointer', fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 6
            }}>
            🦅 Falcon AI
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="dash-tabs" style={{
        background: '#111118', borderBottom: '1px solid #1e1e2e',
        padding: '0 32px', display: 'flex', gap: 0
      }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)} className="dash-tab-btn"
            style={{
              background: 'none', border: 'none',
              borderBottom: tab === t.id ? '2px solid #f0a500' : '2px solid transparent',
              padding: '14px 24px', cursor: 'pointer',
              display: 'flex', gap: 8, alignItems: 'center'
            }}>
            <span style={{ color: tab === t.id ? '#f0a500' : '#8888aa', fontSize: 13, fontWeight: tab === t.id ? 600 : 400 }}>
              {t.label}
            </span>
            <span style={{
              background: '#1e1e2e', color: '#8888aa',
              fontSize: 10, padding: '1px 6px', borderRadius: 10
            }}>{t.desc}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <main className="dash-content" style={{
        padding: '28px 32px',
        paddingRight: chatOpen ? 412 : 32,
        maxWidth: chatOpen ? '100%' : 1400,
        transition: 'padding-right 0.3s'
      }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#8888aa' }}>
            <p style={{ fontSize: 24, marginBottom: 12 }}>🦅</p>
            <p>Carregando dados do squad...</p>
          </div>
        ) : (
          <>
            {tab === 'financeiro' && <FinanceiroTab metrics={metrics} />}
            {tab === 'clientes' && <ClientesTab clients={clients} />}
            {tab === 'oportunidades' && <OportunidadesTab opportunities={opps} />}
          </>
        )}
      </main>

      {/* Chat */}
      <ChatWidget open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  )
}
