import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

export default function Login() {
  const [email, setEmail] = useState('admin@redtrack.com')
  const [password, setPassword] = useState('RedTrack2026!')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit() {
    setLoading(true)
    try {
      await login(email, password)
      navigate('/')
    } catch {
      toast.error('Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>
      <div style={{ width: 380, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ background: 'var(--bg)', padding: '32px 32px 24px', borderBottom: '4px solid var(--red)', textAlign: 'center' }}>
          <div style={{ width: 44, height: 44, background: 'var(--red)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18, color: '#fff', margin: '0 auto 12px' }}>RT</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>RedTrack</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.12em', marginTop: 2 }}>Pentest Management Platform v2</div>
        </div>
        <div style={{ padding: 32 }}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', display: 'block', marginBottom: 5 }}>Email</label>
            <input
              style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '8px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none' }}
              type="email" value={email} onChange={e => setEmail(e.target.value)}
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', display: 'block', marginBottom: 5 }}>Password</label>
            <input
              style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '8px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none' }}
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>
          <button
            style={{ width: '100%', background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '10px', fontSize: 12, cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700 }}
            onClick={handleSubmit} disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In →'}
          </button>
          <div style={{ fontSize: 10, color: 'var(--muted2)', textAlign: 'center', marginTop: 16 }}>
            admin@redtrack.com / RedTrack2026!
          </div>
        </div>
      </div>
    </div>
  )
}
