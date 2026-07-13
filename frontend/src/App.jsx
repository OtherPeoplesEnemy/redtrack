import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from 'react-query'
import { Toaster } from 'react-hot-toast'
import { useAuth, AuthProvider } from './hooks/useAuth'
import { useTheme, ThemeProvider } from './hooks/useTheme'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Engagements from './pages/Engagements'
import EngagementDetail from './pages/EngagementDetail'
import Findings from './pages/Findings'
import FindingDetail from './pages/FindingDetail'
import Reports from './pages/Reports'
import VulnDB from './pages/VulnDB'
import Settings from './pages/Settings'
import Integrations from './pages/Integrations'
import TaskLibrary from './pages/TaskLibrary'
import Management from './pages/Management'
import Resources from './pages/Resources'
import Kanban from './pages/Kanban'
import SSOSettings from './pages/SSOSettings'
import SSOCallback from './pages/SSOCallback'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '⊡' },
  { to: '/engagements', label: 'Engagements', icon: '◈' },
  { to: '/kanban', label: 'Kanban', icon: '⊞' },
  { to: '/management', label: 'Management', icon: '◎' },
  { to: '/resources', label: 'Resources', icon: '🖥' },
  { to: '/findings', label: 'Findings', icon: '⚑' },
  { to: '/vulndb', label: 'Vuln DB', icon: '◉' },
  { to: '/task-library', label: 'Task Library', icon: '✓' },
  { to: '/reports', label: 'Reports', icon: '◧' },
  { to: '/integrations', label: 'Integrations', icon: '⟳' },
  { to: '/sso', label: 'SSO / Auth', icon: '🔐' },
  { to: '/settings', label: 'Settings', icon: '◎' },
]

function AppShell({ children }) {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'monospace' }}>
      {/* Sidebar */}
      <div style={{ width: 200, background: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--red)', letterSpacing: '.05em' }}>RED</div>
          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--text)', letterSpacing: '.05em' }}>TRACK</div>
          <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2, letterSpacing: '.1em' }}>PENTEST MGMT v2</div>
        </div>

        <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
          {NAV.map(({ to, label, icon }) => (
            <NavLink key={to} to={to}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 16px', fontSize: 11, textDecoration: 'none',
                color: isActive ? 'var(--red)' : 'var(--muted)',
                background: isActive ? 'var(--red-dim)' : 'transparent',
                borderLeft: isActive ? '2px solid var(--red)' : '2px solid transparent',
                transition: 'all .15s',
              })}>
              <span style={{ fontSize: 12 }}>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.full_name}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={toggleTheme} style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--muted)', padding: '4px 0', fontSize: 10, cursor: 'pointer' }}>
              {theme === 'dark' ? '☀ Light' : '◑ Dark'}
            </button>
            <button onClick={logout} style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--muted)', padding: '4px 0', fontSize: 10, cursor: 'pointer' }}>
              ⏻ Exit
            </button>
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {children}
      </div>
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ padding: 40, color: 'var(--muted)', fontFamily: 'monospace' }}>Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  return <AppShell>{children}</AppShell>
}

function AppRoutes() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/sso/callback" element={<SSOCallback />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/engagements" element={<ProtectedRoute><Engagements /></ProtectedRoute>} />
      <Route path="/engagements/:id" element={<ProtectedRoute><EngagementDetail /></ProtectedRoute>} />
      <Route path="/kanban" element={<ProtectedRoute><Kanban /></ProtectedRoute>} />
      <Route path="/resources" element={<ProtectedRoute><Resources /></ProtectedRoute>} />
                      <Route path="/management" element={<ProtectedRoute><Management /></ProtectedRoute>} />
      <Route path="/findings" element={<ProtectedRoute><Findings /></ProtectedRoute>} />
      <Route path="/findings/:id" element={<ProtectedRoute><FindingDetail /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
      <Route path="/vulndb" element={<ProtectedRoute><VulnDB /></ProtectedRoute>} />
      <Route path="/task-library" element={<ProtectedRoute><TaskLibrary /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/integrations" element={<ProtectedRoute><Integrations /></ProtectedRoute>} />
      <Route path="/sso" element={<ProtectedRoute><SSOSettings /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
            <Toaster position="bottom-right" toastOptions={{ style: { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', fontFamily: 'monospace', fontSize: 12 } }} />
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
