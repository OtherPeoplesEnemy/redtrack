import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import { engagementsApi, findingsApi, reconApi, reportsApi, aiApi } from '../api/client'
import MitreBoard from './MitreBoard'
import EngagementReports from '../components/EngagementReports'
import TaskBoard from './TaskBoard'
import toast from 'react-hot-toast'
import ReactMarkdown from 'react-markdown'

const TABS = ['Overview', 'Scope', 'Recon', 'Findings', 'Tasks', 'Notes', 'Team', 'Reports', 'MITRE']
const AI_TABS = ['Overview', 'Scope', 'Recon', 'Kill Chain', 'Findings', 'Tasks', 'Notes', 'Team', 'Reports', 'MITRE ATLAS']

const SEV_COLOR = { Critical: '#e05252', High: '#f0883e', Medium: '#fbbf24', Low: '#60a5fa', Info: '#6b7899' }

const AI_KILL_CHAIN = [
  { id: 1, name: 'Preparation & Targeting', nvidia: 'Prep', atlas: 'N/A', owasp: 'N/A', desc: 'Define scope, threat model the AI architecture, identify high-value targets (PII, training data). Black box vs White box determination.' },
  { id: 2, name: 'Reconnaissance & Intelligence Gathering', nvidia: 'Recon', atlas: 'AML.TA0000, AML.TA0001', owasp: 'LLM06', desc: 'Probe the model to understand boundaries. Identify model version, test for system prompt leakage, fingerprint AI frameworks (RAG, etc.).' },
  { id: 3, name: 'Vulnerability Research & Weaponization', nvidia: 'Poison', atlas: 'AML.TA0003, AML.T0043', owasp: 'LLM01, LLM03', desc: 'Develop payloads to bypass safety filters. Craft adversarial examples and jailbreak prompts to override ethical alignment.' },
  { id: 4, name: 'Delivery & Exploitation', nvidia: 'Hijack', atlas: 'AML.TA0002, AML.T0096', owasp: 'LLM01, LLM02', desc: 'Launch attack against AI endpoint. Trigger prompt injection, indirect injection via data sources the AI crawls.' },
  { id: 5, name: 'Installation & Persistence', nvidia: 'Persist', atlas: 'AML.TA0004', owasp: 'LLM03, LLM05', desc: 'Poison memory or RAG database for persistent malicious outputs beyond the initial session.' },
  { id: 6, name: 'Actions on Objectives', nvidia: 'Impact', atlas: 'AML.TA0005', owasp: 'LLM06, LLM08, LLM10', desc: 'Data exfiltration, model hijacking as pivot point, forced misinformation/harmful content generation.' },
  { id: 7, name: 'Impact Evaluation & Reporting', nvidia: 'Report', atlas: 'N/A', owasp: 'N/A', desc: 'Calculate blast radius, document measurable harm, provide actionable remediation steps.' },
]

const PHASE_COLORS = { 'Not Started': 'var(--muted)', 'In Progress': '#f0883e', 'Completed': '#4ade80', 'N/A': 'var(--muted2)' }

