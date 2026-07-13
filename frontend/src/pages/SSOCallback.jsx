import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { ssoApi } from '../api/client'

export default function SSOCallback() {
  const [searchParams] = useSearchParams()
  const [error, setError] = useState(null)
  const { setSession } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    const code = searchParams.get('code')
    if (!code) {
      setError('Missing SSO code in callback URL')
      return
    }
    ssoApi.exchange(code)
      .then(({ data }) => {
        setSession(data)
        navigate('/dashboard', { replace: true })
      })
      .catch((err) => {
        setError(err.response?.data?.detail || 'SSO sign-in failed')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>
      <div style={{ width: 380, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 32, textAlign: 'center' }}>
        {error ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 16 }}>{error}</div>
            <button
              style={{ background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '10px 16px', fontSize: 12, cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700 }}
              onClick={() => navigate('/login', { replace: true })}
            >
              Back to login
            </button>
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Signing you in…</div>
        )}
      </div>
    </div>
  )
}
