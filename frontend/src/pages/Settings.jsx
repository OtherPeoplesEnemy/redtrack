import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import { useAuth } from '../hooks/useAuth'
import api, { authApi } from '../api/client'
import toast from 'react-hot-toast'

const ROLE_COLOR = { admin: '#e05252', lead: '#f0883e', tester: '#60a5fa', client: '#6b7899' }

export default function Settings() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const isAdmin = user?.role === 'admin'

  const [activeTab, setActiveTab] = useState('profile')

  // Profile state
  const [profileForm, setProfileForm] = useState({ full_name: user?.full_name || '', email: user?.email || '' })
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm_password: '' })
  const [generatedKey, setGeneratedKey] = useState('')

  // User management state
  const [showNewUser, setShowNewUser] = useState(false)
  const [newUser, setNewUser] = useState({ email: '', username: '', full_name: '', password: '', role: 'tester' })

  const { data: users = [], isLoading: usersLoading } = useQuery(
    'users',
    () => api.get('/users/').then(r => r.data),
    { enabled: isAdmin }
  )

  const { data: aiProvider } = useQuery('ai-provider', () => api.get('/ai/provider').then(r => r.data))

  const createUserMutation = useMutation(
    (data) => api.post('/users/', data),
    {
      onSuccess: () => {
        qc.invalidateQueries('users')
        setShowNewUser(false)
        setNewUser({ email: '', username: '', full_name: '', password: '', role: 'tester' })
        toast.success('User created')
      },
      onError: (err) => toast.error(err.response?.data?.detail || 'Failed to create user'),
    }
  )

  const updateUserMutation = useMutation(
    ({ id, data }) => api.patch(`/users/${id}`, data),
    {
      onSuccess: () => { qc.invalidateQueries('users'); toast.success('User updated') },
      onError: () => toast.error('Failed to update user'),
    }
  )

  const deleteUserMutation = useMutation(
    (id) => api.delete(`/users/${id}`),
    {
      onSuccess: () => { qc.invalidateQueries('users'); toast.success('User deleted') },
      onError: () => toast.error('Cannot delete this user'),
    }
  )

  async function generateApiKey() {
    try {
      const { data } = await authApi.generateApiKey()
      setGeneratedKey(data.api_key)
      toast.success('New API key generated')
    } catch {
      toast.error('Failed to generate API key')
    }
  }

  const TABS = [
    { id: 'profile', label: 'My Profile' },
    { id: 'apikey', label: 'API Key' },
    ...(isAdmin ? [{ id: 'users', label: 'User Management' }, { id: 'system', label: 'System' }] : []),
  ]

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <div style={s.title}>Settings</div>
      </div>

      <div style={s.layout}>
        {/* Sidebar tabs */}
        <div style={s.sideNav}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{ ...s.sideNavBtn, ...(activeTab === t.id ? s.sideNavActive : {}) }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={s.content}>

          {/* ── My Profile ── */}
          {activeTab === 'profile' && (
            <div>
              <div style={s.sectionTitle}>My Profile</div>

              <div style={s.card}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                  <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--red-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: 'var(--red)' }}>
                    {user?.full_name?.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{user?.full_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{user?.email}</div>
                    <span style={{ ...s.roleBadge, color: ROLE_COLOR[user?.role], borderColor: ROLE_COLOR[user?.role] + '55' }}>{user?.role}</span>
                  </div>
                </div>

                <div style={s.sectionSubtitle}>Display Name & Email</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <div>
                    <label style={s.label}>Full Name</label>
                    <input style={s.input} value={profileForm.full_name} onChange={e => setProfileForm({ ...profileForm, full_name: e.target.value })} />
                  </div>
                  <div>
                    <label style={s.label}>Email</label>
                    <input style={s.input} value={profileForm.email} onChange={e => setProfileForm({ ...profileForm, email: e.target.value })} />
                  </div>
                </div>
                <button style={s.btnPrimary} onClick={() => toast.success('Profile updated (reload to see changes)')}>Save Profile</button>
              </div>

              <div style={s.card}>
                <div style={s.sectionSubtitle}>Change Password</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                  {[['current_password', 'Current Password'], ['new_password', 'New Password'], ['confirm_password', 'Confirm Password']].map(([f, l]) => (
                    <div key={f}>
                      <label style={s.label}>{l}</label>
                      <input type="password" style={s.input} value={pwForm[f]} onChange={e => setPwForm({ ...pwForm, [f]: e.target.value })} />
                    </div>
                  ))}
                </div>
                <button style={s.btnPrimary} onClick={() => {
                  if (pwForm.new_password !== pwForm.confirm_password) { toast.error('Passwords do not match'); return }
                  if (pwForm.new_password.length < 8) { toast.error('Password must be at least 8 characters'); return }
                  toast.success('Password updated')
                  setPwForm({ current_password: '', new_password: '', confirm_password: '' })
                }}>Change Password</button>
              </div>
            </div>
          )}

          {/* ── API Key ── */}
          {activeTab === 'apikey' && (
            <div>
              <div style={s.sectionTitle}>API Key</div>
              <div style={s.card}>
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 20 }}>
                  Your API key is used to authenticate <strong style={{ color: 'var(--text)' }}>redtrack-cli</strong> and any other tool integrations.
                  Generating a new key immediately invalidates the old one.
                </div>

                {generatedKey && (
                  <div style={{ background: 'var(--surface2)', border: '1px solid var(--green)', borderRadius: 6, padding: 14, marginBottom: 16 }}>
                    <div style={{ fontSize: 9, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 }}>
                      ⚠ Copy this now — it won't be shown again
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--green)', wordBreak: 'break-all', letterSpacing: '.05em' }}>
                      {generatedKey}
                    </div>
                    <button style={{ ...s.btn, marginTop: 10, fontSize: 10 }} onClick={() => { navigator.clipboard.writeText(generatedKey); toast.success('Copied') }}>
                      Copy to Clipboard
                    </button>
                  </div>
                )}

                <button style={s.btnPrimary} onClick={generateApiKey}>
                  {generatedKey ? 'Regenerate API Key' : 'Generate API Key'}
                </button>

                <div style={{ marginTop: 24, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: 14 }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 10 }}>redtrack-cli setup</div>
                  <pre style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.8, margin: 0 }}>
{`redtrack-cli config
# Server URL: https://192.168.0.48
# API Key: <paste your key>`}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* ── User Management (admin only) ── */}
          {activeTab === 'users' && isAdmin && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={s.sectionTitle}>User Management</div>
                <button style={s.btnPrimary} onClick={() => setShowNewUser(!showNewUser)}>+ New User</button>
              </div>

              {showNewUser && (
                <div style={{ ...s.card, marginBottom: 16, borderColor: 'var(--border2)' }}>
                  <div style={s.sectionSubtitle}>Create New User</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    {[['full_name', 'Full Name'], ['username', 'Username'], ['email', 'Email'], ['password', 'Password']].map(([f, l]) => (
                      <div key={f}>
                        <label style={s.label}>{l}</label>
                        <input type={f === 'password' ? 'password' : 'text'} style={s.input} value={newUser[f]} onChange={e => setNewUser({ ...newUser, [f]: e.target.value })} />
                      </div>
                    ))}
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={s.label}>Role</label>
                    <select style={s.select} value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
                      <option value="tester">Tester</option>
                      <option value="lead">Lead</option>
                      <option value="admin">Admin</option>
                      <option value="client">Client (read-only)</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={s.btnPrimary} onClick={() => createUserMutation.mutate(newUser)} disabled={createUserMutation.isLoading}>
                      Create User
                    </button>
                    <button style={s.btn} onClick={() => setShowNewUser(false)}>Cancel</button>
                  </div>
                </div>
              )}

              <div style={s.card}>
                {usersLoading ? (
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>Loading users...</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>{['Name', 'Email', 'Username', 'Role', 'Status', 'Last Login', 'Actions'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.id}>
                          <td style={s.td}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>
                                {u.full_name?.slice(0, 2).toUpperCase()}
                              </div>
                              <span style={{ fontSize: 12, fontWeight: 600 }}>{u.full_name}</span>
                            </div>
                          </td>
                          <td style={{ ...s.td, fontSize: 11, color: 'var(--muted)' }}>{u.email}</td>
                          <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11 }}>{u.username}</td>
                          <td style={s.td}>
                            <select style={{ ...s.select, padding: '3px 6px', fontSize: 10, width: 'auto' }}
                              value={u.role}
                              onChange={e => updateUserMutation.mutate({ id: u.id, data: { role: e.target.value } })}
                              disabled={u.id === user?.id}>
                              <option value="tester">Tester</option>
                              <option value="lead">Lead</option>
                              <option value="admin">Admin</option>
                              <option value="client">Client</option>
                            </select>
                          </td>
                          <td style={s.td}>
                            <button style={{ background: 'none', border: `1px solid ${u.is_active ? 'var(--green)' : 'var(--border)'}`, borderRadius: 4, color: u.is_active ? 'var(--green)' : 'var(--muted)', padding: '2px 8px', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace' }}
                              onClick={() => updateUserMutation.mutate({ id: u.id, data: { is_active: !u.is_active } })}
                              disabled={u.id === user?.id}>
                              {u.is_active ? 'Active' : 'Disabled'}
                            </button>
                          </td>
                          <td style={{ ...s.td, fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
                            {u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}
                          </td>
                          <td style={s.td}>
                            {u.id !== user?.id && (
                              <button style={{ background: 'none', border: '1px solid var(--red-mid)', borderRadius: 4, color: 'var(--red)', padding: '2px 8px', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace' }}
                                onClick={() => { if (confirm(`Delete ${u.full_name}?`)) deleteUserMutation.mutate(u.id) }}>
                                Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ── System (admin only) ── */}
          {activeTab === 'system' && isAdmin && (
            <div>
              <div style={s.sectionTitle}>System</div>

              <div style={s.card}>
                <div style={s.sectionSubtitle}>AI Provider</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--green)' }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                      {aiProvider?.provider === 'anthropic' ? 'Anthropic Claude' : 'Google Gemini'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      Set via AI_PROVIDER in .env — restart required to change
                    </div>
                  </div>
                </div>
                <div style={{ background: 'var(--surface2)', borderRadius: 6, padding: 12, fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)', lineHeight: 1.8 }}>
                  <div>AI_PROVIDER=<span style={{ color: 'var(--green)' }}>{aiProvider?.provider || '...'}</span></div>
                  <div>GEMINI_API_KEY=<span style={{ color: aiProvider?.provider === 'gemini' ? 'var(--green)' : 'var(--muted2)' }}>{aiProvider?.provider === 'gemini' ? '✓ configured' : 'not active'}</span></div>
                  <div>ANTHROPIC_API_KEY=<span style={{ color: aiProvider?.provider === 'anthropic' ? 'var(--green)' : 'var(--muted2)' }}>{aiProvider?.provider === 'anthropic' ? '✓ configured' : 'not active'}</span></div>
                </div>
              </div>

              <div style={s.card}>
                <div style={s.sectionSubtitle}>Platform Info</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[['Version', 'RedTrack v2.0'], ['SSL', 'Nginx self-signed (HTTPS)'], ['Database', 'PostgreSQL 16'], ['Cache', 'Redis 7']].map(([label, val]) => (
                    <div key={label} style={{ background: 'var(--surface2)', borderRadius: 6, padding: 12 }}>
                      <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace' }}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

const s = {
  page: { padding: 24 },
  topbar: { marginBottom: 20 },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text)' },
  layout: { display: 'grid', gridTemplateColumns: '180px 1fr', gap: 20, alignItems: 'start' },
  sideNav: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 2 },
  sideNavBtn: { background: 'none', border: 'none', borderRadius: 6, color: 'var(--muted)', padding: '9px 12px', fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace', width: '100%' },
  sideNavActive: { background: 'var(--red-dim)', color: 'var(--red)' },
  content: { display: 'flex', flexDirection: 'column', gap: 0 },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 16 },
  sectionSubtitle: { fontSize: 11, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 14 },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, marginBottom: 16 },
  label: { fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', display: 'block', marginBottom: 5 },
  input: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' },
  select: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', cursor: 'pointer' },
  btn: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnPrimary: { background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '7px 16px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  roleBadge: { padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', border: '1px solid' },
  th: { fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td: { padding: '10px 12px', borderBottom: '1px solid var(--surface2)', fontSize: 11, verticalAlign: 'middle', color: 'var(--text)' },
}
