import { useState } from 'react'
import { useQuery } from 'react-query'
import { useNavigate } from 'react-router-dom'
import { engagementsApi, findingsApi } from '../api/client'
import api from '../api/client'

const SEV_COLOR = { Critical: '#e05252', High: '#f0883e', Medium: '#fbbf24', Low: '#60a5fa', Info: '#6b7899' }
const STATUS_COLOR = { Active: '#4ade80', Planning: '#60a5fa', Completed: '#6b7899', Archived: '#4a5568' }

export default function Management() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState('All')
  const [typeFilter, setTypeFilter] = useState('All')
  const [testerFilter, setTesterFilter] = useState('All')
  const [sortBy, setSortBy] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc')
  const [search, setSearch] = useState('')

  const { data: engagements = [] } = useQuery('engagements-mgmt', () => engagementsApi.list({}).then(r => r.data))
  const { data: findings = [] } = useQuery('findings-mgmt', () => findingsApi.list({}).then(r => r.data))
  const { data: users = [] } = useQuery('users-mgmt', () => api.get('/users/').then(r => r.data))

  const STATUSES = ['All', 'Active', 'Planning', 'Completed', 'Archived']
  const TYPES = ['All', 'Web App', 'Network', 'Red Team', 'Cloud', 'Mobile', 'Physical', 'Social Engineering', 'AI Red Team']

  // Filter
  let filtered = engagements.filter(e => {
    if (statusFilter !== 'All' && e.status !== statusFilter) return false
    if (typeFilter !== 'All' && e.type !== typeFilter) return false
    if (search && !e.name.toLowerCase().includes(search.toLowerCase()) && !e.client.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Sort
  filtered = [...filtered].sort((a, b) => {
    let va = a[sortBy] || ''
    let vb = b[sortBy] || ''
    if (sortBy === 'finding_count' || sortBy === 'critical_count' || sortBy === 'open_count') {
      va = Number(va); vb = Number(vb)
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1
    if (va > vb) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
  }

  function SortIcon({ col }) {
    if (sortBy !== col) return <span style={{ color: 'var(--muted2)', fontSize: 9 }}>⇅</span>
    return <span style={{ color: 'var(--red)', fontSize: 9 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  // Stats
  const totalActive = engagements.filter(e => e.status === 'Active').length
  const totalCritical = engagements.reduce((sum, e) => sum + (e.critical_count || 0), 0)
  const totalOpen = engagements.reduce((sum, e) => sum + (e.open_count || 0), 0)
  const overdue = engagements.filter(e => e.end_date && new Date(e.end_date) < new Date() && e.status === 'Active').length

  // Per-tester stats
  const testerStats = users.map(u => {
    const userFindings = findings.filter(f => f.tester_id === u.id)
    const critical = userFindings.filter(f => f.severity === 'Critical' && f.status === 'Open').length
    const total = userFindings.length
    const remediated = userFindings.filter(f => f.status === 'Remediated').length
    return { ...u, total_findings: total, critical_open: critical, remediation_rate: total ? Math.round(remediated / total * 100) : 0 }
  }).filter(u => u.total_findings > 0)

  // Export CSV
  function exportCSV() {
    const headers = ['Ref', 'Client', 'Name', 'Type', 'Status', 'Findings', 'Critical', 'Open', 'Start Date', 'End Date']
    const rows = filtered.map(e => [
      e.ref_id, e.client, e.name, e.type, e.status,
      e.finding_count, e.critical_count, e.open_count,
      e.start_date?.slice(0, 10) || '', e.end_date?.slice(0, 10) || ''
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'redtrack_engagements.csv'; a.click()
  }

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <div style={s.title}>Management <span style={s.sub}>overview</span></div>
        <button style={s.btn} onClick={exportCSV}>↓ Export CSV</button>
      </div>

      {/* Top stats */}
      <div style={s.statsGrid}>
        {[
          { label: 'Total Engagements', value: engagements.length, color: 'var(--text)' },
          { label: 'Active', value: totalActive, color: '#4ade80' },
          { label: 'Open Critical', value: totalCritical, color: '#e05252' },
          { label: 'Open Findings', value: totalOpen, color: '#f0883e' },
          { label: 'Overdue', value: overdue, color: overdue > 0 ? '#e05252' : 'var(--muted)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={s.statCard}>
            <div style={s.statLabel}>{label}</div>
            <div style={{ ...s.statValue, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={s.filterRow}>
        <input style={s.search} placeholder="Search client or engagement..." value={search} onChange={e => setSearch(e.target.value)} />
        <select style={s.select} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          {STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        <select style={s.select} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          {TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <div style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>{filtered.length} engagements</div>
      </div>

      {/* Status pills */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {STATUSES.map(st => {
          const count = st === 'All' ? engagements.length : engagements.filter(e => e.status === st).length
          return (
            <button key={st} onClick={() => setStatusFilter(st)}
              style={{ ...s.pill, background: statusFilter === st ? (STATUS_COLOR[st] || 'var(--red)') + '22' : 'var(--surface)', color: statusFilter === st ? (STATUS_COLOR[st] || 'var(--red)') : 'var(--muted)', borderColor: statusFilter === st ? (STATUS_COLOR[st] || 'var(--red)') : 'var(--border)' }}>
              {st} <span style={{ marginLeft: 4, opacity: .7 }}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Engagements table */}
      <div style={s.panel}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {[
                ['ref_id', 'ID'], ['client', 'Client'], ['name', 'Engagement'],
                ['type', 'Type'], ['status', 'Status'], ['finding_count', 'Findings'],
                ['critical_count', 'Critical'], ['open_count', 'Open'], ['end_date', 'Due Date']
              ].map(([col, label]) => (
                <th key={col} style={{ ...s.th, cursor: 'pointer' }} onClick={() => toggleSort(col)}>
                  {label} <SortIcon col={col} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', color: 'var(--muted)', padding: 32 }}>No engagements match your filters</td></tr>
            ) : filtered.map(e => {
              const isOverdue = e.end_date && new Date(e.end_date) < new Date() && e.status === 'Active'
              return (
                <tr key={e.id} style={{ cursor: 'pointer', background: isOverdue ? 'var(--red-dim)' : 'transparent' }}
                  onClick={() => navigate(`/engagements/${e.id}`)}>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 10, color: 'var(--blue)' }}>{e.ref_id}</td>
                  <td style={s.td}>{e.client}</td>
                  <td style={s.td}><span style={{ fontSize: 12, fontWeight: 600 }}>{e.name}</span></td>
                  <td style={s.td}><span style={s.tag}>{e.type}</span></td>
                  <td style={s.td}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[e.status] || 'var(--muted)' }}>{e.status}</span>
                  </td>
                  <td style={{ ...s.td, textAlign: 'center', fontFamily: 'monospace' }}>{e.finding_count}</td>
                  <td style={{ ...s.td, textAlign: 'center', fontFamily: 'monospace', color: e.critical_count > 0 ? '#e05252' : 'var(--muted)' }}>{e.critical_count}</td>
                  <td style={{ ...s.td, textAlign: 'center', fontFamily: 'monospace', color: e.open_count > 0 ? '#f0883e' : 'var(--muted)' }}>{e.open_count}</td>
                  <td style={{ ...s.td, fontSize: 10, fontFamily: 'monospace', color: isOverdue ? '#e05252' : 'var(--muted)' }}>
                    {isOverdue && '⚠ '}{e.end_date?.slice(0, 10) || '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Tester stats */}
      {testerStats.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Team Stats</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {testerStats.map(u => (
              <div key={u.id} style={s.testerCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--red-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--red)', flexShrink: 0 }}>
                    {u.full_name?.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{u.full_name}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>@{u.username}</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {[
                    ['Findings', u.total_findings, 'var(--text)'],
                    ['Critical', u.critical_open, '#e05252'],
                    ['Rem. Rate', u.remediation_rate + '%', '#4ade80'],
                  ].map(([label, val, color]) => (
                    <div key={label} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color, fontFamily: 'monospace' }}>{val}</div>
                      <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${u.remediation_rate}%`, background: '#4ade80', borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const s = {
  page: { padding: 24 },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 },
  sub: { fontSize: 12, color: 'var(--muted)', fontWeight: 400 },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 },
  statCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 },
  statLabel: { fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 8 },
  statValue: { fontSize: 26, fontWeight: 700, fontFamily: 'monospace' },
  filterRow: { display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' },
  search: { flex: 1, minWidth: 200, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '7px 12px', fontSize: 12, fontFamily: 'monospace', outline: 'none' },
  select: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '7px 10px', fontSize: 11, fontFamily: 'monospace', outline: 'none', cursor: 'pointer' },
  pill: { border: '1px solid', borderRadius: 5, padding: '4px 12px', fontSize: 10, cursor: 'pointer', fontFamily: 'monospace', fontWeight: 600 },
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 20 },
  th: { fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', userSelect: 'none' },
  td: { padding: '9px 12px', borderBottom: '1px solid var(--surface2)', fontSize: 11, verticalAlign: 'middle', color: 'var(--text)' },
  tag: { background: 'var(--surface2)', color: 'var(--muted)', padding: '2px 7px', borderRadius: 4, fontSize: 10 },
  btn: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  testerCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 },
}