export default function EngagementDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState('Overview')
  const [editField, setEditField] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [phaseStatuses, setPhaseStatuses] = useState({})
  const [phaseNotes, setPhaseNotes] = useState({})
  const [aiPhaseLoading, setAiPhaseLoading] = useState(null)
  const [aiPhaseResults, setAiPhaseResults] = useState({})
  const [newHost, setNewHost] = useState({ ip_address: '', hostname: '', os: '', ports: '', notes: '' })
  const [editHost, setEditHost] = useState(null)
  const [editHostVal, setEditHostVal] = useState({})
  const [selectedHosts, setSelectedHosts] = useState([])
  const [massEditField, setMassEditField] = useState('')
  const [massEditVal, setMassEditVal] = useState('')
  const [showAddHost, setShowAddHost] = useState(false)
  const [nmapUploading, setNmapUploading] = useState(false)
  const [scannerType, setScannerType] = useState('nessus')
  const [scanImporting, setScanImporting] = useState(false)
  const [importFindings, setImportFindings] = useState(true)
  const [minSeverity, setMinSeverity] = useState('Medium')
  const [showScanImport, setShowScanImport] = useState(false)

  const { data: eng, isLoading } = useQuery(['engagement', id], () =>
    engagementsApi.get(id).then(r => r.data)
  )
  const { data: findings = [] } = useQuery(['findings', id], () =>
    findingsApi.list({ engagement_id: id }).then(r => r.data)
  )
  const { data: hosts = [] } = useQuery(['hosts', id], () =>
    reconApi.listHosts(id).then(r => r.data)
  )
  const { data: reports = [] } = useQuery(['reports', id], () =>
    reportsApi.listByEngagement(id).then(r => r.data)
  )

  const deleteMutation = useMutation(
    () => engagementsApi.delete(id),
    {
      onSuccess: () => { navigate('/engagements'); toast.success('Engagement deleted') },
      onError: () => toast.error('Failed to delete'),
    }
  )

  const updateMutation = useMutation(
    (data) => engagementsApi.update(id, data),
    { onSuccess: () => { qc.invalidateQueries(['engagement', id]); setEditField(null); toast.success('Saved') } }
  )

  const addHostMutation = useMutation(
    (data) => reconApi.addHost(id, data),
    { onSuccess: () => { qc.invalidateQueries(['hosts', id]); setShowAddHost(false); setNewHost({ ip_address: '', hostname: '', os: '', ports: '', notes: '' }); toast.success('Host added') } }
  )

  const deleteHostMutation = useMutation(
    (hostId) => reconApi.deleteHost(hostId),
    { onSuccess: () => { qc.invalidateQueries(['hosts', id]); toast.success('Host deleted') } }
  )

  const updateHostMutation = useMutation(
    ({ hostId, data }) => import('../api/client').then(m => m.default.patch(`/recon/hosts/${hostId}`, data)),
    { onSuccess: () => { qc.invalidateQueries(['hosts', id]); setEditHost(null); toast.success('Host updated') } }
  )

  async function importScan(file) {
    setScanImporting(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await import('../api/client').then(m => m.default.post(
        `/recon/${id}/scan-import?scanner=${scannerType}&import_findings=${importFindings}&min_severity=${minSeverity}`,
        fd, { headers: { 'Content-Type': 'multipart/form-data' } }
      ))
      qc.invalidateQueries(['hosts', id])
      qc.invalidateQueries(['findings', id])
      toast.success(data.message)
      setShowScanImport(false)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Import failed')
    } finally {
      setScanImporting(false)
    }
  }

  async function massDelete() {
    if (!selectedHosts.length) return
    if (!confirm(`Delete ${selectedHosts.length} selected hosts?`)) return
    await Promise.all(selectedHosts.map(hid => reconApi.deleteHost(hid)))
    qc.invalidateQueries(['hosts', id])
    setSelectedHosts([])
    toast.success(`Deleted ${selectedHosts.length} hosts`)
  }

  async function massEdit() {
    if (!selectedHosts.length || !massEditField || !massEditVal) return
    await Promise.all(selectedHosts.map(hid =>
      import('../api/client').then(m => m.default.patch(`/recon/hosts/${hid}`, { [massEditField]: massEditVal }))
    ))
    qc.invalidateQueries(['hosts', id])
    setSelectedHosts([])
    setMassEditField('')
    setMassEditVal('')
    toast.success(`Updated ${selectedHosts.length} hosts`)
  }

  function toggleSelectAll() {
    if (selectedHosts.length === hosts.length) {
      setSelectedHosts([])
    } else {
      setSelectedHosts(hosts.map(h => h.id))
    }
  }

  function toggleSelect(hid) {
    setSelectedHosts(prev => prev.includes(hid) ? prev.filter(id => id !== hid) : [...prev, hid])
  }

  async function uploadNmap(file) {
    setNmapUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await import('../api/client').then(m => m.default.post(`/recon/${id}/nmap-upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }))
      qc.invalidateQueries(['hosts', id])
      toast.success(`Nmap import: ${data.added} new hosts added`)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Nmap import failed')
    } finally {
      setNmapUploading(false)
    }
  }

  async function runAiPhase(phase) {
    setAiPhaseLoading(phase.id)
    try {
      const context = `Phase: ${phase.name}\nObjective: ${phase.desc}\nEngagement: ${eng?.client} (${eng?.type})\nScope: ${eng?.scope || 'Not specified'}`
      const { data } = await aiApi.analyzePhase(phase.name, context)
      setAiPhaseResults({ ...aiPhaseResults, [phase.id]: data.content })
    } catch {
      toast.error('AI request failed')
    } finally {
      setAiPhaseLoading(null)
    }
  }

  function startEdit(field, val) {
    setEditField(field)
    setEditVal(val || '')
  }

  function saveEdit() {
    updateMutation.mutate({ [editField]: editVal })
  }

  if (isLoading) return <div style={s.loading}>Loading...</div>
  if (!eng) return <div style={s.loading}>Engagement not found</div>

  const isAiRedTeam = eng.type === 'AI Red Team'
  const tabs = isAiRedTeam ? AI_TABS : TABS
  const sortedFindings = [...findings].sort((a, b) => {
    const o = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 }
    return (o[a.severity] || 5) - (o[b.severity] || 5)
  })

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <button onClick={() => navigate('/engagements')} style={{ ...s.back, marginBottom: 0 }}>← Engagements</button>
        <button style={{ background: 'none', border: '1px solid var(--red-mid)', borderRadius: 5, color: 'var(--red)', padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' }}
          onClick={() => { if (confirm('Delete ' + eng.name + '? This will permanently delete all findings, recon, tasks, and data.')) deleteMutation.mutate() }}>
          🗑 Delete Engagement
        </button>
      </div>

      {/* Header */}
      <div style={s.header}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ ...s.badge, color: '#60a5fa', borderColor: '#60a5fa55', background: 'var(--blue-dim)' }}>{eng.type}</span>
            <span style={{ ...s.badge, color: eng.status === 'Active' ? '#4ade80' : 'var(--muted)', borderColor: 'var(--border)' }}>{eng.status}</span>
            <span style={{ ...s.badge, color: 'var(--muted)', borderColor: 'var(--border)' }}>{eng.ref_id}</span>
          </div>
          <h1 style={s.title}>{eng.name}</h1>
          <div style={s.subtitle}>{eng.client}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[['Findings', findings.length, 'var(--text)'], ['Critical', findings.filter(f => f.severity === 'Critical').length, '#e05252'], ['Open', findings.filter(f => f.status === 'Open').length, '#f0883e'], ['Remediated', findings.filter(f => f.status === 'Remediated').length, '#4ade80']].map(([l, v, c]) => (
            <div key={l} style={s.statBox}>
              <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 4 }}>{l}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: c, fontFamily: 'monospace' }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}>
            {t === 'Kill Chain' ? '⚡ ' + t : t === 'MITRE ATLAS' ? '🎯 ' + t : t === 'MITRE' ? '🎯 ' + t : t}
          </button>
        ))}
      </div>

      <div style={s.tabContent}>

        {/* ── Overview ── */}
        {tab === 'Overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              ['name', 'Engagement Name', eng.name],
              ['client', 'Client', eng.client],
              ['client_contact', 'Client Contact', eng.client_contact],
              ['client_email', 'Client Email', eng.client_email],
              ['methodology', 'Methodology', eng.methodology],
            ].map(([field, label, val]) => (
              <div key={field} style={s.field}>
                <div style={s.fieldLabel}>{label}</div>
                {editField === field
                  ? <div style={{ display: 'flex', gap: 6 }}>
                      <input style={s.input} value={editVal} onChange={e => setEditVal(e.target.value)} autoFocus />
                      <button style={s.btnPrimary} onClick={saveEdit}>Save</button>
                      <button style={s.btn} onClick={() => setEditField(null)}>✕</button>
                    </div>
                  : <div style={s.fieldValue} onClick={() => startEdit(field, val)}>
                      {val || <span style={{ color: 'var(--muted2)' }}>Click to edit</span>}
                    </div>
                }
              </div>
            ))}
            <div style={s.field}>
              <div style={s.fieldLabel}>Start Date</div>
              {editField === 'start_date'
                ? <div style={{ display: 'flex', gap: 6 }}>
                    <input type="date" style={s.input} value={editVal} onChange={e => setEditVal(e.target.value)} />
                    <button style={s.btnPrimary} onClick={saveEdit}>Save</button>
                    <button style={s.btn} onClick={() => setEditField(null)}>✕</button>
                  </div>
                : <div style={s.fieldValue} onClick={() => startEdit('start_date', eng.start_date?.slice(0, 10))}>
                    {eng.start_date ? new Date(eng.start_date).toLocaleDateString() : <span style={{ color: 'var(--muted2)' }}>Click to edit</span>}
                  </div>
              }
            </div>
            <div style={s.field}>
              <div style={s.fieldLabel}>End Date</div>
              {editField === 'end_date'
                ? <div style={{ display: 'flex', gap: 6 }}>
                    <input type="date" style={s.input} value={editVal} onChange={e => setEditVal(e.target.value)} />
                    <button style={s.btnPrimary} onClick={saveEdit}>Save</button>
                    <button style={s.btn} onClick={() => setEditField(null)}>✕</button>
                  </div>
                : <div style={s.fieldValue} onClick={() => startEdit('end_date', eng.end_date?.slice(0, 10))}>
                    {eng.end_date ? new Date(eng.end_date).toLocaleDateString() : <span style={{ color: 'var(--muted2)' }}>Click to edit</span>}
                  </div>
              }
            </div>
          </div>
        )}

        {/* ── Scope ── */}
        {tab === 'Scope' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              ['scope', 'In Scope', eng.scope],
              ['out_of_scope', 'Out of Scope', eng.out_of_scope],
              ['objectives', 'Objectives', eng.objectives],
              ['rules_of_engagement', 'Rules of Engagement', eng.rules_of_engagement],
            ].map(([field, label, val]) => (
              <div key={field} style={s.field}>
                <div style={s.fieldLabel}>{label}</div>
                {editField === field
                  ? <div>
                      <textarea style={{ ...s.input, minHeight: 100, width: '100%', resize: 'vertical' }} value={editVal} onChange={e => setEditVal(e.target.value)} autoFocus />
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <button style={s.btnPrimary} onClick={saveEdit}>Save</button>
                        <button style={s.btn} onClick={() => setEditField(null)}>Cancel</button>
                      </div>
                    </div>
                  : <div style={{ ...s.fieldValue, whiteSpace: 'pre-wrap', minHeight: 40 }} onClick={() => startEdit(field, val)}>
                      {val || <span style={{ color: 'var(--muted2)' }}>Click to edit</span>}
                    </div>
                }
              </div>
            ))}
          </div>
        )}

        {/* ── Recon ── */}
        {tab === 'Recon' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>{hosts.length} hosts discovered</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={s.btnPrimary} onClick={() => setShowScanImport(!showScanImport)}>↑ Import Scan</button>
                <button style={s.btn} onClick={() => setShowAddHost(!showAddHost)}>+ Add Host</button>
              </div>
            </div>

            {showAddHost && (
              <div style={{ ...s.field, marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                  {[['ip_address', 'IP Address *'], ['hostname', 'Hostname'], ['os', 'OS']].map(([f, l]) => (
                    <div key={f}>
                      <div style={s.fieldLabel}>{l}</div>
                      <input style={s.input} value={newHost[f]} onChange={e => setNewHost({ ...newHost, [f]: e.target.value })} />
                    </div>
                  ))}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={s.fieldLabel}>Ports (comma separated)</div>
                  <input style={s.input} value={newHost.ports} onChange={e => setNewHost({ ...newHost, ports: e.target.value })} placeholder="22, 80, 443, 8080" />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={s.btnPrimary} onClick={() => addHostMutation.mutate({
                    ...newHost,
                    ports: newHost.ports ? newHost.ports.split(',').map(p => parseInt(p.trim())).filter(Boolean) : [],
                  })}>Add Host</button>
                  <button style={s.btn} onClick={() => setShowAddHost(false)}>Cancel</button>
                </div>
              </div>
            )}

            {/* Scanner import panel */}
            {showScanImport && (
              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.08em' }}>Import Scanner Results</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <div style={s.fieldLabel}>Scanner Type</div>
                    <select style={s.input} value={scannerType} onChange={e => setScannerType(e.target.value)}>
                      <option value="nessus">Nessus / Tenable</option>
                      <option value="openvas">OpenVAS / Greenbone</option>
                      <option value="qualys">Qualys</option>
                      <option value="rapid7">Rapid7 InsightVM</option>
                      <option value="pingcastle">PingCastle (AD)</option>
                      <option value="burp">Burp Suite</option>
                      <option value="nmap">Nmap XML</option>
                    </select>
                  </div>
                  <div>
                    <div style={s.fieldLabel}>Min Severity to Import</div>
                    <select style={s.input} value={minSeverity} onChange={e => setMinSeverity(e.target.value)}>
                      <option value="Critical">Critical only</option>
                      <option value="High">High+</option>
                      <option value="Medium">Medium+</option>
                      <option value="Low">Low+</option>
                    </select>
                  </div>
                  <div>
                    <div style={s.fieldLabel}>Import Findings</div>
                    <select style={s.input} value={importFindings} onChange={e => setImportFindings(e.target.value === 'true')}>
                      <option value="true">Yes — create findings</option>
                      <option value="false">No — hosts only</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ ...s.btnPrimary, cursor: 'pointer', display: 'inline-block' }}>
                    {scanImporting ? '⏳ Importing...' : `↑ Upload ${scannerType} file`}
                    <input type="file" accept=".xml,.nessus" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) importScan(e.target.files[0]) }} disabled={scanImporting} />
                  </label>
                  <button style={s.btn} onClick={() => setShowScanImport(false)}>Cancel</button>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8 }}>
                    Hosts populate Recon tab · Findings auto-created in Findings tab
                  </div>
                </div>
              </div>
            )}

            {/* Mass action toolbar */}
            {hosts.length > 0 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, padding: '8px 12px', background: selectedHosts.length ? 'var(--surface2)' : 'transparent', borderRadius: 6, border: selectedHosts.length ? '1px solid var(--border)' : '1px solid transparent', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {selectedHosts.length ? `${selectedHosts.length} selected` : 'Select hosts for bulk actions'}
                </span>
                {selectedHosts.length > 0 && (
                  <>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 8 }}>
                      <select style={{ ...s.input, width: 'auto', padding: '4px 8px', fontSize: 11 }} value={massEditField} onChange={e => setMassEditField(e.target.value)}>
                        <option value="">Bulk edit field...</option>
                        <option value="os">OS</option>
                        <option value="hostname">Hostname</option>
                        <option value="status">Status</option>
                        <option value="source">Source</option>
                      </select>
                      {massEditField && (
                        <input style={{ ...s.input, width: 140, padding: '4px 8px', fontSize: 11 }} value={massEditVal} onChange={e => setMassEditVal(e.target.value)} placeholder={`New ${massEditField} value...`} />
                      )}
                      {massEditField && massEditVal && (
                        <button style={{ ...s.btnPrimary, padding: '4px 10px', fontSize: 10 }} onClick={massEdit}>Apply</button>
                      )}
                    </div>
                    <button style={{ ...s.btn, padding: '4px 10px', fontSize: 10, color: 'var(--red)', borderColor: 'var(--red-mid)', marginLeft: 'auto' }} onClick={massDelete}>
                      🗑 Delete {selectedHosts.length}
                    </button>
                    <button style={{ ...s.btn, padding: '4px 10px', fontSize: 10 }} onClick={() => setSelectedHosts([])}>Clear</button>
                  </>
                )}
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={{ ...s.th, width: 32 }}>
                      <input type="checkbox" checked={selectedHosts.length === hosts.length && hosts.length > 0} onChange={toggleSelectAll} style={{ cursor: 'pointer' }} />
                    </th>
                    {['IP Address', 'Hostname', 'OS', 'Ports', 'Source', 'Actions'].map(h => <th key={h} style={s.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {hosts.length ? hosts.map(h => (
                    editHost === h.id ? (
                      <tr key={h.id} style={{ background: 'var(--surface2)' }}>
                        <td style={s.td}><input type="checkbox" checked={selectedHosts.includes(h.id)} onChange={() => toggleSelect(h.id)} style={{ cursor: 'pointer' }} /></td>
                        <td style={s.td}><input style={{ ...s.input, width: 120 }} value={editHostVal.ip_address || ''} onChange={e => setEditHostVal({ ...editHostVal, ip_address: e.target.value })} /></td>
                        <td style={s.td}><input style={{ ...s.input, width: 140 }} value={editHostVal.hostname || ''} onChange={e => setEditHostVal({ ...editHostVal, hostname: e.target.value })} /></td>
                        <td style={s.td}><input style={{ ...s.input, width: 140 }} value={editHostVal.os || ''} onChange={e => setEditHostVal({ ...editHostVal, os: e.target.value })} /></td>
                        <td style={s.td}><input style={{ ...s.input, width: 140 }} value={editHostVal.ports || ''} onChange={e => setEditHostVal({ ...editHostVal, ports: e.target.value })} placeholder="22,80,443" /></td>
                        <td style={s.td}><span style={s.tag}>{h.source}</span></td>
                        <td style={s.td}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button style={{ ...s.btnPrimary, padding: '3px 8px', fontSize: 10 }} onClick={() => updateHostMutation.mutate({ hostId: h.id, data: { ...editHostVal, ports: editHostVal.ports ? editHostVal.ports.split(',').map(p => parseInt(p.trim())).filter(Boolean) : [] } })}>Save</button>
                            <button style={{ ...s.btn, padding: '3px 8px', fontSize: 10 }} onClick={() => setEditHost(null)}>✕</button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={h.id} style={{ background: selectedHosts.includes(h.id) ? 'var(--surface2)' : 'transparent' }}>
                        <td style={s.td}><input type="checkbox" checked={selectedHosts.includes(h.id)} onChange={() => toggleSelect(h.id)} style={{ cursor: 'pointer' }} /></td>
                        <td style={{ ...s.td, fontFamily: 'monospace', color: 'var(--blue)' }}>{h.ip_address}</td>
                        <td style={s.td}>{h.hostname || '—'}</td>
                        <td style={s.td}>{h.os || '—'}</td>
                        <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 10 }}>
                          {(h.ports || []).slice(0, 8).join(', ')}{(h.ports || []).length > 8 ? '...' : ''}
                        </td>
                        <td style={s.td}><span style={s.tag}>{h.source}</span></td>
                        <td style={s.td}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button style={{ ...s.btn, padding: '3px 8px', fontSize: 10 }} onClick={() => { setEditHost(h.id); setEditHostVal({ ip_address: h.ip_address, hostname: h.hostname || '', os: h.os || '', ports: (h.ports || []).join(', ') }) }}>Edit</button>
                            <button style={{ ...s.btn, padding: '3px 8px', fontSize: 10, color: 'var(--red)', borderColor: 'var(--red-mid)' }} onClick={() => { if (confirm(`Delete ${h.ip_address}?`)) deleteHostMutation.mutate(h.id) }}>Del</button>
                          </div>
                        </td>
                      </tr>
                    )
                  )) : (
                    <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: 'var(--muted)', padding: 32 }}>
                      No hosts yet. Add manually or import an Nmap XML file.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Kill Chain (AI Red Team only) ── */}
        {tab === 'Kill Chain' && (
          <div>
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 8 }}>AI Red Team Kill Chain</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                Unified framework combining NVIDIA Kill Chain (narrative), MITRE ATLAS (TTPs), and OWASP LLM Top 10 (vulnerabilities).
                Unlike traditional software, AI systems are vulnerable at the data, logic, and prompt levels.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {AI_KILL_CHAIN.map(phase => {
                const status = phaseStatuses[phase.id] || 'Not Started'
                const aiResult = aiPhaseResults[phase.id]
                return (
                  <div key={phase.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{phase.id}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{phase.name}</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ ...s.tag, color: '#f0883e' }}>NVIDIA: {phase.nvidia}</span>
                          <span style={{ ...s.tag, color: '#a78bfa' }}>ATLAS: {phase.atlas}</span>
                          <span style={{ ...s.tag, color: '#4ade80' }}>OWASP: {phase.owasp}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <select style={{ ...s.input, width: 'auto', padding: '4px 8px' }}
                          value={status}
                          onChange={e => setPhaseStatuses({ ...phaseStatuses, [phase.id]: e.target.value })}>
                          {['Not Started', 'In Progress', 'Completed', 'N/A'].map(st => <option key={st}>{st}</option>)}
                        </select>
                        <span style={{ fontSize: 10, color: PHASE_COLORS[status], fontWeight: 700 }}>●</span>
                        <button style={{ ...s.btn, fontSize: 10 }} onClick={() => runAiPhase(phase)} disabled={aiPhaseLoading === phase.id}>
                          {aiPhaseLoading === phase.id ? '...' : '◎ AI Guide'}
                        </button>
                      </div>
                    </div>
                    <div style={{ padding: '0 16px 12px', fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>{phase.desc}</div>
                    {aiResult && (
                      <div style={{ margin: '0 16px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: 12, fontSize: 12, color: 'var(--text)', lineHeight: 1.7 }}>
                        <ReactMarkdown>{aiResult}</ReactMarkdown>
                      </div>
                    )}
                    <div style={{ padding: '0 16px 12px' }}>
                      <textarea style={{ ...s.input, width: '100%', minHeight: 50, fontSize: 11, resize: 'vertical' }}
                        placeholder="Phase notes..."
                        value={phaseNotes[phase.id] || ''}
                        onChange={e => setPhaseNotes({ ...phaseNotes, [phase.id]: e.target.value })}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Findings ── */}
        {(tab === 'Findings') && (
          <div>
            <table style={s.table}>
              <thead>
                <tr>{['ID', 'Title', 'Severity', 'CVSS', 'Status', 'Source'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {sortedFindings.length ? sortedFindings.map(f => (
                  <tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/findings/${f.id}`)}>
                    <td style={{ ...s.td, color: 'var(--blue)', fontFamily: 'monospace', fontSize: 10 }}>{f.ref_id}</td>
                    <td style={s.td}><strong style={{ fontSize: 12 }}>{f.title}</strong></td>
                    <td style={s.td}><span style={{ ...s.sevBadge, color: SEV_COLOR[f.severity], borderColor: SEV_COLOR[f.severity] + '55' }}>{f.severity}</span></td>
                    <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11, color: SEV_COLOR[f.severity] }}>{f.cvss_score || '—'}</td>
                    <td style={s.td}><span style={s.tag}>{f.status}</span></td>
                    <td style={s.td}><span style={s.tag}>{f.source || 'manual'}</span></td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} style={{ ...s.td, textAlign: 'center', color: 'var(--muted)', padding: 32 }}>No findings yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Tasks ── */}
        {tab === 'Tasks' && (
          <div>
            <TaskBoard engagementId={id} />
          </div>
        )}

        {/* ── Notes ── */}
        {tab === 'Notes' && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>Free-form notes, timeline, and observations for this engagement.</div>
            {editField === 'notes'
              ? <div>
                  <textarea style={{ ...s.input, width: '100%', minHeight: 300, resize: 'vertical', fontSize: 12, lineHeight: 1.6 }}
                    value={editVal} onChange={e => setEditVal(e.target.value)} autoFocus />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button style={s.btnPrimary} onClick={saveEdit}>Save Notes</button>
                    <button style={s.btn} onClick={() => setEditField(null)}>Cancel</button>
                  </div>
                </div>
              : <div style={{ ...s.fieldValue, whiteSpace: 'pre-wrap', minHeight: 200, lineHeight: 1.7 }} onClick={() => startEdit('notes', eng.notes)}>
                  {eng.notes || <span style={{ color: 'var(--muted2)' }}>Click to add notes...</span>}
                </div>
            }
          </div>
        )}

        {/* ── Team ── */}
        {tab === 'Team' && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>Team members assigned to this engagement. Manage via Settings → Users.</div>
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, textAlign: 'center', color: 'var(--muted)' }}>
              Team management coming in next release. Use the API to assign members.
            </div>
          </div>
        )}

        {/* ── Reports ── */}
        {tab === 'Reports' && (
          <EngagementReports engagementId={id} engagementObj={eng} />
        )}

        {/* ── MITRE / MITRE ATLAS ── */}
        {(tab === 'MITRE' || tab === 'MITRE ATLAS') && (
          <div>
            <MitreBoard
              engagementId={id}
              findings={sortedFindings}
              users={[]}
            />
          </div>
        )}

      </div>
    </div>
  )
}

