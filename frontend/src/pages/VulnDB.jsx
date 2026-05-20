import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import { vulnsApi, engagementsApi, aiApi } from '../api/client'
import api from '../api/client'
import toast from 'react-hot-toast'

const SEV_COLOR = { Critical: '#e05252', High: '#f0883e', Medium: '#fbbf24', Low: '#60a5fa', Info: '#6b7899' }
const SEV_DIM = { Critical: 'var(--red-dim)', High: 'var(--amber-dim)', Medium: '#3d3010', Low: 'var(--blue-dim)', Info: 'var(--surface3)' }
const SEVERITIES = ['All', 'Critical', 'High', 'Medium', 'Low', 'Info']
const SOURCES = ['Local', 'NVD', 'MITRE ATT&CK', 'AI Generate']

// ─── NVD API ─────────────────────────────────────────────────────────────────
async function searchNVD(keyword) {
  const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(keyword)}&resultsPerPage=20`
  const res = await fetch(url)
  if (!res.ok) throw new Error('NVD API error')
  const data = await res.json()
  return (data.vulnerabilities || []).map(v => {
    const cve = v.cve
    const desc = cve.descriptions?.find(d => d.lang === 'en')?.value || ''
    const cvssV3 = cve.metrics?.cvssMetricV31?.[0] || cve.metrics?.cvssMetricV30?.[0]
    const score = cvssV3?.cvssData?.baseScore
    const severity = cvssV3?.cvssData?.baseSeverity
    const cwe = cve.weaknesses?.[0]?.description?.[0]?.value || null
    return {
      id: cve.id,
      title: cve.id + ' — ' + desc.slice(0, 80) + (desc.length > 80 ? '...' : ''),
      severity: severity ? severity.charAt(0) + severity.slice(1).toLowerCase() : 'Medium',
      cvss_score: score || null,
      cwe: cwe !== 'NVD-CWE-noinfo' ? cwe : null,
      description: desc,
      impact: cvssV3 ? `CVSS Vector: ${cvssV3.cvssData.vectorString}` : null,
      remediation: 'Refer to the vendor advisory and apply available patches. See NVD for full details.',
      references: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
      category: 'NVD / CVE',
      source: 'nvd',
      cve_id: cve.id,
    }
  })
}

// ─── MITRE ATT&CK API ────────────────────────────────────────────────────────
async function searchMITRE(keyword) {
  const url = `https://attack.mitre.org/api/techniques/?search=${encodeURIComponent(keyword)}`
  // MITRE doesn't have a public JSON search API, so we use their TAXII/STIX endpoint
  const res = await fetch(`https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json`)
  if (!res.ok) throw new Error('MITRE fetch error')
  const data = await res.json()
  const techniques = data.objects.filter(o =>
    o.type === 'attack-pattern' &&
    !o.revoked &&
    (o.name?.toLowerCase().includes(keyword.toLowerCase()) ||
     o.description?.toLowerCase().includes(keyword.toLowerCase()))
  ).slice(0, 15)

  return techniques.map(t => {
    const extRef = t.external_references?.find(r => r.source_name === 'mitre-attack')
    const techId = extRef?.external_id || ''
    return {
      id: t.id,
      title: `${techId} — ${t.name}`,
      severity: 'High',
      cvss_score: null,
      cwe: null,
      description: t.description?.replace(/\(Citation:[^)]+\)/g, '').trim() || '',
      impact: t.x_mitre_impact_type?.join(', ') || null,
      remediation: t.x_mitre_detection || 'Refer to MITRE ATT&CK mitigation guidance for this technique.',
      references: extRef?.url || `https://attack.mitre.org/techniques/${techId}/`,
      category: `MITRE ATT&CK — ${t.kill_chain_phases?.[0]?.phase_name || 'technique'}`,
      source: 'mitre',
      mitre_id: techId,
      platforms: t.x_mitre_platforms?.join(', '),
    }
  })
}

