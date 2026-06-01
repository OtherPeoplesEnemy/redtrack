import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import api from '../api/client'
import toast from 'react-hot-toast'

const ROLES = ['lead', 'tester', 'observer']
const ROLE_COLOR = { lead: '#a855f7', tester: '#60a5fa', observer: '#6b7899' }
const ROLE_DIM = { lead: 'var(--purple-dim)', tester: 'var(--blue-dim)', observer: 'var(--surface2)' }

export default function EngagementTeam({ engagementId }) {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [selectedUser, setSelectedUser] = useState('')
  const [selectedRole, setSelectedRole] = useState('tester')

  const { data: members = [] } = useQuery(
    ['team', engagementId],
    () => api.get(`/engagements/${engagementId}/members`).then(r => r.data),
    { enabled: !!engagementId }
  )

  const { data: allUsers = [] } = useQuery('users', () => api.get('/users/').then(r => r.data))

  const addMutation = useMutation(
    (data) => api.post(`/engagements/${engagementId}/members`, data),
    {
      onSuccess: () => {
        qc.invalidateQueries(['team', engagementId])
        setShowAdd(false)
        setSelectedUser('')
        setSelectedRole('tester')
        toast.success('Team member added')
      },
      onError: () => toast.error('Failed to add member'),
    }
  )

  const updateRoleMutation = useMutation(
    ({ userId, role }) => api.patch(`/engagements/${engagementId}/members/${userId}`, { role }),
    { onSuccess: () => { qc.invalidateQueries(['team', engagementId]); toast.success('Role updated') } }
  )

  const removeMutation = useMutation(
    (userId) => api.delete(`/engagements/${engagementId}/members/${userId}`),
    {
      onSuccess: () => { qc.invalidateQueries(['team', engagementId]); toast.success('Member removed') },
      onError: () => toast.error('Failed to remove member'),
    }
  )

  // Filter out users already on the team
  const memberIds = members.map(m => m.user_id)
  const availableUsers = allUsers.filter(u => !memberIds.includes(u.id))

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{members.length} team member{members.length !== 1 ? 's' : ''}</div>
        <button style={s.btnPrimary} onClick={() => setShowAdd(!showAdd)}>+ Add Member</button>
      </div>

      {/* Add member form */}
      {showAdd && (
        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.08em' }}>Add Team Member</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'end' }}>
            <div>
              <div style={s.label}>User</div>
              <select style={s.select} value={selectedUser} onChange={e => setSelectedUser(e.target.value)}>
                <option value="">— Select user —</option>
                {availableUsers.map(u => (
                  <option key={u.id} value={u.id}>@{u.username} ({u.full_name})</option>
                ))}
              </select>
            </div>
            <div>
              <div style={s.label}>Role</div>
              <select style={s.select} value={selectedRole} onChange={e => setSelectedRole(e.target.value)}>
                {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={{ ...s.btnPrimary, opacity: !selectedUser ? 0.5 : 1 }}
                disabled={!selectedUser || addMutation.isLoading}
                onClick={() => addMutation.mutate({ user_id: selectedUser, role: selectedRole })}>
                Add
              </button>
              <button style={s.btn} onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
          {availableUsers.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>All users are already on this engagement. Add more users in Settings.</div>
          )}
        </div>
      )}

      {/* Team members */}
      {members.length === 0 ? (
        <div style={s.empty}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>👥</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No team members yet</div>
          <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 16 }}>Add team members to assign tasks and track contributions</div>
          <button style={s.btnPrimary} onClick={() => setShowAdd(true)}>+ Add First Member</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {members.map(m => (
            <div key={m.user_id} style={s.memberCard}>
              {/* Avatar */}
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: ROLE_DIM[m.role], border: `2px solid ${ROLE_COLOR[m.role]}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: ROLE_COLOR[m.role], flexShrink: 0 }}>
                {m.full_name?.slice(0, 2).toUpperCase() || '??'}
              </div>

              {/* Info */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{m.full_name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>@{m.username}</div>
              </div>

              {/* Stats */}
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                {m.finding_count > 0 && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)' }}>{m.finding_count}</div>
                    <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase' }}>findings</div>
                  </div>
                )}
                {m.joined_at && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
                    Joined {m.joined_at?.slice(0, 10)}
                  </div>
                )}
              </div>

              {/* Role selector */}
              <select style={{ ...s.select, width: 'auto', padding: '4px 8px', fontSize: 11, color: ROLE_COLOR[m.role], borderColor: ROLE_COLOR[m.role] + '55', background: ROLE_DIM[m.role] }}
                value={m.role}
                onChange={e => updateRoleMutation.mutate({ userId: m.user_id, role: e.target.value })}>
                {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>

              {/* Remove */}
              <button style={s.removeBtn}
                onClick={() => { if (confirm(`Remove ${m.full_name} from this engagement?`)) removeMutation.mutate(m.user_id) }}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const s = {
  btnPrimary: { background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btn: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  label: { fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 5 },
  select: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', cursor: 'pointer' },
  empty: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 40, textAlign: 'center', color: 'var(--text)' },
  memberCard: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14 },
  removeBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--muted)', padding: '4px 8px', fontSize: 12, cursor: 'pointer', flexShrink: 0 },
}