const s = {
  page: { padding: 24, maxWidth: 1100, margin: '0 auto' },
  loading: { padding: 40, color: 'var(--red)', fontFamily: 'monospace' },
  back: { background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--muted)', padding: '6px 12px', cursor: 'pointer', fontSize: 11, fontFamily: 'monospace', marginBottom: 20, display: 'block' },
  header: { display: 'flex', gap: 20, marginBottom: 20, alignItems: 'flex-start', flexWrap: 'wrap' },
  badge: { padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', border: '1px solid' },
  title: { fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 4 },
  subtitle: { fontSize: 13, color: 'var(--muted)' },
  statBox: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', textAlign: 'center' },
  tabs: { display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 0, overflowX: 'auto' },
  tab: { padding: '8px 14px', fontSize: 11, cursor: 'pointer', color: 'var(--muted)', background: 'none', border: 'none', borderBottom: '2px solid transparent', fontFamily: 'monospace', whiteSpace: 'nowrap' },
  tabActive: { color: 'var(--red)', borderBottomColor: 'var(--red)' },
  tabContent: { background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 20 },
  field: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: 12 },
  fieldLabel: { fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 },
  fieldValue: { fontSize: 12, color: 'var(--text)', lineHeight: 1.6, cursor: 'pointer', minHeight: 24, padding: 2, borderRadius: 3 },
  input: { background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', width: '100%' },
  btn: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '6px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace', whiteSpace: 'nowrap' },
  btnPrimary: { background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace', whiteSpace: 'nowrap' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)', background: 'var(--surface)', whiteSpace: 'nowrap' },
  td: { padding: '9px 12px', borderBottom: '1px solid var(--surface2)', fontSize: 11, verticalAlign: 'middle', color: 'var(--text)' },
  tag: { background: 'var(--surface2)', color: 'var(--muted)', padding: '2px 7px', borderRadius: 4, fontSize: 10 },
  sevBadge: { padding: '2px 7px', borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', border: '1px solid' },
}
