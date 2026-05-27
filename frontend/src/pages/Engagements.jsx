import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import { engagementsApi } from '../api/client'
import toast from 'react-hot-toast'

const STATUS_COLOR = { Active: 'var(--green)', Planning: 'var(--blue)', Completed: 'var(--muted)', Archived: 'var(--muted2)' }

export default function Engagements() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ name: '', client: '', type: 'Web App', status: 'Planning', scope: '', start_date: '', end_date: '', client_contact: '' })

  const { data: engagements = [] } = useQuery(['engagements', search], () =>
    engagementsApi.list({ search }).then(r => r.data)
  )

  const deleteMutation = useMutation(
    (id) => engagementsApi.delete(id),
    {
      onSuccess: () => { qc.invalidateQueries('engagements'); toast.success('Engagement deleted') },
      onError: () => toast.error('Failed to delete engagement'),
    }
  )

  const createMutation = useMutation(
    (data) => engagementsApi.create(data),
    { onSuccess: () => { qc.invalidateQueries('engagements'); setShowModal(false); toast.success('Engagement created') } }
  )

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <div style={s.title}>Engagements <span style={s.sub}>{engagements.length} total</span></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={s.search} placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          <button style={s.btnPrimary} onClick={() => setShowModal(true)}>+ New Engagement</button>
        </div>
      </div>

      <div style={s.panel}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['ID', 'Name', 'Client', 'Type', 'Findings', 'Status', 'Progress'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>
            {engagements.map(en => (
              <tr key={en.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/engagements/${en.id}`)}>
                <td style={{ ...s.td, color: 'var(--blue)', fontFamily: 'monospace', fontSize: 10 }}>{en.ref_id}</td>
                <td style={s.td}><strong style={{ fontSize: 12 }}>{en.name}</strong></td>
                <td style={s.td}>{en.client}</td>
                <td style={s.td}><span style={s.tag}>{en.type}</span></td>
                <td style={s.td}>
                  <span style={{ fontSize: 12 }}>{en.finding_count}</span>
                  {en.critical_count > 0 && <span style={{ color: 'var(--red)', fontSize: 9, marginLeft: 4 }}>+{en.critical_count} crit</span>}
                </td>
                <td style={s.td}><span style={{ color: STATUS_COLOR[en.status], fontSize: 11, fontWeight: 600 }}>{en.status}</span></td>
                <td style={{ ...s.td, minWidth: 100 }}>
                  {en.finding_count > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, height: 4, background: 'var(--surface3)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.round(en.remediated_count / en.finding_count * 100)}%`, background: 'var(--green)', borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 9, color: 'var(--muted)' }}>{Math.round(en.remediated_count / en.finding_count * 100)}%</span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div style={s.modalBg}>
          <div style={s.modal}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>New Engagement</span>
              <button style={s.closeBtn} onClick={() => setShowModal(false)}>×</button>
            </div>
            <div style={{ padding: 20 }}>
              {[['name', 'Engagement Name'], ['client', 'Client'], ['client_contact', 'Client Contact']].map(([f, l]) => (
                <div key={f} style={{ marginBottom: 12 }}>
                  <label style={s.formLabel}>{l}</label>
                  <input style={s.formInput} value={form[f]} onChange={e => setForm({ ...form, [f]: e.target.value })} />
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={s.formLabel}>Type</label>
                  <select style={s.formSelect} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                    {['Web App', 'Network', 'Red Team', 'Cloud', 'Social Engineering', 'Mobile', 'Physical', 'AI Red Team'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={s.formLabel}>Status</label>
                  <select style={s.formSelect} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                    {['Planning', 'Active', 'Completed'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div><label style={s.formLabel}>Start Date</label><input type="date" style={s.formInput} value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
                <div><label style={s.formLabel}>End Date</label><input type="date" style={s.formInput} value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} /></div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={s.formLabel}>Scope</label>
                <textarea style={{ ...s.formInput, minHeight: 60, resize: 'vertical' }} value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <button style={s.btn} onClick={() => setShowModal(false)}>Cancel</button>
                <button style={s.btnPrimary} onClick={() => createMutation.mutate(form)}>Create Engagement</button>
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
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 },
  sub: { fontSize: 12, color: 'var(--muted)', fontWeight: 400 },
  panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' },
  th: { fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)', background: 'var(--surface)', whiteSpace: 'nowrap' },
  td: { padding: '9px 12px', borderBottom: '1px solid var(--surface2)', fontSize: 11, verticalAlign: 'middle', color: 'var(--text)' },
  tag: { background: 'var(--surface2)', color: 'var(--muted)', padding: '2px 7px', borderRadius: 4, fontSize: 10 },
  search: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', padding: '6px 10px', fontSize: 11, fontFamily: 'monospace', outline: 'none', width: 160 },
  btn: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnPrimary: { background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  modalBg: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, width: '90%', maxWidth: 520, maxHeight: '85vh', overflowY: 'auto' },
  modalHeader: { padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--surface)' },
  modalTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 },
  formLabel: { fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', display: 'block', marginBottom: 5 },
  formInput: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' },
  formSelect: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', cursor: 'pointer' },
}
