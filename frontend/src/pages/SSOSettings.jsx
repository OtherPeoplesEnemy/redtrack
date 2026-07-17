import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import { ssoApi } from '../api/client'
import toast from 'react-hot-toast'

export default function SSOSettings({ embedded = false }) {
  const qc = useQueryClient()

  const [samlForm, setSamlForm] = useState({
    saml_metadata_url: '', saml_idp_entity_id: '', saml_idp_sso_url: '', saml_idp_x509_cert: '',
    auto_provision: true, default_role: 'tester',
  })
  const [samlLoaded, setSamlLoaded] = useState(false)
  const [samlUseMetadataUrl, setSamlUseMetadataUrl] = useState(true)

  const [oidcForm, setOidcForm] = useState({
    oidc_issuer: '', oidc_client_id: '', oidc_client_secret: '',
    auto_provision: true, default_role: 'tester',
  })
  const [oidcLoaded, setOidcLoaded] = useState(false)

  const { data } = useQuery('sso-admin-config', () => ssoApi.adminGet().then(r => r.data), {
    onSuccess: (cfg) => {
      if (cfg.saml && !samlLoaded) {
        setSamlForm(f => ({
          ...f,
          saml_metadata_url: cfg.saml.saml_metadata_url || '',
          saml_idp_entity_id: cfg.saml.saml_idp_entity_id || '',
          saml_idp_sso_url: cfg.saml.saml_idp_sso_url || '',
          auto_provision: cfg.saml.auto_provision ?? true,
          default_role: cfg.saml.default_role || 'tester',
        }))
        setSamlUseMetadataUrl(!!cfg.saml.saml_metadata_url)
        setSamlLoaded(true)
      }
      if (cfg.oidc && !oidcLoaded) {
        setOidcForm(f => ({
          ...f,
          oidc_issuer: cfg.oidc.oidc_issuer || '',
          oidc_client_id: cfg.oidc.oidc_client_id || '',
          auto_provision: cfg.oidc.auto_provision ?? true,
          default_role: cfg.oidc.default_role || 'tester',
        }))
        setOidcLoaded(true)
      }
    },
  })

  const samlEnabled = data?.saml?.enabled || false
  const oidcEnabled = data?.oidc?.enabled || false

  const saveSaml = useMutation((body) => ssoApi.saveSaml(body), {
    onSuccess: () => { qc.invalidateQueries('sso-admin-config'); toast.success('SAML settings saved') },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to save SAML settings'),
  })

  const saveOidc = useMutation((body) => ssoApi.saveOidc(body), {
    onSuccess: () => { qc.invalidateQueries('sso-admin-config'); toast.success('OIDC settings saved') },
    onError: (e) => toast.error(e.response?.data?.detail || 'Failed to save OIDC settings'),
  })

  function submitSaml(enabled) {
    const body = { enabled, auto_provision: samlForm.auto_provision, default_role: samlForm.default_role }
    if (samlUseMetadataUrl) {
      body.saml_metadata_url = samlForm.saml_metadata_url
    } else {
      body.saml_idp_entity_id = samlForm.saml_idp_entity_id
      body.saml_idp_sso_url = samlForm.saml_idp_sso_url
      if (samlForm.saml_idp_x509_cert) body.saml_idp_x509_cert = samlForm.saml_idp_x509_cert
    }
    saveSaml.mutate(body)
  }

  function submitOidc(enabled) {
    const body = {
      enabled,
      oidc_issuer: oidcForm.oidc_issuer,
      oidc_client_id: oidcForm.oidc_client_id,
      auto_provision: oidcForm.auto_provision,
      default_role: oidcForm.default_role,
    }
    if (oidcForm.oidc_client_secret) body.oidc_client_secret = oidcForm.oidc_client_secret
    saveOidc.mutate(body)
  }

  const acsUrl = `${window.location.origin}/api/auth/sso/saml/acs`
  const spMetadataUrl = `${window.location.origin}/api/auth/sso/saml/metadata`
  const oidcRedirectUri = `${window.location.origin}/api/auth/sso/oidc/callback`

  return (
    <div style={embedded ? {} : s.page}>
      {!embedded && (
        <div style={s.topbar}>
          <div style={s.title}>Single Sign-On</div>
        </div>
      )}

      {/* SAML2 */}
      <div style={s.card}>
        <div style={s.cardHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 28 }}>🔐</div>
            <div>
              <div style={s.cardTitle}>SAML 2.0</div>
              <div style={s.cardSub}>Okta, Azure AD / Entra ID, ADFS, OneLogin, Ping, Google Workspace</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {samlEnabled && <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700 }}>● ACTIVE</span>}
            <button style={{ ...s.btn, ...(samlEnabled ? { color: 'var(--red)', borderColor: 'var(--red-mid)' } : {}) }}
              onClick={() => submitSaml(!samlEnabled)}>
              {samlEnabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        </div>

        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 12, marginBottom: 16 }}>
            <div style={s.hint}>Give these two values to your IdP admin when registering RedTrack as a Service Provider:</div>
            <div style={{ marginTop: 8, fontSize: 11, fontFamily: 'monospace' }}>
              <div style={{ color: 'var(--muted)' }}>ACS URL: <span style={{ color: 'var(--green)' }}>{acsUrl}</span></div>
              <div style={{ color: 'var(--muted)', marginTop: 4 }}>SP Metadata: <span style={{ color: 'var(--green)' }}>{spMetadataUrl}</span></div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button style={{ ...s.btn, ...(samlUseMetadataUrl ? { borderColor: 'var(--red-mid)', color: 'var(--red)' } : {}) }}
              onClick={() => setSamlUseMetadataUrl(true)}>Use metadata URL</button>
            <button style={{ ...s.btn, ...(!samlUseMetadataUrl ? { borderColor: 'var(--red-mid)', color: 'var(--red)' } : {}) }}
              onClick={() => setSamlUseMetadataUrl(false)}>Enter fields manually</button>
          </div>

          {samlUseMetadataUrl ? (
            <div style={{ marginBottom: 16 }}>
              <label style={s.label}>IdP Metadata URL *</label>
              <input style={s.input}
                value={samlForm.saml_metadata_url}
                onChange={e => setSamlForm({ ...samlForm, saml_metadata_url: e.target.value })}
                placeholder="https://your-idp.com/app/.../sso/saml/metadata" />
              <div style={s.hint}>We'll fetch this once on save and pull the entity ID, SSO URL, and signing cert automatically.</div>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 16 }}>
                <label style={s.label}>IdP Entity ID *</label>
                <input style={s.input}
                  value={samlForm.saml_idp_entity_id}
                  onChange={e => setSamlForm({ ...samlForm, saml_idp_entity_id: e.target.value })} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={s.label}>IdP SSO URL *</label>
                <input style={s.input}
                  value={samlForm.saml_idp_sso_url}
                  onChange={e => setSamlForm({ ...samlForm, saml_idp_sso_url: e.target.value })} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={s.label}>IdP x509 Certificate {data?.saml?.saml_idp_x509_cert_present && '(already set — leave blank to keep)'}</label>
                <textarea style={{ ...s.input, height: 90, fontSize: 10, resize: 'vertical' }}
                  value={samlForm.saml_idp_x509_cert}
                  onChange={e => setSamlForm({ ...samlForm, saml_idp_x509_cert: e.target.value })}
                  placeholder="-----BEGIN CERTIFICATE-----..." />
              </div>
            </>
          )}

          <ProvisioningFields form={samlForm} setForm={setSamlForm} />

          <button style={s.btnPrimary} onClick={() => submitSaml(samlEnabled)} disabled={saveSaml.isLoading}>
            {saveSaml.isLoading ? 'Saving…' : 'Save SAML Settings'}
          </button>
        </div>
      </div>

      {/* OIDC */}
      <div style={s.card}>
        <div style={s.cardHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 28 }}>🪪</div>
            <div>
              <div style={s.cardTitle}>OpenID Connect (OIDC)</div>
              <div style={s.cardSub}>Google, Azure AD, Okta, GitHub, or any OAuth2/OIDC provider</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {oidcEnabled && <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700 }}>● ACTIVE</span>}
            <button style={{ ...s.btn, ...(oidcEnabled ? { color: 'var(--red)', borderColor: 'var(--red-mid)' } : {}) }}
              onClick={() => submitOidc(!oidcEnabled)}>
              {oidcEnabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        </div>

        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 12, marginBottom: 16 }}>
            <div style={s.hint}>Register RedTrack as an OAuth application with your IdP using this redirect URI:</div>
            <div style={{ marginTop: 8, fontSize: 11, fontFamily: 'monospace', color: 'var(--green)' }}>{oidcRedirectUri}</div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={s.label}>Issuer URL *</label>
            <input style={s.input}
              value={oidcForm.oidc_issuer}
              onChange={e => setOidcForm({ ...oidcForm, oidc_issuer: e.target.value })}
              placeholder="https://your-tenant.okta.com or https://accounts.google.com" />
            <div style={s.hint}>Must serve <code style={{ background: 'var(--surface2)', padding: '1px 6px', borderRadius: 3 }}>/.well-known/openid-configuration</code>.</div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={s.label}>Client ID *</label>
            <input style={s.input}
              value={oidcForm.oidc_client_id}
              onChange={e => setOidcForm({ ...oidcForm, oidc_client_id: e.target.value })} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={s.label}>Client Secret {data?.oidc?.oidc_client_secret_present && '(already set — leave blank to keep)'}</label>
            <input style={s.input} type="password"
              value={oidcForm.oidc_client_secret}
              onChange={e => setOidcForm({ ...oidcForm, oidc_client_secret: e.target.value })} />
          </div>

          <ProvisioningFields form={oidcForm} setForm={setOidcForm} />

          <button style={s.btnPrimary} onClick={() => submitOidc(oidcEnabled)} disabled={saveOidc.isLoading}>
            {saveOidc.isLoading ? 'Saving…' : 'Save OIDC Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProvisioningFields({ form, setForm }) {
  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: 20, alignItems: 'flex-end' }}>
      <div style={{ flex: 1 }}>
        <label style={s.label}>Default role for new SSO users</label>
        <select style={s.input}
          value={form.default_role}
          onChange={e => setForm({ ...form, default_role: e.target.value })}>
          <option value="tester">Tester</option>
          <option value="lead">Lead</option>
          <option value="client">Client</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)', paddingBottom: 8, whiteSpace: 'nowrap' }}>
        <input type="checkbox" checked={form.auto_provision}
          onChange={e => setForm({ ...form, auto_provision: e.target.checked })} />
        Auto-create accounts on first login
      </label>
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
