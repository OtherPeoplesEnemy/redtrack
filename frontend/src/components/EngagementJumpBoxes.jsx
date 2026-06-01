import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import api from '../api/client'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'

const STATUS_COLOR = { available: '#4ade80', checked_out: '#f0883e', maintenance: '#e05252', offline: '#6b7899' }

export default function EngagementJumpBoxes({ engagementId }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [checkoutNotes, setCheckoutNotes] = useState({})
  const [showCheckout, setShowCheckout] = useState(null)

  const { data: jumpboxes = [] } = useQuery('jumpboxes', () => api.get('/jumpboxes/').then(r => r.data))

  const checkoutMutation = useMutation(
    ({ id, notes }) => api.post(`/jumpboxes/${id}/checkout`, { engagement_id: engagementId, notes }),
    { onSuccess: () => { qc.invalidateQueries('jumpboxes'); setShowCheckout(null); toast.success('Jump box checked out') }, onError: (e) => toast.error(e.response?.data?.detail || 'Checkout failed') }
  )

  const checkinMutation = useMutation(
    (id) => api.post(`/jumpboxes/${id}/checkin`),
    { onSuccess: () => { qc.invalidateQueries('jumpboxes'); toast.success('Jump box checked in') } }
  )

  // Boxes checked out to this engagement
  const myBoxes = jumpboxes.filter(b => b.checked_out_engagement_id === engagementId)
  // Available boxes
  const available = jumpboxes.filter(b => b.status === 'available')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{myBoxes.length} jump box{myBoxes.length !== 1 ? 'es' : ''} assigned to this engagement</div>
        <button style={s.btn} onClick={() => navigate('/resources')}>⊡ Manage All Resources</button>
      </div>

      {/* Checked out to this engagement */}
      {myBoxes.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 10, fontWeight: 700 }}>Assigned to this engagement</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myBoxes.map(box => (
              <div key={box.id} style={{ background: 'var(--surface2)', border: '1px solid var(--amber)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f0883e', boxShadow: '0 0 6px #f0883e', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{box.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
                    {box.ip_address || box.hostname} · {box.os} · {box.location}
                  </div>
                  {box.checkout_notes && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{box.checkout_notes}</div>}
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, fontFamily: 'monospace' }}>
                    Checked out by @{box.checked_out_by_username} · {new Date(box.checked_out_at).toLocaleString()}
                  </div>
                </div>
                <button style={{ ...s.btn, color: '#4ade80', borderColor: '#4ade8055' }} onClick={() => checkinMutation.mutate(box.id)}>
                  ↑ Check In
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available to check out */}
      <div>
        <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 10, fontWeight: 700 }}>
          Available Jump Boxes ({available.length})
        </div>
        {available.length === 0 ? (
          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
            No jump boxes available right now — all are checked out or add new ones in <span style={{ color: 'var(--blue)', cursor: 'pointer' }} onClick={() => navigate('/resources')}>Resources</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {available.map(box => (
              <div key={box.id}>
                <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 6px #4ade80', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{box.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
                      {box.ip_address || box.hostname || 'No IP'} · {box.os} · {box.location}
                    </div>
                    {box.purpose && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{box.purpose}</div>}
                  </div>
                  <button style={{ ...s.btn, color: '#4ade80', borderColor: '#4ade8055', fontWeight: 700 }}
                    onClick={() => setShowCheckout(showCheckout === box.id ? null : box.id)}>
                    ↓ Check Out
                  </button>
                </div>

                {showCheckout === box.id && (
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 12 }}>
                    <input style={s.input} placeholder="What will you use it for? (optional)"
                      value={checkoutNotes[box.id] || ''}
                      onChange={e => setCheckoutNotes({ ...checkoutNotes, [box.id]: e.target.value })} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button style={s.btnPrimary} onClick={() => checkoutMutation.mutate({ id: box.id, notes: checkoutNotes[box.id] || '' })}>
                        Confirm Check Out
                      </button>
                      <button style={s.btn} onClick={() => setShowCheckout(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const s = {
  btn: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '6px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnPrimary: { background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '6px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  input: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' },
}
