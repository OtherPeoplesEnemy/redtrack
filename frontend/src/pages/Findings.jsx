import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import { useNavigate } from 'react-router-dom'
import { findingsApi, engagementsApi } from '../api/client'
import toast from 'react-hot-toast'
import MarkdownEditor from '../components/MarkdownEditor'

const SEV_COLOR = { Critical: '#e05252', High: '#f0883e', Medium: '#fbbf24', Low: '#60a5fa', Info: '#6b7899' }
const SEV_DIM = { Critical: 'var(--red-dim)', High: 'var(--amber-dim)', Medium: '#3d3010', Low: 'var(--blue-dim)', Info: 'var(--surface3)' }
const SEVERITIES = ['All', 'Critical', 'High', 'Medium', 'Low', 'Info']
const STATUSES = ['All', 'Open', 'In Review', 'Remediated', 'Accepted', 'False Positive']

export default function Findings() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [sevFilter, setSevFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [engFilter, setEngFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ title: '', severity: 'High', engagement_id: '', cvss_score: '', cwe: '', affected_component: '', description: '', impact: '', remediation: '' })
  const [pendingFiles, setPendingFiles] = useState([])

  const { data: findings = [], isLoading } = useQuery(
    ['findings', sevFilter, statusFilter, engFilter, search],
    () => findingsApi.list({
      severity: sevFilter !== 'All' ? sevFilter : undefined,
      status: statusFilter !== 'All' ? statusFilter : undefined,
      engagement_id: engFilter || undefined,
      search: search || undefined,
    }).then(r => r.data)
  )

  const { data: engagements = [] } = useQuery('engagements', () => engagementsApi.list({}).then(r => r.data))

  const createMutation = useMutation(
    (data) => findingsApi.create(data.engagement_id, data),
    {
      onSuccess: async (res) => {
        // Upload any pending evidence files
        for (const file of pendingFiles) {
          const fd = new FormData()
          fd.append('file', file)
          try {
            await findingsApi.uploadEvidence(res.data.id, fd)
          } catch {}
        }
        qc.invalidateQueries('findings')
        setShowModal(false)
        setPendingFiles([])
        toast.success(`Finding ${res.data.ref_id} created`)
        navigate(`/findings/${res.data.id}`)
      },
      onError: () => toast.error('Failed to create finding'),
    }
  )

  const sorted = [...findings].sort((a, b) => {
    const o = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 }
    return (o[a.severity] || 5) - (o[b.severity] || 5)
  })

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <div style={s.title}>Findings <span style={s.sub}>{findings.length} total</span></div>
        <button style={s.btnPrimary} onClick={() => setShowModal(true)}>+ New Finding</button>
      </div>

      <div style={s.filterRow}>
        <input style={s.search} placeholder="Search findings..." value={search} onChange={e => setSearch(e.target.value)} />
        <select style={s.select} value={engFilter} onChange={e => setEngFilter(e.target.value)}>
          <option value="">All Engagements</option>
          {engagements.map(e => <option key={e.id} value={e.id}>{e.ref_id} — {e.client}</option>)}
        </select>
        <select style={s.select} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          {STATUSES.map(st => <option key={st}>{st}</option>)}
        </select>
      </div>

      <div style={s.sevRow}>
        {SEVERITIES.map(sev => (
          <button key={sev} onClick={() => setSevFilter(sev)}
            style={{ ...s.sevBtn, background: sevFilter === sev ? (SEV_DIM[sev] || 'var(--surface3)') : 'var(--surface)', color: sevFilter === sev ? (SEV_COLOR[sev] || 'var(--text)') : 'var(--muted)', borderColor: sevFilter === sev ? (SEV_COLOR[sev] ? SEV_COLOR[sev] + '55' : 'var(--border)') : 'var(--border)' }}>
            {sev}
            {sev !== 'All' && <span style={{ marginLeft: 4, fontSize: 9, opacity: .7 }}>{findings.filter(f => f.severity === sev).length}</span>}
          </button>
        ))}
      </div>

      <div style={s.panel}>
        {isLoading ? <div style={s.empty}>Loading...</div> : sorted.length === 0 ? <div style={s.empty}>No findings match your filters</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['ID', 'Title', 'Severity', 'CVSS', 'Status', 'Engagement', 'Source', 'Date'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>
              {sorted.map(f => (
                <tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/findings/${f.id}`)}>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 10, color: 'var(--blue)' }}>{f.ref_id}</td>
                  <td style={s.td}><span style={{ fontSize: 12, fontWeight: 600 }}>{f.title}</span></td>
                  <td style={s.td}><span style={{ ...s.sevBadge, color: SEV_COLOR[f.severity], borderColor: SEV_COLOR[f.severity] + '55', background: SEV_DIM[f.severity] }}>{f.severity}</span></td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11, color: SEV_COLOR[f.severity] }}>{f.cvss_score || '—'}</td>
                  <td style={s.td}><span style={s.tag}>{f.status}</span></td>
                  <td style={{ ...s.td, fontSize: 10, color: 'var(--muted)' }}>{engagements.find(e => e.id === f.engagement_id)?.ref_id || '—'}</td>
                  <td style={s.td}><span style={s.tag}>{f.source || 'manual'}</span></td>
                  <td style={{ ...s.td, fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>{f.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div style={s.modalBg}>
          <div style={s.modal}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>New Finding</span>
              <button style={s.closeBtn} onClick={() => setShowModal(false)}>×</button>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>Engagement *</label>
                <select style={s.formSelect} value={form.engagement_id} onChange={e => setForm({ ...form, engagement_id: e.target.value })}>
                  <option value="">— Select engagement —</option>
                  {engagements.map(e => <option key={e.id} value={e.id}>{e.ref_id} — {e.client} ({e.name})</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>Title *</label>
                <input style={s.formInput} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. SQL Injection in login endpoint" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={s.label}>Severity</label>
                  <select style={s.formSelect} value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}>
                    {['Critical', 'High', 'Medium', 'Low', 'Info'].map(sv => <option key={sv}>{sv}</option>)}
                  </select>
                </div>
                <div>
                  <label style={s.label}>CVSS Score</label>
                  <input style={s.formInput} value={form.cvss_score} onChange={e => setForm({ ...form, cvss_score: e.target.value })} placeholder="e.g. 9.1" />
                </div>
                <div>
                  <label style={s.label}>CWE</label>
                  <input style={s.formInput} value={form.cwe} onChange={e => setForm({ ...form, cwe: e.target.value })} placeholder="e.g. CWE-89" />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>Affected Component</label>
                <input style={s.formInput} value={form.affected_component} onChange={e => setForm({ ...form, affected_component: e.target.value })} placeholder="e.g. /api/login" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>Description</label>
                <MarkdownEditor value={form.description} onChange={v => setForm({ ...form, description: v })} minHeight={80} placeholder="Describe the vulnerability in markdown..." />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={s.label}>Remediation</label>
                <MarkdownEditor value={form.remediation} onChange={v => setForm({ ...form, remediation: v })} minHeight={60} placeholder="Remediation steps in markdown..." />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={s.label}>Evidence / Screenshots</label>
                <div style={{ border: '2px dashed var(--border2)', borderRadius: 6, padding: 12, textAlign: 'center', cursor: 'pointer' }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); setPendingFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]) }}>
                  <label style={{ cursor: 'pointer', fontSize: 11, color: 'var(--muted)' }}>
                    📎 Click or drag to attach files
                    <input type="file" multiple style={{ display: 'none' }} onChange={e => setPendingFiles(prev => [...prev, ...Array.from(e.target.files)])} />
                  </label>
                </div>
                {pendingFiles.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {pendingFiles.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text)' }}>
                        <span>{f.type?.startsWith('image/') ? '🖼' : '📄'}</span>
                        <span style={{ flex: 1 }}>{f.name}</span>
                        <span style={{ color: 'var(--muted)', fontSize: 10 }}>{(f.size / 1024).toFixed(1)} KB</span>
                        <button style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 14 }}
                          onClick={() => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <button style={s.btn} onClick={() => setShowModal(false)}>Cancel</button>
                <button style={s.btnPrimary} disabled={!form.title || !form.engagement_id || createMutation.isLoading}
                  onClick={() => createMutation.mutate({ ...form, cvss_score: form.cvss_score ? parseFloat(form.cvss_score) : null })}>
                  {createMutation.isLoading ? 'Creating...' : 'Create Finding'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const s = {
  page: { padding: 24 },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 },
  sub: { fontSize: 12, color: 'var(--muted)', fontWeight: 400 },
  filterRow: { display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' },
  search: { flex: 1, minWidth: 200, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '7px 12px', fontSize: 12, fontFamily: 'monospace', outline: 'none' },
  select: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '7px 10px', fontSize: 11, fontFamily: 'monospace', outline: 'none', cursor: 'pointer' },
  sevRow: { display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' },
  sevBtn: { border: '1px solid', borderRadius: 5, padding: '4px 12px', fontSize: 10, cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700 },
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' },
  th: { fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td: { padding: '9px 12px', borderBottom: '1px solid var(--surface2)', fontSize: 11, verticalAlign: 'middle', color: 'var(--text)' },
  sevBadge: { padding: '2px 7px', borderRadius: 3, fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', border: '1px solid' },
  tag: { background: 'var(--surface2)', color: 'var(--muted)', padding: '2px 7px', borderRadius: 4, fontSize: 10 },
  empty: { padding: 40, color: 'var(--muted)', fontSize: 12, textAlign: 'center' },
  btn: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnPrimary: { background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  label: { fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', display: 'block', marginBottom: 5 },
  formInput: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' },
  formSelect: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', cursor: 'pointer' },
  modalBg: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, width: '90%', maxWidth: 580, maxHeight: '85vh', overflowY: 'auto' },
  modalHeader: { padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--surface)' },
  modalTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 },
}
