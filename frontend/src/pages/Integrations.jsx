import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import api from '../api/client'
import toast from 'react-hot-toast'

export default function Integrations() {
  const qc = useQueryClient()
  const [slackForm, setSlackForm] = useState({ webhook_url: '', base_url: '', signing_secret: '', notify_critical: true, notify_high: true, notify_new_engagement: true, notify_remediated: false })
  const [slackLoaded, setSlackLoaded] = useState(false)
  const [testing, setTesting] = useState(false)
  const [sendingDigest, setSendingDigest] = useState(false)

  const { data: integrations = [] } = useQuery('integrations', () => api.get('/integrations/').then(r => r.data), {
    onSuccess: (data) => {
      const slack = data.find(i => i.name === 'slack')
      if (slack && !slackLoaded) {
        setSlackForm({ webhook_url: slack.config?.webhook_url || '', base_url: slack.config?.base_url || '', signing_secret: slack.config?.signing_secret || '', notify_critical: slack.config?.notify_critical ?? true, notify_high: slack.config?.notify_high ?? true, notify_new_engagement: slack.config?.notify_new_engagement ?? true, notify_remediated: slack.config?.notify_remediated ?? false })
        setSlackLoaded(true)
      }
    }
  })

  const slack = integrations.find(i => i.name === 'slack')
  const slackEnabled = slack?.enabled || false

  const saveMutation = useMutation(
    (data) => api.put('/integrations/slack', data),
    { onSuccess: () => { qc.invalidateQueries('integrations'); toast.success('Slack integration saved') }, onError: () => toast.error('Failed to save') }
  )

  async function testSlack() {
    setTesting(true)
    try {
      await api.post('/integrations/slack/test')
      toast.success('Test message sent to Slack!')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Test failed')
    } finally { setTesting(false) }
  }

  async function sendDigest() {
    setSendingDigest(true)
    try {
      await api.post('/integrations/slack/digest')
      toast.success('Daily digest sent to Slack!')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to send digest')
    } finally { setSendingDigest(false) }
  }

  function saveSlack(enabled) {
    saveMutation.mutate({
      enabled,
      config: {
        webhook_url: slackForm.webhook_url,
        base_url: slackForm.base_url,
        signing_secret: slackForm.signing_secret,
        notify_critical: slackForm.notify_critical,
        notify_high: slackForm.notify_high,
        notify_new_engagement: slackForm.notify_new_engagement,
        notify_remediated: slackForm.notify_remediated,
      }
    })
  }

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <div style={s.title}>Integrations</div>
      </div>

      {/* Slack */}
      <div style={s.card}>
        <div style={s.cardHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 28 }}>💬</div>
            <div>
              <div style={s.cardTitle}>Slack</div>
              <div style={s.cardSub}>Notifications and slash commands via Slack</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {slackEnabled && <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700 }}>● ACTIVE</span>}
            <button style={{ ...s.btn, ...(slackEnabled ? { color: 'var(--red)', borderColor: 'var(--red-mid)' } : {}) }}
              onClick={() => saveSlack(!slackEnabled)}>
              {slackEnabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        </div>

        <div style={{ padding: '0 20px 20px' }}>
          {/* Webhook URL */}
          <div style={{ marginBottom: 16 }}>
            <label style={s.label}>Webhook URL *</label>
            <input style={s.input} type="password"
              value={slackForm.webhook_url}
              onChange={e => setSlackForm({ ...slackForm, webhook_url: e.target.value })}
              placeholder="https://hooks.slack.com/services/..." />
            <div style={s.hint}>
              Get from: <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>api.slack.com/apps</a> → Your App → Incoming Webhooks → Add New Webhook
            </div>
          </div>

          {/* Base URL */}
          <div style={{ marginBottom: 16 }}>
            <label style={s.label}>RedTrack Public URL *</label>
            <input style={s.input}
              value={slackForm.base_url}
              onChange={e => setSlackForm({ ...slackForm, base_url: e.target.value })}
              placeholder="https://redtrack.yourdomain.com" />
            <div style={s.hint}>Your public URL (via Cloudflare Tunnel). Used for deep links in Slack messages.</div>
          </div>

          {/* Signing Secret */}
          <div style={{ marginBottom: 20 }}>
            <label style={s.label}>Signing Secret (for slash commands)</label>
            <input style={s.input} type="password"
              value={slackForm.signing_secret}
              onChange={e => setSlackForm({ ...slackForm, signing_secret: e.target.value })}
              placeholder="From Slack App → Basic Information → Signing Secret" />
            <div style={s.hint}>Required for slash commands (/redtrack). Not needed for webhook-only notifications.</div>
          </div>

          {/* Notification toggles */}
          <div style={{ marginBottom: 20 }}>
            <div style={s.label}>Notifications</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                ['notify_new_engagement', 'New engagement created'],
                ['notify_critical', 'Critical finding discovered'],
                ['notify_high', 'High finding discovered'],
                ['notify_remediated', 'Finding marked as remediated'],
              ].map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={slackForm[key]}
                    onChange={e => setSlackForm({ ...slackForm, [key]: e.target.checked })}
                    style={{ width: 14, height: 14, cursor: 'pointer' }} />
                  <span style={{ fontSize: 12, color: 'var(--text)' }}>{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <button style={s.btnPrimary} onClick={() => saveSlack(slackEnabled)} disabled={saveMutation.isLoading}>
              {saveMutation.isLoading ? 'Saving...' : 'Save Settings'}
            </button>
            {slackEnabled && (
              <>
                <button style={s.btn} onClick={testSlack} disabled={testing}>
                  {testing ? 'Sending...' : '📤 Send Test Message'}
                </button>
                <button style={s.btn} onClick={sendDigest} disabled={sendingDigest}>
                  {sendingDigest ? 'Sending...' : '📊 Send Daily Digest Now'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Slash commands setup */}
        <div style={{ margin: '0 20px 20px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.08em' }}>
            Slash Commands Setup
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.8, marginBottom: 12 }}>
            To enable <code style={{ background: 'var(--surface)', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>/redtrack</code> slash commands:
          </div>
          <ol style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 2, paddingLeft: 20 }}>
            <li>Set up Cloudflare Tunnel (see below)</li>
            <li>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>api.slack.com/apps</a> → Your App → Slash Commands</li>
            <li>Create command: <code style={{ background: 'var(--surface)', padding: '1px 6px', borderRadius: 3 }}>/redtrack</code></li>
            <li>Request URL: <code style={{ background: 'var(--surface)', padding: '1px 6px', borderRadius: 3 }}>{slackForm.base_url || 'https://your-url'}/api/integrations/slack/commands</code></li>
            <li>Add Signing Secret above and save</li>
          </ol>
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>Available commands:</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 2, fontFamily: 'monospace' }}>
            /redtrack status — Active engagements<br/>
            /redtrack critical — Open critical findings<br/>
            /redtrack findings ENG-001 — Findings for engagement<br/>
            /redtrack finding F-003 — Finding details<br/>
            /redtrack help — Show all commands
          </div>
        </div>
      </div>

      {/* Cloudflare Tunnel Setup */}
      <div style={s.card}>
        <div style={s.cardHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 28 }}>🌐</div>
            <div>
              <div style={s.cardTitle}>Cloudflare Tunnel</div>
              <div style={s.cardSub}>Expose RedTrack publicly for Slack slash commands</div>
            </div>
          </div>
        </div>
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 2, marginBottom: 16 }}>
            Cloudflare Tunnel creates a secure public URL for your internal RedTrack instance. Required for Slack slash commands.
          </div>
          <ol style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 2.2, paddingLeft: 20, marginBottom: 16 }}>
            <li>Go to <a href="https://one.dash.cloudflare.com/" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>one.dash.cloudflare.com</a> → Zero Trust → Networks → Tunnels</li>
            <li>Create a tunnel → name it <strong style={{ color: 'var(--text)' }}>redtrack</strong></li>
            <li>Copy the tunnel token</li>
            <li>Add to your <code style={{ background: 'var(--surface2)', padding: '1px 6px', borderRadius: 3 }}>.env</code> file on the server:</li>
          </ol>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 12, fontFamily: 'monospace', fontSize: 11, color: 'var(--green)', marginBottom: 16 }}>
            CLOUDFLARE_TUNNEL_TOKEN=your-token-here
          </div>
          <div style={{ marginBottom: 12, fontSize: 11, color: 'var(--muted)' }}>Then start the tunnel container:</div>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 12, fontFamily: 'monospace', fontSize: 11, color: 'var(--green)', marginBottom: 16 }}>
            docker compose --profile cloudflare up -d cloudflared
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.8 }}>
            Configure the tunnel in Cloudflare dashboard to route <strong style={{ color: 'var(--text)' }}>your-domain.com → https://nginx:443</strong> (internal hostname).
            Then set that domain as your RedTrack Public URL above.
          </div>
        </div>
      </div>

      {/* Coming Soon */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {[
          { emoji: '🎫', name: 'Jira', sub: 'Auto-create tickets from findings', soon: true },
          { emoji: '🔔', name: 'ServiceNow', sub: 'Create incidents from findings', soon: true },
          { emoji: '📧', name: 'Email', sub: 'Send reports to client contacts', soon: true },
          { emoji: '👥', name: 'Microsoft Teams', sub: 'Notifications via Teams webhooks', soon: true },
        ].map(({ emoji, name, sub }) => (
          <div key={name} style={{ ...s.card, opacity: 0.6 }}>
            <div style={{ ...s.cardHeader, paddingBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 24 }}>{emoji}</div>
                <div>
                  <div style={s.cardTitle}>{name}</div>
                  <div style={s.cardSub}>{sub}</div>
                </div>
              </div>
              <span style={{ fontSize: 10, color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px' }}>Coming Soon</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const s = {
  page: { padding: 24, maxWidth: 900, margin: '0 auto' },
  topbar: { marginBottom: 20 },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text)' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 16, overflow: 'hidden' },
  cardHeader: { padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' },
  cardTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
  cardSub: { fontSize: 11, color: 'var(--muted)', marginTop: 2 },
  label: { fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', display: 'block', marginBottom: 6, fontWeight: 700 },
  input: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '8px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' },
  hint: { fontSize: 10, color: 'var(--muted2)', marginTop: 5, lineHeight: 1.5 },
  btn: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnPrimary: { background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '7px 16px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
}
