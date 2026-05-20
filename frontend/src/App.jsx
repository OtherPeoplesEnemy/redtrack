import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from 'react-query'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { ThemeProvider, useTheme } from './hooks/useTheme'
import '../src/styles/theme.css'

import Dashboard from './pages/Dashboard'
import Engagements from './pages/Engagements'
import EngagementDetail from './pages/EngagementDetail'
import Findings from './pages/Findings'
import FindingDetail from './pages/FindingDetail'
import Reports from './pages/Reports'
import VulnDB from './pages/VulnDB'
import Kanban from './pages/Kanban'
import Settings from './pages/Settings'
import Login from './pages/Login'
import AIAssistant from './components/AIAssistant'
import { useState } from 'react'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
})

const NAV = [
  { to: '/', label: 'Dashboard', icon: '⬡' },
  { to: '/kanban', label: 'Kanban', icon: '⬜' },
  { to: '/engagements', label: 'Engagements', icon: '◈' },
  { to: '/findings', label: 'Findings', icon: '◉' },
  { to: '/reports', label: 'Reports', icon: '◧' },
  { to: '/vulndb', label: 'Vuln DB', icon: '◫' },
  { to: '/settings', label: 'Settings', icon: '◎' },
]

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  return (
    <button onClick={toggleTheme} style={{
      background: 'none', border: '1px solid var(--border)', borderRadius: 5,
      color: 'var(--muted)', padding: '4px 8px', cursor: 'pointer', fontSize: 14,
    }} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}

function AppShell({ children }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [aiOpen, setAiOpen] = useState(false)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', height: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Courier New', monospace" }}>
      {/* Sidebar */}
      <aside style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, background: 'var(--red)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fff', fontSize: 13 }}>RT</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>RedTrack</div>
            <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em' }}>v2.0</div>
          </div>
        </div>

        <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
          <div style={{ padding: '12px 16px 4px', fontSize: 9, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: '.12em' }}>Workspace</div>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px',
                color: isActive ? 'var(--red)' : 'var(--muted)',
                borderLeft: `2px solid ${isActive ? 'var(--red)' : 'transparent'}`,
                background: isActive ? 'var(--red-dim)' : 'transparent',
                textDecoration: 'none', fontSize: 12, letterSpacing: '.03em', transition: 'all .15s',
              })}>
              <span style={{ fontSize: 14 }}>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}

          <div style={{ padding: '12px 16px 4px', fontSize: 9, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: '.12em', marginTop: 8 }}>AI Tools</div>
          <button onClick={() => setAiOpen(!aiOpen)} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', width: '100%',
            color: aiOpen ? 'var(--green)' : 'var(--muted)',
            borderLeft: `2px solid ${aiOpen ? 'var(--green)' : 'transparent'}`,
            background: aiOpen ? 'var(--green-dim)' : 'transparent',
            border: 'none', fontSize: 12, letterSpacing: '.03em', cursor: 'pointer',
          }}>
            <span>◎</span> AI Assistant
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', marginLeft: 'auto' }} />
          </button>
        </nav>

        <div style={{ padding: '12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ThemeToggle />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderRadius: 6, background: 'var(--surface2)' }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--red-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'var(--red)', flexShrink: 0 }}>
              {user?.full_name?.slice(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text)' }}>{user?.full_name}</div>
              <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{user?.role}</div>
            </div>
            <button onClick={() => { logout(); navigate('/login') }} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14 }} title="Logout">⇥</button>
          </div>
        </div>
      </aside>

      {/* Main + AI Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: aiOpen ? '1fr 340px' : '1fr', overflow: 'hidden' }}>
        <main style={{ overflowY: 'auto' }}>
          {children}
        </main>
        {aiOpen && <AIAssistant onClose={() => setAiOpen(false)} />}
      </div>
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ color: 'var(--red)', padding: 40, fontFamily: 'monospace' }}>Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <Toaster position="top-right" toastOptions={{
              style: { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'monospace', fontSize: 12 },
            }} />
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/*" element={
                <ProtectedRoute>
                  <AppShell>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/kanban" element={<Kanban />} />
                      <Route path="/engagements" element={<Engagements />} />
                      <Route path="/engagements/:id" element={<EngagementDetail />} />
                      <Route path="/findings" element={<Findings />} />
                      <Route path="/findings/:id" element={<FindingDetail />} />
                      <Route path="/reports" element={<Reports />} />
                      <Route path="/vulndb" element={<VulnDB />} />
                      <Route path="/settings" element={<Settings />} />
                    </Routes>
                  </AppShell>
                </ProtectedRoute>
              } />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
