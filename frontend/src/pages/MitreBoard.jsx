import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import api from '../api/client'
import toast from 'react-hot-toast'

const STATUSES = ['Not Started', 'In Progress', 'Tested', 'Successful', 'Failed', 'N/A']
const STATUS_COLOR = {
  'Not Started': { bg: 'var(--surface2)', border: 'var(--border)', text: 'var(--muted)' },
  'In Progress': { bg: 'var(--amber-dim)', border: '#f0883e55', text: '#f0883e' },
  'Tested':      { bg: 'var(--blue-dim)', border: '#60a5fa55', text: '#60a5fa' },
  'Successful':  { bg: 'var(--green-dim)', border: '#4ade8055', text: '#4ade80' },
  'Failed':      { bg: 'var(--red-dim)', border: '#e0525255', text: '#e05252' },
  'N/A':         { bg: 'var(--surface3)', border: 'var(--border)', text: 'var(--muted2)' },
}

export default function MitreBoard({ engagementId, findings = [], users = [] }) {
  const qc = useQueryClient()
  const fileRef = useRef()
  const [expandedCard, setExpandedCard] = useState(null)
  const [dragCard, setDragCard] = useState(null)
  const [filterStatus, setFilterStatus] = useState('All')
  const [filterAssignee, setFilterAssignee] = useState('All')
  const [search, setSearch] = useState('')

  const { data: allUsers = [] } = useQuery(
    'users',
    () => api.get('/users/').then(r => r.data)
  )

  const { data: techniques = [], isLoading } = useQuery(
    ['mitre-techniques', engagementId],
    () => api.get(`/mitre/${engagementId}/techniques`).then(r => r.data),
    { enabled: !!engagementId }
  )

  const updateMutation = useMutation(
    ({ id, data }) => api.patch(`/mitre/techniques/${id}`, data),
    { onSuccess: () => qc.invalidateQueries(['mitre-techniques', engagementId]) }
  )

  const importMutation = useMutation(
    (data) => api.post(`/mitre/${engagementId}/import`, data),
    {
      onSuccess: (res) => {
        qc.invalidateQueries(['mitre-techniques', engagementId])
        toast.success(`Imported ${res.data.count} techniques from Navigator layer`)
      },
      onError: () => toast.error('Import failed — check the JSON format'),
    }
  )

  const deleteMutation = useMutation(
    () => api.delete(`/mitre/${engagementId}/techniques`),
    {
      onSuccess: () => {
        qc.invalidateQueries(['mitre-techniques', engagementId])
        toast.success('Board cleared')
      }
    }
  )

  function handleFileImport(file) {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result)
        importMutation.mutate(json)
      } catch {
        toast.error('Invalid JSON file')
      }
    }
    reader.readAsText(file)
  }

  function exportNavigatorLayer() {
    if (!techniques.length) { toast.error('No techniques to export'); return }
    const colorMap = { 'Successful': '#4ade80', 'Failed': '#e05252', 'In Progress': '#f0883e', 'Tested': '#60a5fa', 'Not Started': '#cccccc', 'N/A': '#888888' }
    const layer = {
      name: `RedTrack Export`,
      versions: { attack: '14', navigator: '4.9', layer: '4.5' },
      domain: 'enterprise-attack',
      description: `Exported from RedTrack`,
      techniques: techniques.map(t => ({
        techniqueID: t.technique_id,
        tactic: t.tactic?.toLowerCase().replace(/ /g, '-'),
        color: colorMap[t.status] || '#cccccc',
        comment: t.notes || '',
        enabled: true,
        metadata: [{ name: 'assignee', value: t.assignee || '' }, { name: 'status', value: t.status }],
      })),
    }
    const blob = new Blob([JSON.stringify(layer, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `redtrack_mitre_layer.json`
    a.click()
    toast.success('Navigator layer exported')
  }

  // Group techniques by tactic
  const tactics = [...new Set(techniques.map(t => t.tactic))].filter(Boolean)

  const filtered = techniques.filter(t => {
    if (filterStatus !== 'All' && t.status !== filterStatus) return false
    if (filterAssignee !== 'All' && t.assignee !== filterAssignee) return false
    if (search && !t.technique_id?.toLowerCase().includes(search.toLowerCase()) && !t.name?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const byTactic = (tactic) => filtered.filter(t => t.tactic === tactic)

  // Stats
  const stats = STATUSES.reduce((acc, s) => { acc[s] = techniques.filter(t => t.status === s).length; return acc }, {})

  function handleDragStart(technique) { setDragCard(technique) }
  function handleDrop(newStatus) {
    if (!dragCard || dragCard.status === newStatus) return
    updateMutation.mutate({ id: dragCard.id, data: { status: newStatus } })
    setDragCard(null)
  }

  if (isLoading) return <div style={{ padding: 20, color: 'var(--muted)', fontSize: 12 }}>Loading MITRE board...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={s.search} placeholder="Search techniques..." value={search} onChange={e => setSearch(e.target.value)} />
        <select style={s.select} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="All">All Statuses</option>
          {STATUSES.map(st => <option key={st}>{st}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <label style={s.btnPrimary}>
          ↑ Import Navigator JSON
          <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) handleFileImport(e.target.files[0]) }} />
        </label>
        {techniques.length > 0 && (
          <>
            <button style={s.btn} onClick={exportNavigatorLayer}>↓ Export Layer</button>
            <button style={{ ...s.btn, color: 'var(--red)', borderColor: 'var(--red-mid)' }}
              onClick={() => { if (confirm('Clear all techniques?')) deleteMutation.mutate() }}>
              Clear
            </button>
          </>
        )}
      </div>

      {/* Stats bar */}
      {techniques.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={s.statPill}>Total: <strong>{techniques.length}</strong></div>
          {Object.entries(stats).filter(([, v]) => v > 0).map(([status, count]) => (
            <div key={status} style={{ ...s.statPill, color: STATUS_COLOR[status].text, borderColor: STATUS_COLOR[status].border, background: STATUS_COLOR[status].bg }}>
              {status}: <strong>{count}</strong>
            </div>
          ))}
        </div>
      )}

      {techniques.length === 0 ? (
        <div style={s.emptyBox}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🎯</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>No techniques imported yet</div>
          <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 20, lineHeight: 1.7 }}>
            1. Open <a href="https://mitre-attack.github.io/attack-navigator/" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>MITRE ATT&CK Navigator</a><br />
            2. Select techniques for this engagement<br />
            3. File → Export Layer → Download JSON<br />
            4. Import the JSON file above
          </div>
          <label style={{ ...s.btnPrimary, cursor: 'pointer' }}>
            ↑ Import Navigator JSON
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) handleFileImport(e.target.files[0]) }} />
          </label>
        </div>
      ) : (
        /* Tactic columns */
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 12, minWidth: 'max-content', alignItems: 'flex-start' }}>
            {tactics.map(tactic => (
              <div key={tactic} style={s.tacticCol}>
                <div style={s.tacticHeader}>
                  <span style={s.tacticTitle}>{tactic}</span>
                  <span style={s.tacticCount}>{byTactic(tactic).length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {STATUSES.map(status => {
                    const cards = byTactic(tactic).filter(t => t.status === status)
                    if (cards.length === 0 && filterStatus !== 'All') return null
                    return (
                      <div key={status}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => handleDrop(status)}
                        style={{ minHeight: 8 }}>
                        {cards.map(t => (
                          <TechniqueCard
                            key={t.id}
                            technique={t}
                            findings={findings}
                            users={users}
                            expanded={expandedCard === t.id}
                            onExpand={() => setExpandedCard(expandedCard === t.id ? null : t.id)}
                            onUpdate={(data) => updateMutation.mutate({ id: t.id, data })}
                            onDragStart={() => handleDragStart(t)}
                            users={allUsers}
                          />
                        ))}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TechniqueCard({ technique, findings, users = [], expanded, onExpand, onUpdate, onDragStart }) {
  const sc = STATUS_COLOR[technique.status] || STATUS_COLOR['Not Started']
  const linkedFindings = findings.filter(f => f.mitre_atlas_ttp === technique.technique_id || f.tags?.includes(technique.technique_id))

  return (
    <div draggable onDragStart={onDragStart}
      style={{ ...cs.card, borderColor: sc.border, cursor: 'grab', marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }} onClick={onExpand}>
        <span style={{ ...cs.techId, color: sc.text }}>{technique.technique_id}</span>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--text)', lineHeight: 1.2 }}>{technique.name}</span>
        <span style={{ fontSize: 10 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: expanded ? 8 : 0 }}>
        <span style={{ ...cs.statusBadge, background: sc.bg, color: sc.text, borderColor: sc.border }}>{technique.status}</span>
        {technique.assignee && <span style={cs.assigneeBadge}>{technique.assignee}</span>}
        {linkedFindings.length > 0 && <span style={{ ...cs.assigneeBadge, color: 'var(--blue)', borderColor: '#60a5fa55' }}>🔗 {linkedFindings.length}</span>}
      </div>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <div>
            <div style={cs.fieldLabel}>Status</div>
            <select style={cs.input} value={technique.status} onChange={e => onUpdate({ status: e.target.value })}>
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <div style={cs.fieldLabel}>Assignee</div>
            <select style={cs.input} value={technique.assignee || ''} onChange={e => onUpdate({ assignee: e.target.value })}>
              <option value="">— Unassigned —</option>
              {users.map(u => (
                <option key={u.id} value={u.username}>@{u.username} ({u.full_name})</option>
              ))}
            </select>
          </div>
          <div>
            <div style={cs.fieldLabel}>Notes / Results</div>
            <textarea style={{ ...cs.input, minHeight: 60, resize: 'vertical' }} value={technique.notes || ''} onChange={e => onUpdate({ notes: e.target.value })} placeholder="What did you try? What was the result?" />
          </div>
          {linkedFindings.length > 0 && (
            <div>
              <div style={cs.fieldLabel}>Linked Findings</div>
              {linkedFindings.map(f => (
                <div key={f.id} style={{ fontSize: 10, color: 'var(--blue)', fontFamily: 'monospace', marginBottom: 2 }}>
                  {f.ref_id} — {f.title}
                </div>
              ))}
            </div>
          )}
          <a href={`https://attack.mitre.org/techniques/${technique.technique_id}/`} target="_blank" rel="noreferrer"
            style={{ fontSize: 10, color: 'var(--muted)', textDecoration: 'none' }}>
            ↗ View on MITRE ATT&CK
          </a>
        </div>
      )}
    </div>
  )
}

const s = {
  search: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '7px 12px', fontSize: 12, fontFamily: 'monospace', outline: 'none', width: 200 },
  select: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '7px 10px', fontSize: 11, fontFamily: 'monospace', outline: 'none', cursor: 'pointer' },
  btn: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnPrimary: { background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace', display: 'inline-block' },
  statPill: { fontSize: 11, padding: '3px 10px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)' },
  emptyBox: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 40, textAlign: 'center', color: 'var(--text)' },
  tacticCol: { width: 220, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', flexShrink: 0 },
  tacticHeader: { padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface2)' },
  tacticTitle: { fontSize: 10, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.08em' },
  tacticCount: { fontSize: 10, color: 'var(--muted)', background: 'var(--surface)', padding: '1px 6px', borderRadius: 8 },
}

const cs = {
  card: { background: 'var(--surface2)', border: '1px solid', borderRadius: 6, padding: 10, margin: '0 8px 0 8px' },
  techId: { fontSize: 9, fontFamily: 'monospace', fontWeight: 700 },
  statusBadge: { fontSize: 9, padding: '1px 6px', borderRadius: 3, border: '1px solid', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' },
  assigneeBadge: { fontSize: 9, padding: '1px 6px', borderRadius: 3, border: '1px solid var(--border)', color: 'var(--muted)', background: 'var(--surface)' },
  fieldLabel: { fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 4, fontWeight: 700 },
  input: { width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 4, color: 'var(--text)', padding: '5px 8px', fontSize: 11, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' },
}
