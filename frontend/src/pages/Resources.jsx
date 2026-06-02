import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import api from '../api/client'
import toast from 'react-hot-toast'
import SessionViewer from '../components/SessionViewer'

const OS_TYPES = ['Kali Linux', 'Parrot OS', 'Windows', 'Ubuntu', 'RHEL', 'macOS', 'Custom']
const LOCATIONS = ['Internal', 'Cloud', 'DMZ', 'External', 'Lab', 'Client Site', 'Custom']
const STATUS_COLOR = { available: '#4ade80', checked_out: '#f0883e', maintenance: '#e05252', offline: '#6b7899' }
const STATUS_LABEL = { available: 'Available', checked_out: 'Checked Out', maintenance: 'Maintenance', offline: 'Offline' }

export default function Resources() {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editBox, setEditBox] = useState(null)
  const [viewingSessions, setViewingSessions] = useState(null)
  const [form, setForm] = useState({ name: '', hostname: '', ip_address: '', os: 'Kali Linux', os_custom: '', location: 'Internal', location_custom: '', purpose: '', notes: '', auto_release_hours: 8 })

  const { data: jumpboxes = [], isLoading } = useQuery('jumpboxes', () => api.get('/jumpboxes/').then(r => r.data))
  const { data: engagements = [] } = useQuery('engagements', () => api.get('/engagements/').then(r => r.data))

  const createMutation = useMutation(
    (data) => api.post('/jumpboxes/', data),
    { onSuccess: () => { qc.invalidateQueries('jumpboxes'); setShowModal(false); resetForm(); toast.success('Jump box added') }, onError: () => toast.error('Failed to add jump box') }
  )

  const updateMutation = useMutation(
    ({ id, data }) => api.patch(`/jumpboxes/${id}`, data),
    { onSuccess: () => { qc.invalidateQueries('jumpboxes'); setEditBox(null); resetForm(); toast.success('Jump box updated') } }
  )

  const deleteMutation = useMutation(
    (id) => api.delete(`/jumpboxes/${id}`),
    { onSuccess: () => { qc.invalidateQueries('jumpboxes'); toast.success('Jump box deleted') } }
  )

  const checkoutMutation = useMutation(
    ({ id, engagement_id, notes }) => api.post(`/jumpboxes/${id}/checkout`, { engagement_id, notes }),
    { onSuccess: () => { qc.invalidateQueries('jumpboxes'); toast.success('Jump box checked out') }, onError: (e) => toast.error(e.response?.data?.detail || 'Checkout failed') }
  )

  const checkinMutation = useMutation(
    (id) => api.post(`/jumpboxes/${id}/checkin`),
    { onSuccess: () => { qc.invalidateQueries('jumpboxes'); toast.success('Jump box checked in') } }
  )

  function resetForm() {
    setForm({ name: '', hostname: '', ip_address: '', os: 'Kali Linux', os_custom: '', location: 'Internal', location_custom: '', purpose: '', notes: '', auto_release_hours: 8 })
  }

  function startEdit(box) {
    setEditBox(box.id)
    setForm({ name: box.name, hostname: box.hostname || '', ip_address: box.ip_address || '', os: OS_TYPES.includes(box.os) ? box.os : 'Custom', os_custom: OS_TYPES.includes(box.os) ? '' : box.os, location: LOCATIONS.includes(box.location) ? box.location : 'Custom', location_custom: LOCATIONS.includes(box.location) ? '' : box.location, purpose: box.purpose || '', notes: box.notes || '', auto_release_hours: box.auto_release_hours || 8 })
    setShowModal(true)
  }

  function getFormData() {
    return { ...form, os: form.os === 'Custom' ? form.os_custom : form.os, location: form.location === 'Custom' ? form.location_custom : form.location }
  }

  const available = jumpboxes.filter(b => b.status === 'available').length
  const checkedOut = jumpboxes.filter(b => b.status === 'checked_out').length

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <div>
          <div style={s.title}>Resources</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {available} available · {checkedOut} checked out · {jumpboxes.length} total
          </div>
        </div>
        <button style={s.btnPrimary} onClick={() => { resetForm(); setEditBox(null); setShowModal(true) }}>+ Add Jump Box</button>
      </div>

      {isLoading ? (
        <div style={s.empty}>Loading...</div>
      ) : jumpboxes.length === 0 ? (
        <div style={s.emptyBox}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🖥</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No jump boxes yet</div>
          <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 16 }}>Add your pentest infrastructure to track usage</div>
          <button style={s.btnPrimary} onClick={() => setShowModal(true)}>+ Add First Jump Box</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {jumpboxes.map(box => (
            <JumpBoxCard key={box.id} box={box} engagements={engagements}
              onEdit={() => startEdit(box)}
              onDelete={() => { if (confirm(`Delete ${box.name}?`)) deleteMutation.mutate(box.id) }}
              onCheckout={(engId, notes) => checkoutMutation.mutate({ id: box.id, engagement_id: engId, notes })}
              onCheckin={() => checkinMutation.mutate(box.id)}
              onViewSessions={() => setViewingSessions(box)}
            />
          ))}
        </div>
      )}

      {/* Session Viewer */}
      {viewingSessions && (
        <SessionViewer
          jumpboxId={viewingSessions.id}
          jumpboxName={viewingSessions.name}
          onClose={() => setViewingSessions(null)}
        />
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div style={s.modalBg}>
          <div style={s.modal}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>{editBox ? 'Edit Jump Box' : 'Add Jump Box'}</span>
              <button style={s.closeBtn} onClick={() => { setShowModal(false); setEditBox(null); resetForm() }}>×</button>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={s.label}>Name *</label>
                  <input style={s.input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kali-01" />
                </div>
                <div>
                  <label style={s.label}>IP Address</label>
                  <input style={s.input} value={form.ip_address} onChange={e => setForm({ ...form, ip_address: e.target.value })} placeholder="192.168.1.100" />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>Hostname</label>
                <input style={s.input} value={form.hostname} onChange={e => setForm({ ...form, hostname: e.target.value })} placeholder="kali-pentest-01.internal" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={s.label}>OS</label>
                  <select style={s.input} value={form.os} onChange={e => setForm({ ...form, os: e.target.value })}>
                    {OS_TYPES.map(o => <option key={o}>{o}</option>)}
                  </select>
                  {form.os === 'Custom' && (
                    <input style={{ ...s.input, marginTop: 6 }} value={form.os_custom} onChange={e => setForm({ ...form, os_custom: e.target.value })} placeholder="Custom OS name" />
                  )}
                </div>
                <div>
                  <label style={s.label}>Location</label>
                  <select style={s.input} value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}>
                    {LOCATIONS.map(l => <option key={l}>{l}</option>)}
                  </select>
                  {form.location === 'Custom' && (
                    <input style={{ ...s.input, marginTop: 6 }} value={form.location_custom} onChange={e => setForm({ ...form, location_custom: e.target.value })} placeholder="Custom location" />
                  )}
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>Purpose</label>
                <input style={s.input} value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} placeholder="e.g. Internal network pentesting, AD attacks" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>Auto-release after (hours)</label>
                <input style={s.input} type="number" min="1" max="168" value={form.auto_release_hours} onChange={e => setForm({ ...form, auto_release_hours: parseInt(e.target.value) })} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={s.label}>Notes</label>
                <textarea style={{ ...s.input, minHeight: 60, resize: 'vertical' }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Credentials location, special tools installed, etc." />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <button style={s.btn} onClick={() => { setShowModal(false); setEditBox(null); resetForm() }}>Cancel</button>
                <button style={s.btnPrimary}
                  disabled={!form.name}
                  onClick={() => {
                    const data = getFormData()
                    editBox ? updateMutation.mutate({ id: editBox, data }) : createMutation.mutate(data)
                  }}>
                  {editBox ? 'Save Changes' : 'Add Jump Box'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function JumpBoxCard({ box, engagements, onEdit, onDelete, onCheckout, onCheckin, onViewSessions }) {
  const [showCheckout, setShowCheckout] = useState(false)
  const [checkoutEngId, setCheckoutEngId] = useState('')
  const [checkoutNotes, setCheckoutNotes] = useState('')
  const isAvailable = box.status === 'available'
  const statusColor = STATUS_COLOR[box.status] || '#6b7899'

  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${statusColor}33`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor, flexShrink: 0, boxShadow: `0 0 6px ${statusColor}` }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{box.name}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>{box.ip_address || box.hostname || 'No IP set'}</div>
          <div style={{ fontSize: 9, color: 'var(--muted2)', fontFamily: 'monospace', marginTop: 2, userSelect: 'all' }}>{box.id}</div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, textTransform: 'uppercase', letterSpacing: '.08em' }}>
          {STATUS_LABEL[box.status] || box.status}
        </span>
      </div>

      <div style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={cs.tag}>{box.os}</span>
          <span style={cs.tag}>{box.location}</span>
          {box.purpose && <span style={{ ...cs.tag, color: 'var(--text)' }}>{box.purpose}</span>}
        </div>

        {box.status === 'checked_out' && (
          <div style={{ background: 'var(--amber-dim)', border: '1px solid var(--amber)', borderRadius: 6, padding: '8px 12px', marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', marginBottom: 6 }}>Currently in use</div>
            <div style={{ fontSize: 11, color: 'var(--text)', marginBottom: 2 }}>
              👤 @{box.checked_out_by_username || 'unknown'}
              {box.checked_out_engagement && <span style={{ marginLeft: 8 }}>· 📋 {box.checked_out_engagement}</span>}
            </div>
            {box.checkout_notes && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>"{box.checkout_notes}"</div>}
            {box.checked_out_at && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, fontFamily: 'monospace' }}>Since {new Date(box.checked_out_at).toLocaleString()}</div>}
          </div>
        )}

        {box.notes && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>{box.notes}</div>
        )}

        {showCheckout && (
          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Check Out</div>
            <select style={{ ...cs.input, marginBottom: 8 }} value={checkoutEngId} onChange={e => setCheckoutEngId(e.target.value)}>
              <option value="">— Select engagement (optional) —</option>
              {engagements.filter(e => e.status === 'Active').map(e => (
                <option key={e.id} value={e.id}>{e.ref_id} — {e.client}</option>
              ))}
            </select>
            <input style={{ ...cs.input, marginBottom: 8 }} value={checkoutNotes} onChange={e => setCheckoutNotes(e.target.value)} placeholder="What are you using it for?" />
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={cs.btnPrimary} onClick={() => { onCheckout(checkoutEngId || null, checkoutNotes); setShowCheckout(false); setCheckoutNotes(''); setCheckoutEngId('') }}>
                Confirm Check Out
              </button>
              <button style={cs.btn} onClick={() => setShowCheckout(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {isAvailable ? (
            <button style={cs.btnGreen} onClick={() => setShowCheckout(!showCheckout)}>↓ Check Out</button>
          ) : box.status === 'checked_out' ? (
            <button style={cs.btnOrange} onClick={onCheckin}>↑ Check In</button>
          ) : null}
          <button style={{ ...cs.btn, color: '#60a5fa', borderColor: '#60a5fa55' }} onClick={onViewSessions}>📋 Sessions</button>
          <button style={cs.btn} onClick={onEdit}>Edit</button>
          <button style={{ ...cs.btn, color: 'var(--red)', borderColor: 'var(--red-mid)', marginLeft: 'auto' }} onClick={onDelete}>Del</button>
        </div>
      </div>
    </div>
  )
}

const s = {
  page: { padding: 24 },
  topbar: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text)' },
  btnPrimary: { background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btn: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  label: { fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', display: 'block', marginBottom: 5 },
  input: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' },
  empty: { padding: 40, color: 'var(--muted)', fontSize: 12, textAlign: 'center' },
  emptyBox: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 60, textAlign: 'center', color: 'var(--text)' },
  modalBg: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, width: '90%', maxWidth: 520, maxHeight: '85vh', overflowY: 'auto' },
  modalHeader: { padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--surface)' },
  modalTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 },
}

const cs = {
  tag: { background: 'var(--surface2)', color: 'var(--muted)', padding: '2px 8px', borderRadius: 4, fontSize: 10, border: '1px solid var(--border)', fontFamily: 'monospace' },
  input: { width: '100%', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '6px 10px', fontSize: 11, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' },
  btn: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnPrimary: { background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnGreen: { background: 'var(--green-dim)', border: '1px solid #4ade80', borderRadius: 5, color: '#4ade80', padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700 },
  btnOrange: { background: 'var(--amber-dim)', border: '1px solid var(--amber)', borderRadius: 5, color: 'var(--amber)', padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700 },
}