export default function VulnDB() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [sevFilter, setSevFilter] = useState('All')
  const [activeSource, setActiveSource] = useState('Local')
  const [selected, setSelected] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [importEngId, setImportEngId] = useState('')
  const [externalResults, setExternalResults] = useState([])
  const [externalLoading, setExternalLoading] = useState(false)
  const [externalError, setExternalError] = useState(null)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiResult, setAiResult] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)

  const { data: templates = [], isLoading: localLoading } = useQuery(
    ['vulns', search, sevFilter],
    () => vulnsApi.list({ search: search || undefined, severity: sevFilter !== 'All' ? sevFilter : undefined }).then(r => r.data),
    { enabled: activeSource === 'Local' }
  )

  const { data: engagements = [] } = useQuery('engagements-all', () => engagementsApi.list({}).then(r => r.data))

  const saveTemplateMutation = useMutation(
    (data) => api.post('/vulns/save', data),
    {
      onSuccess: () => { toast.success('Saved to local library'); qc.invalidateQueries('vulns') },
      onError: () => toast.error('Failed to save template'),
    }
  )

  const importMutation = useMutation(
    ({ templateId, engId }) => vulnsApi.import(templateId, engId),
    {
      onSuccess: (res) => { toast.success(`Imported as ${res.data.ref_id}`); setShowImport(false); setImportEngId('') },
      onError: () => toast.error('Import failed'),
    }
  )

  async function runExternalSearch(source) {
    if (!search.trim()) { toast.error('Enter a search term first'); return }
    setExternalLoading(true)
    setExternalError(null)
    setExternalResults([])
    setSelected(null)
    try {
      const results = source === 'NVD' ? await searchNVD(search) : await searchMITRE(search)
      setExternalResults(results)
      if (results.length === 0) setExternalError('No results found')
    } catch (e) {
      setExternalError(`Failed to fetch from ${source}: ${e.message}`)
    } finally {
      setExternalLoading(false)
    }
  }

  async function generateAI() {
    if (!aiPrompt.trim()) { toast.error('Describe the vulnerability first'); return }
    setAiLoading(true)
    setAiResult(null)
    try {
      const { data } = await aiApi.chat([{
        role: 'user',
        content: `Generate a complete vulnerability template for a penetration test report for: "${aiPrompt}"

Respond ONLY with a JSON object (no markdown, no backticks):
{
  "title": "vulnerability name",
  "severity": "Critical|High|Medium|Low|Info",
  "cvss_score": <number or null>,
  "cvss_vector": "<CVSS:3.1/... or null>",
  "cwe": "CWE-XXX or null",
  "category": "category name",
  "description": "technical description of the vulnerability",
  "impact": "what an attacker can achieve",
  "remediation": "how to fix it with specific steps",
  "references": "relevant links and standards"
}`
      }], null, null, false)

      const clean = data.content.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean)
      setAiResult({ ...parsed, id: 'ai-' + Date.now(), source: 'ai' })
      setSelected({ ...parsed, id: 'ai-' + Date.now(), source: 'ai' })
    } catch (e) {
      toast.error('AI generation failed — check your API key')
    } finally {
      setAiLoading(false)
    }
  }

  async function saveExternalAsTemplate(item) {
    try {
      await api.post('/vulns/save', {
        title: item.title,
        severity: item.severity,
        cvss_score: item.cvss_score,
        cwe: item.cwe,
        category: item.category,
        description: item.description,
        impact: item.impact,
        remediation: item.remediation,
        references: item.references,
        tags: [item.source, item.category],
      })
      toast.success('Saved to local library')
      qc.invalidateQueries('vulns')
    } catch {
      toast.error('Failed to save')
    }
  }

  async function importExternalDirect(item, engId) {
    try {
      const { data } = await api.post(`/findings-direct/${engId}`, {
        title: item.title,
        severity: item.severity,
        cvss_score: item.cvss_score,
        cwe: item.cwe,
        description: item.description,
        impact: item.impact,
        remediation: item.remediation,
        references: item.references,
        source: item.source || 'manual',
      })
      toast.success(`Imported as ${data.ref_id}`)
      setShowImport(false)
      setImportEngId('')
    } catch {
      toast.error('Import failed')
    }
  }

  const displayList = activeSource === 'Local' ? templates : externalResults
  const isLocal = activeSource === 'Local'
  const isAI = activeSource === 'AI Generate'

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <div style={s.title}>Vuln DB</div>
        <div style={s.sourceTabs}>
          {SOURCES.map(src => (
            <button key={src} onClick={() => { setActiveSource(src); setSelected(null); setExternalResults([]) }}
              style={{ ...s.sourceTab, background: activeSource === src ? 'var(--red)' : 'var(--surface)', color: activeSource === src ? '#fff' : 'var(--muted)', borderColor: activeSource === src ? 'var(--red)' : 'var(--border)' }}>
              {src === 'NVD' ? '🔍 NVD' : src === 'MITRE ATT&CK' ? '🎯 MITRE' : src === 'AI Generate' ? '◎ AI' : '📁 Local'}
            </button>
          ))}
        </div>
      </div>

      {/* Search bar */}
      <div style={s.searchRow}>
        <input style={s.search} placeholder={
          isAI ? 'Describe the vulnerability to generate...' :
          activeSource === 'NVD' ? 'Search NVD by keyword or CVE ID...' :
          activeSource === 'MITRE ATT&CK' ? 'Search MITRE ATT&CK techniques...' :
          'Search local library...'
        } value={isAI ? aiPrompt : search}
          onChange={e => isAI ? setAiPrompt(e.target.value) : setSearch(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              if (isAI) generateAI()
              else if (activeSource !== 'Local') runExternalSearch(activeSource)
            }
          }}
        />
        {activeSource === 'NVD' && (
          <button style={s.btnPrimary} onClick={() => runExternalSearch('NVD')} disabled={externalLoading}>
            {externalLoading ? 'Searching...' : '🔍 Search NVD'}
          </button>
        )}
        {activeSource === 'MITRE ATT&CK' && (
          <button style={s.btnPrimary} onClick={() => runExternalSearch('MITRE ATT&CK')} disabled={externalLoading}>
            {externalLoading ? 'Searching...' : '🎯 Search MITRE'}
          </button>
        )}
        {isAI && (
          <button style={s.btnPrimary} onClick={generateAI} disabled={aiLoading}>
            {aiLoading ? 'Generating...' : '◎ Generate'}
          </button>
        )}
        {isLocal && (
          <div style={s.filterGroup}>
            {SEVERITIES.map(sev => (
              <button key={sev} onClick={() => setSevFilter(sev)}
                style={{ ...s.filterBtn, background: sevFilter === sev ? (SEV_DIM[sev] || 'var(--surface3)') : 'var(--surface)', color: sevFilter === sev ? (SEV_COLOR[sev] || 'var(--text)') : 'var(--muted)', borderColor: sevFilter === sev ? (SEV_COLOR[sev] ? SEV_COLOR[sev] + '55' : 'var(--border)') : 'var(--border)' }}>
                {sev}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Source info banners */}
      {activeSource === 'NVD' && (
        <div style={s.infoBanner}>
          🔍 Searching <strong>NIST National Vulnerability Database</strong> — 200,000+ real CVEs with CVSS scores, CWE mappings, and vendor advisories. Results are live from the NVD API.
        </div>
      )}
      {activeSource === 'MITRE ATT&CK' && (
        <div style={s.infoBanner}>
          🎯 Searching <strong>MITRE ATT&CK Enterprise</strong> — adversary tactics, techniques, and procedures (TTPs). Great for red team findings and kill chain mapping.
        </div>
      )}
      {isAI && (
        <div style={s.infoBanner}>
          ◎ Describe any vulnerability and the AI will generate a complete template with severity, CVSS, CWE, description, impact, and remediation. You can save it to your local library after.
        </div>
      )}

      {externalError && (
        <div style={{ background: 'var(--red-dim)', border: '1px solid var(--red-mid)', borderRadius: 6, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: 'var(--red)' }}>
          {externalError}
        </div>
      )}

      <div style={s.layout}>
        {/* List panel */}
        <div style={s.list}>
          {isAI && !aiResult && !aiLoading && (
            <div style={s.empty}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>◎</div>
              <div>Describe a vulnerability above and hit Generate</div>
              <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 6 }}>e.g. "CSRF on state-changing endpoints" or "JWT algorithm confusion"</div>
            </div>
          )}
          {isAI && aiLoading && <div style={s.empty}>Generating template...</div>}
          {isAI && aiResult && (
            <div onClick={() => setSelected(aiResult)}
              style={{ ...s.card, borderColor: 'var(--purple)', background: 'var(--purple-dim)' }}>
              <div style={s.cardTop}>
                <span style={{ ...s.sevBadge, color: SEV_COLOR[aiResult.severity], borderColor: SEV_COLOR[aiResult.severity] + '55', background: SEV_DIM[aiResult.severity] }}>{aiResult.severity}</span>
                <span style={{ ...s.cweTag, color: 'var(--purple)', borderColor: 'var(--purple)' }}>AI Generated</span>
              </div>
              <div style={s.cardTitle}>{aiResult.title}</div>
              <div style={s.cardCat}>{aiResult.category}</div>
            </div>
          )}

          {!isAI && (localLoading || externalLoading) && <div style={s.empty}>Loading...</div>}
          {!isAI && !localLoading && !externalLoading && displayList.length === 0 && activeSource !== 'Local' && (
            <div style={s.empty}>Enter a search term and click Search</div>
          )}
          {!isAI && !localLoading && displayList.length === 0 && activeSource === 'Local' && (
            <div style={s.empty}>No templates found</div>
          )}
          {!isAI && displayList.map(t => (
            <div key={t.id} onClick={() => setSelected(t)}
              style={{ ...s.card, borderColor: selected?.id === t.id ? 'var(--red)' : 'var(--border)', background: selected?.id === t.id ? 'var(--red-dim)' : 'var(--surface)' }}>
              <div style={s.cardTop}>
                <span style={{ ...s.sevBadge, color: SEV_COLOR[t.severity] || 'var(--muted)', borderColor: (SEV_COLOR[t.severity] || '#888') + '55', background: SEV_DIM[t.severity] || 'var(--surface3)' }}>{t.severity}</span>
                {t.cvss_score && <span style={{ fontSize: 10, color: SEV_COLOR[t.severity], fontFamily: 'monospace', fontWeight: 700 }}>{t.cvss_score}</span>}
                {t.cwe && <span style={s.cweTag}>{t.cwe}</span>}
                {t.source === 'nvd' && <span style={{ ...s.cweTag, color: '#60a5fa', borderColor: '#60a5fa55' }}>NVD</span>}
                {t.source === 'mitre' && <span style={{ ...s.cweTag, color: '#a78bfa', borderColor: '#a78bfa55' }}>MITRE</span>}
              </div>
              <div style={s.cardTitle}>{t.title}</div>
              <div style={s.cardCat}>{t.category}</div>
            </div>
          ))}
        </div>

        {/* Detail panel */}
        <div style={s.detail}>
          {!selected ? (
            <div style={s.detailEmpty}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>◉</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Select a template</div>
              <div style={{ fontSize: 11, color: 'var(--muted2)' }}>
                {activeSource === 'NVD' ? 'Search NVD then click a CVE to preview' :
                 activeSource === 'MITRE ATT&CK' ? 'Search MITRE then click a technique' :
                 isAI ? 'Generate a template to preview it here' :
                 'Click any vulnerability to preview and import'}
              </div>
            </div>
          ) : (
            <div style={s.detailContent}>
              <div style={s.detailHeader}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <span style={{ ...s.sevBadge, color: SEV_COLOR[selected.severity] || 'var(--muted)', borderColor: (SEV_COLOR[selected.severity] || '#888') + '55', background: SEV_DIM[selected.severity] || 'var(--surface3)' }}>{selected.severity}</span>
                    {selected.cvss_score && <span style={{ ...s.sevBadge, color: SEV_COLOR[selected.severity], borderColor: 'var(--border)', background: 'var(--surface2)' }}>CVSS {selected.cvss_score}</span>}
                    {selected.cwe && <span style={s.cweTag}>{selected.cwe}</span>}
                    {selected.mitre_id && <span style={{ ...s.cweTag, color: '#a78bfa' }}>{selected.mitre_id}</span>}
                    {selected.cve_id && <span style={{ ...s.cweTag, color: '#60a5fa' }}>{selected.cve_id}</span>}
                    {selected.source === 'ai' && <span style={{ ...s.cweTag, color: 'var(--purple)', borderColor: 'var(--purple)' }}>AI Generated</span>}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>{selected.title}</div>
                  {selected.platforms && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Platforms: {selected.platforms}</div>}
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                <button style={s.btnPrimary} onClick={() => setShowImport(true)}>↓ Import to Engagement</button>
                {(selected.source === 'nvd' || selected.source === 'mitre' || selected.source === 'ai') && (
                  <button style={s.btn} onClick={() => saveExternalAsTemplate(selected)}>💾 Save to Local Library</button>
                )}
                {selected.references && selected.source === 'nvd' && (
                  <a href={selected.references} target="_blank" rel="noreferrer" style={{ ...s.btn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>↗ View on NVD</a>
                )}
                {selected.mitre_id && (
                  <a href={`https://attack.mitre.org/techniques/${selected.mitre_id}/`} target="_blank" rel="noreferrer" style={{ ...s.btn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>↗ View on MITRE</a>
                )}
              </div>

              {[['Description', selected.description], ['Impact', selected.impact], ['Remediation', selected.remediation], ['References', selected.references]].filter(([, v]) => v).map(([label, val]) => (
                <div key={label} style={s.section}>
                  <div style={s.sectionLabel}>{label}</div>
                  <div style={s.sectionBody}>{val}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Import modal */}
      {showImport && selected && (
        <div style={s.modalBg} onClick={e => e.target === e.currentTarget && setShowImport(false)}>
          <div style={s.modal}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>Import to Engagement</span>
              <button style={s.closeBtn} onClick={() => setShowImport(false)}>×</button>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: 12, marginBottom: 20 }}>
                <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 4 }}>Importing</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{selected.title}</div>
                <div style={{ fontSize: 11, color: SEV_COLOR[selected.severity] || 'var(--muted)', marginTop: 4 }}>
                  {selected.severity}{selected.cvss_score ? ` · CVSS ${selected.cvss_score}` : ''}
                </div>
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={s.label}>Select Engagement</label>
                <select style={s.select} value={importEngId} onChange={e => setImportEngId(e.target.value)}>
                  <option value="">— Choose an engagement —</option>
                  {engagements.map(e => <option key={e.id} value={e.id}>{e.ref_id} — {e.client} ({e.name})</option>)}
                </select>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>
                Creates a finding pre-filled with all template data. Edit afterwards to add evidence, steps to reproduce, and notes.
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button style={s.btn} onClick={() => setShowImport(false)}>Cancel</button>
                <button style={{ ...s.btnPrimary, opacity: !importEngId ? 0.5 : 1 }}
                  disabled={!importEngId}
                  onClick={() => {
                    if (selected.source === 'nvd' || selected.source === 'mitre' || selected.source === 'ai') {
                      importExternalDirect(selected, importEngId)
                    } else {
                      importMutation.mutate({ templateId: selected.id, engId: importEngId })
                    }
                  }}>
                  Import Finding
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const s = {
  page: { padding: 24, height: '100%', display: 'flex', flexDirection: 'column' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text)' },
  sourceTabs: { display: 'flex', gap: 6 },
  sourceTab: { border: '1px solid', borderRadius: 6, padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace', fontWeight: 600, transition: 'all .15s' },
  searchRow: { display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' },
  search: { flex: 1, minWidth: 220, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '8px 12px', fontSize: 12, fontFamily: 'monospace', outline: 'none' },
  filterGroup: { display: 'flex', gap: 5, flexWrap: 'wrap' },
  filterBtn: { border: '1px solid', borderRadius: 5, padding: '4px 10px', fontSize: 10, cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700 },
  infoBanner: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', marginBottom: 12, fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 },
  layout: { display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, flex: 1, minHeight: 0, overflow: 'hidden' },
  list: { overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 },
  card: { border: '1px solid', borderRadius: 7, padding: 12, cursor: 'pointer', transition: 'border-color .15s, background .15s' },
  cardTop: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' },
  cardTitle: { fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3, marginBottom: 3 },
  cardCat: { fontSize: 10, color: 'var(--muted)' },
  sevBadge: { padding: '2px 7px', borderRadius: 3, fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', border: '1px solid', whiteSpace: 'nowrap' },
  cweTag: { background: 'var(--surface2)', color: 'var(--muted)', padding: '2px 7px', borderRadius: 4, fontSize: 10, border: '1px solid var(--border)', fontFamily: 'monospace' },
  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 12, textAlign: 'center', padding: 40, gap: 4 },
  detail: { overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 },
  detailEmpty: { height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', textAlign: 'center', padding: 40 },
  detailContent: { padding: 20 },
  detailHeader: { marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border)' },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6, fontWeight: 700 },
  sectionBody: { fontSize: 12, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap' },
  btn: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnPrimary: { background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  label: { fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', display: 'block', marginBottom: 6 },
  select: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '8px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', cursor: 'pointer' },
  modalBg: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, width: '90%', maxWidth: 480 },
  modalHeader: { padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 },
}
