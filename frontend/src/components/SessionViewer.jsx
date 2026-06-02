import { useState } from 'react'
import { useQuery } from 'react-query'
import api from '../api/client'

export default function SessionViewer({ jumpboxId, jumpboxName, onClose }) {
  const [selectedSession, setSelectedSession] = useState(null)
  const [searchCmd, setSearchCmd] = useState('')

  const { data: sessions = [], isLoading } = useQuery(
    ['sessions', jumpboxId],
    () => api.get(`/jumpboxes/${jumpboxId}/sessions`).then(r => r.data),
    { enabled: !!jumpboxId, refetchInterval: 10000 }
  )

  const { data: sessionDetail } = useQuery(
    ['session-detail', selectedSession],
    () => api.get(`/jumpboxes/sessions/${selectedSession}`).then(r => r.data),
    { enabled: !!selectedSession }
  )

  function formatDuration(secs) {
    if (!secs) return 'Active'
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  const filteredCommands = sessionDetail?.commands?.filter(c =>
    !searchCmd || c.command.toLowerCase().includes(searchCmd.toLowerCase()) ||
    c.output?.toLowerCase().includes(searchCmd.toLowerCase())
  ) || []

  return (
    <div style={s.overlay}>
      <div style={s.panel}>
        {/* Header */}
        <div style={s.header}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              🖥 {jumpboxName} — Session History
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sessions.length} sessions recorded</div>
          </div>
          <button style={s.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Session list */}
          <div style={s.sessionList}>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>Sessions</div>
            {isLoading && <div style={{ padding: 16, color: 'var(--muted)', fontSize: 12 }}>Loading...</div>}
            {sessions.map(s => (
              <div key={s.id} onClick={() => setSelectedSession(s.id)}
                style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: selectedSession === s.id ? 'var(--red-dim)' : 'transparent', borderLeft: selectedSession === s.id ? '2px solid var(--red)' : '2px solid transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>@{s.username}</span>
                  <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: s.status === 'active' ? '#4ade8022' : 'var(--surface2)', color: s.status === 'active' ? '#4ade80' : 'var(--muted)', border: `1px solid ${s.status === 'active' ? '#4ade8055' : 'var(--border)'}` }}>
                    {s.status === 'active' ? '● LIVE' : 'Done'}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
                  {s.started_at?.slice(0, 16).replace('T', ' ')}
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                  {s.command_count} cmds · {formatDuration(s.duration_seconds)}
                </div>
              </div>
            ))}
            {sessions.length === 0 && !isLoading && (
              <div style={{ padding: 20, color: 'var(--muted)', fontSize: 11, textAlign: 'center' }}>
                No sessions yet.<br />Use redtrack-cli to start recording.
              </div>
            )}
          </div>

          {/* Session detail */}
          <div style={s.detail}>
            {!selectedSession ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 12 }}>
                Select a session to view commands
              </div>
            ) : !sessionDetail ? (
              <div style={{ padding: 20, color: 'var(--muted)', fontSize: 12 }}>Loading...</div>
            ) : (
              <>
                {/* Session info bar */}
                <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>@{sessionDetail.username}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{sessionDetail.started_at?.slice(0, 16).replace('T', ' ')}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{formatDuration(sessionDetail.duration_seconds)}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{sessionDetail.commands?.length} commands</span>
                  <div style={{ marginLeft: 'auto' }}>
                    <input style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', padding: '4px 8px', fontSize: 11, fontFamily: 'monospace', outline: 'none', width: 180 }}
                      placeholder="Search commands..." value={searchCmd} onChange={e => setSearchCmd(e.target.value)} />
                  </div>
                </div>

                {/* Commands */}
                <div style={{ flex: 1, overflowY: 'auto', background: '#0d1117', padding: 0 }}>
                  {filteredCommands.length === 0 ? (
                    <div style={{ padding: 20, color: '#6b7899', fontSize: 12, textAlign: 'center' }}>
                      {searchCmd ? 'No commands match your search' : 'No commands recorded yet'}
                    </div>
                  ) : filteredCommands.map((cmd, i) => (
                    <div key={i} style={{ borderBottom: '1px solid #1c2128', padding: '8px 16px' }}>
                      {/* Timestamp + cwd */}
                      <div style={{ fontSize: 10, color: '#6b7899', fontFamily: 'monospace', marginBottom: 4 }}>
                        <span style={{ color: '#388bfd' }}>[{cmd.timestamp?.slice(0, 19).replace('T', ' ')}]</span>
                        {cmd.cwd && <span style={{ color: '#3fb950', marginLeft: 8 }}>{cmd.cwd}</span>}
                      </div>
                      {/* Command */}
                      <div style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: '#f47067' }}>$ </span>
                        <span style={{ color: '#e6edf3' }}>{cmd.command}</span>
                        {cmd.exit_code !== null && cmd.exit_code !== 0 && (
                          <span style={{ color: '#f47067', marginLeft: 8, fontSize: 10 }}>[exit: {cmd.exit_code}]</span>
                        )}
                      </div>
                      {/* Output */}
                      {cmd.output && (
                        <pre style={{ fontFamily: 'monospace', fontSize: 11, color: '#8b949e', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto', background: '#161b22', borderRadius: 4, padding: '6px 8px' }}>
                          {cmd.output.slice(0, 2000)}{cmd.output.length > 2000 ? '\n... (truncated)' : ''}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const s = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 },
  panel: { background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, width: '95vw', maxWidth: 1100, height: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  closeBtn: { background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 24, lineHeight: 1 },
  sessionList: { width: 220, borderRight: '1px solid var(--border)', overflowY: 'auto', flexShrink: 0 },
  detail: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
}
