import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import api from '../api/client'
import toast from 'react-hot-toast'

const PROVIDERS = [
  { id: '', label: 'Disabled — static inventory only' },
  { id: 'proxmox', label: 'Proxmox VE' },
  { id: 'kubevirt', label: 'OpenShift / KubeVirt (not yet implemented)' },
]

const BLANK_TEMPLATE = { name: '', provider_ref: '', licence_slot: '', cores: 4, memory_mb: 8192 }

export default function JumpBoxSettings() {
  const qc = useQueryClient()
  const [form, setForm] = useState(null)
  const [enabled, setEnabled] = useState(false)
  const [secret, setSecret] = useState('')
  const [testResult, setTestResult] = useState(null)

  const { data, isLoading } = useQuery(
    'vm-provisioning',
    () => api.get('/integrations/vm-provisioning').then(r => r.data),
    {
      onSuccess: (d) => {
        if (form === null) {
          setForm({
            provider: d.config.provider || '',
            proxmox_url: d.config.proxmox_url || '',
            proxmox_token_id: d.config.proxmox_token_id || '',
            proxmox_node: d.config.proxmox_node || 'pve',
            proxmox_storage: d.config.proxmox_storage || 'local-lvm',
            proxmox_bridge: d.config.proxmox_bridge || 'vmbr0',
            proxmox_verify_tls: d.config.proxmox_verify_tls ?? true,
            proxmox_full_clone: d.config.proxmox_full_clone ?? true,
            kubevirt_namespace: d.config.kubevirt_namespace || 'redtrack-jumpboxes',
            templates: d.config.templates?.length ? d.config.templates : [],
          })
          setEnabled(d.enabled)
        }
      },
    }
  )

  const saveMutation = useMutation(
    (payload) => api.put('/integrations/vm-provisioning', payload),
    {
      onSuccess: () => {
        qc.invalidateQueries('vm-provisioning')
        qc.invalidateQueries('vm-templates')
        setSecret('')
        toast.success('Provisioning settings saved')
      },
      onError: (e) => toast.error(e.response?.data?.detail || 'Save failed'),
    }
  )

  const [testing, setTesting] = useState(false)
  async function runTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const { data } = await api.post('/integrations/vm-provisioning/test')
      setTestResult(data)
      data.ok ? toast.success(data.message) : toast.error(data.message)
    } catch (e) {
      const msg = e.response?.data?.detail || 'Connection test failed'
      setTestResult({ ok: false, message: msg })
      toast.error(msg)
    } finally {
      setTesting(false)
    }
  }

  function save() {
    saveMutation.mutate({
      enabled,
      config: { ...form, proxmox_token_secret: secret },
    })
  }

  function updateTemplate(i, patch) {
    const next = [...form.templates]
    next[i] = { ...next[i], ...patch }
    setForm({ ...form, templates: next })
  }

  if (isLoading || !form) return <div style={s.muted}>Loading…</div>

  const isProxmox = form.provider === 'proxmox'
  const secretSet = data?.config?.proxmox_token_secret_set
  const dirty = saveMutation.isLoading

  return (
    <div>
      <div style={s.sectionTitle}>Jump Box VM Provisioning</div>
      <div style={s.help}>
        When enabled, checking out an ephemeral jump box clones a golden template
        into a fresh VM; checking in destroys it. Each template carries its own
        licensed tooling, so the number of templates is your concurrency cap.
        Changes take effect immediately — no restart.
      </div>

      {/* Provider */}
      <div style={s.card}>
        <div style={{ marginBottom: 14 }}>
          <label style={s.label}>Provider</label>
          <select style={s.input} value={form.provider}
            onChange={e => setForm({ ...form, provider: e.target.value })}>
            {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}
            style={{ width: 14, height: 14, cursor: 'pointer' }} />
          <span style={{ fontSize: 12, color: 'var(--text)' }}>
            Enable provisioning
          </span>
          <span style={{ fontSize: 10, color: 'var(--muted)' }}>
            (off = every jump box behaves as static inventory)
          </span>
        </label>
      </div>

      {/* Proxmox connection */}
      {isProxmox && (
        <div style={s.card}>
          <div style={s.cardTitle}>Proxmox Connection</div>

          <div style={{ marginBottom: 12 }}>
            <label style={s.label}>API URL *</label>
            <input style={s.input} value={form.proxmox_url}
              onChange={e => setForm({ ...form, proxmox_url: e.target.value })}
              placeholder="https://pve.example.com:8006" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>API Token ID *</label>
              <input style={s.input} value={form.proxmox_token_id}
                onChange={e => setForm({ ...form, proxmox_token_id: e.target.value })}
                placeholder="redtrack@pve!provisioner" />
            </div>
            <div>
              <label style={s.label}>API Token Secret {secretSet && <span style={{ color: '#4ade80' }}>● set</span>}</label>
              <input style={s.input} type="password" value={secret}
                onChange={e => setSecret(e.target.value)}
                placeholder={secretSet ? 'Leave blank to keep current' : 'Paste the token secret'} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Node</label>
              <input style={s.input} value={form.proxmox_node}
                onChange={e => setForm({ ...form, proxmox_node: e.target.value })} />
            </div>
            <div>
              <label style={s.label}>Storage</label>
              <input style={s.input} value={form.proxmox_storage}
                onChange={e => setForm({ ...form, proxmox_storage: e.target.value })} />
            </div>
            <div>
              <label style={s.label}>Bridge</label>
              <input style={s.input} value={form.proxmox_bridge}
                onChange={e => setForm({ ...form, proxmox_bridge: e.target.value })} />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 8 }}>
            <input type="checkbox" checked={form.proxmox_verify_tls}
              onChange={e => setForm({ ...form, proxmox_verify_tls: e.target.checked })}
              style={{ width: 14, height: 14, cursor: 'pointer' }} />
            <span style={{ fontSize: 11, color: 'var(--text)' }}>Verify TLS certificate</span>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>uncheck for a self-signed PVE cert</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.proxmox_full_clone}
              onChange={e => setForm({ ...form, proxmox_full_clone: e.target.checked })}
              style={{ width: 14, height: 14, cursor: 'pointer' }} />
            <span style={{ fontSize: 11, color: 'var(--text)' }}>Full clone</span>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>
              slower, but you can patch or delete a template while clones exist
            </span>
          </label>
        </div>
      )}

      {/* Templates */}
      {form.provider && (
        <div style={s.card}>
          <div style={s.cardTitle}>Golden Templates</div>
          <div style={{ ...s.help, marginBottom: 14 }}>
            One entry per licensed template. The template ID is the Proxmox VMID.
            Each needs <code style={s.code}>qemu-guest-agent</code> installed and
            cloud-init enabled, with no baked-in SSH keys.
          </div>

          {form.templates.length === 0 && (
            <div style={{ ...s.muted, padding: '12px 0' }}>No templates configured yet.</div>
          )}

          {form.templates.map((t, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1.2fr auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
              <div>
                {i === 0 && <label style={s.label}>Name</label>}
                <input style={s.input} value={t.name}
                  onChange={e => updateTemplate(i, { name: e.target.value })}
                  placeholder="kali-burp-1" />
              </div>
              <div>
                {i === 0 && <label style={s.label}>Template ID</label>}
                <input style={s.input} value={t.provider_ref}
                  onChange={e => updateTemplate(i, { provider_ref: e.target.value })}
                  placeholder="9001" />
              </div>
              <div>
                {i === 0 && <label style={s.label}>Licence slot</label>}
                <input style={s.input} value={t.licence_slot}
                  onChange={e => updateTemplate(i, { licence_slot: e.target.value })}
                  placeholder="burp-pro-1" />
              </div>
              <button style={{ ...s.btn, color: 'var(--red)', borderColor: 'var(--red-mid)' }}
                onClick={() => setForm({ ...form, templates: form.templates.filter((_, j) => j !== i) })}>
                ×
              </button>
            </div>
          ))}

          <button style={{ ...s.btn, marginTop: 6 }}
            onClick={() => setForm({ ...form, templates: [...form.templates, { ...BLANK_TEMPLATE }] })}>
            + Add template
          </button>
        </div>
      )}

      {/* Test result */}
      {testResult && (
        <div style={{
          ...s.card,
          borderColor: testResult.ok ? '#4ade8055' : 'var(--red-mid)',
          background: testResult.ok ? 'var(--green-dim)' : 'var(--red-dim, var(--surface2))',
        }}>
          <div style={{ fontSize: 12, color: testResult.ok ? '#4ade80' : 'var(--red)' }}>
            {testResult.ok ? '✓ ' : '⚠ '}{testResult.message}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <button style={s.btnPrimary} onClick={save} disabled={dirty}>
          {dirty ? 'Saving…' : 'Save Settings'}
        </button>
        {form.provider && (
          <button style={s.btn} onClick={runTest} disabled={testing}>
            {testing ? 'Testing…' : '⚡ Test Connection'}
          </button>
        )}
      </div>
      <div style={{ ...s.help, marginTop: 10 }}>
        Test checks the <em>saved</em> config, so save first — that way what you
        verify is what checkout will use.
      </div>
    </div>
  )
}

const s = {
  sectionTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 },
  cardTitle: { fontSize: 11, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 14 },
  help: { fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 18 },
  muted: { fontSize: 11, color: 'var(--muted)' },
  card: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 16 },
  label: { fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', display: 'block', marginBottom: 5, fontWeight: 700 },
  input: { width: '100%', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' },
  code: { background: 'var(--surface)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace' },
  btn: { background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnPrimary: { background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '7px 16px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
}
