import { useQuery } from 'react-query'
import { useNavigate } from 'react-router-dom'
import { dashboardApi } from '../api/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const SEV_COLORS = { Critical: '#e05252', High: '#f0883e', Medium: '#fbbf24', Low: '#60a5fa', Info: '#6b7899' }

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery('stats', () => dashboardApi.stats().then(r => r.data))
  const navigate = useNavigate()

  if (isLoading) return <div style={s.loading}>Loading dashboard...</div>
  if (!stats) return null

  const sevData = Object.entries(stats.severity_breakdown).map(([name, value]) => ({ name, value }))

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <div style={s.pageTitle}>Dashboard <span style={s.pageSub}>overview</span></div>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{new Date().toDateString()}</div>
      </div>

      <div style={s.statsGrid}>
        {[
          { label: 'Active Engagements', value: stats.active_engagements, sub: `${stats.total_engagements} total`, color: 'var(--blue)' },
          { label: 'Open Findings', value: stats.open_findings, sub: `${stats.total_findings} total`, color: 'var(--red)' },
          { label: 'Critical Open', value: stats.critical_open, sub: 'immediate action', color: 'var(--amber)' },
          { label: 'Remediation Rate', value: stats.remediation_rate + '%', sub: 'findings resolved', color: 'var(--green)' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} style={s.statCard}>
            <div style={s.statLabel}>{label}</div>
            <div style={{ ...s.statValue, color }}>{value}</div>
            <div style={s.statSub}>{sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div style={s.panel}>
          <div style={s.panelHeader}><span style={s.panelTitle}>Severity Breakdown</span></div>
          <div style={{ padding: '16px', height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sevData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 11 }} />
                <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                  {sevData.map((entry) => <Cell key={entry.name} fill={SEV_COLORS[entry.name]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={s.panel}>
          <div style={s.panelHeader}><span style={s.panelTitle}>Recent Findings</span></div>
          <div style={{ padding: '8px 0' }}>
            {stats.recent_findings.length ? stats.recent_findings.map(f => (
              <div key={f.id} onClick={() => navigate(`/findings/${f.id}`)} style={s.recentRow}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: SEV_COLORS[f.severity], flexShrink: 0, display: 'inline-block' }} />
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.title}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{f.ref_id} · {f.severity}</div>
                </div>
              </div>
            )) : <div style={{ padding: 16, color: 'var(--muted)', fontSize: 12 }}>No findings yet</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

const s = {
  page: { padding: 24 },
  loading: { padding: 40, color: 'var(--red)', fontFamily: 'monospace' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  pageTitle: { fontSize: 16, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 },
  pageSub: { fontSize: 12, color: 'var(--muted)', fontWeight: 400 },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 },
  statCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 },
  statLabel: { fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 8 },
  statValue: { fontSize: 26, fontWeight: 700, lineHeight: 1, marginBottom: 4, fontFamily: 'monospace' },
  statSub: { fontSize: 10, color: 'var(--muted)' },
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' },
  panelHeader: { padding: '12px 16px', borderBottom: '1px solid var(--border)' },
  panelTitle: { fontSize: 11, fontWeight: 700, color: 'var(--text)', letterSpacing: '.08em', textTransform: 'uppercase' },
  recentRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', cursor: 'pointer', borderBottom: '1px solid var(--surface2)' },
}
