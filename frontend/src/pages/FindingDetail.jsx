import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import { findingsApi, aiApi } from '../api/client'
import CVSSCalculator from '../components/CVSSCalculator'
import MarkdownEditor from '../components/MarkdownEditor'
import api from '../api/client'
import toast from 'react-hot-toast'
import ReactMarkdown from 'react-markdown'

const SEV_COLOR = { Critical: '#e05252', High: '#f0883e', Medium: '#fbbf24', Low: '#60a5fa', Info: '#6b7899' }
const SEV_DIM = { Critical: 'var(--red-dim)', High: 'var(--amber-dim)', Medium: '#3d3010', Low: 'var(--blue-dim)', Info: 'var(--surface3)' }
const STATUSES = ['Open', 'In Review', 'Remediated', 'Accepted', 'False Positive']
const TABS = ['Details', 'Evidence', 'Comments', 'AI Analysis']

export default function FindingDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState('Details')
  const [editField, setEditField] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [comment, setComment] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiRemLoading, setAiRemLoading] = useState(false)
  const [aiStepsLoading, setAiStepsLoading] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [showCVSS, setShowCVSS] = useState(false)

  const { data: finding, isLoading } = useQuery(['finding', id], () => findingsApi.get(id).then(r => r.data))
  const { data: evidence = [] } = useQuery(['evidence', id], () => findingsApi.listEvidence(id).then(r => r.data))
  const { data: comments = [] } = useQuery(['comments', id], () => findingsApi.listComments(id).then(r => r.data))

  const updateMutation = useMutation(
    (data) => findingsApi.update(id, data),
    { onSuccess: () => { qc.invalidateQueries(['finding', id]); setEditField(null); toast.success('Saved') } }
  )

  const commentMutation = useMutation(
    (body) => findingsApi.addComment(id, { body }),
    { onSuccess: () => { qc.invalidateQueries(['comments', id]); setComment('') } }
  )

  const [previewImg, setPreviewImg] = useState(null)

  const deleteEvidenceMutation = useMutation(
    (evidenceId) => import('../api/client').then(m => m.default.delete(`/findings/evidence/${evidenceId}`)),
    { onSuccess: () => { qc.invalidateQueries(['evidence', id]); toast.success('Evidence deleted') }, onError: () => toast.error('Failed to delete') }
  )

  const evidenceMutation = useMutation(
    (file) => {
      const fd = new FormData()
      fd.append('file', file)
      return findingsApi.uploadEvidence(id, fd)
    },
    { onSuccess: () => { qc.invalidateQueries(['evidence', id]); toast.success('Evidence uploaded') } }
  )

  function startEdit(field, val) { setEditField(field); setEditVal(val || '') }

  async function runAiAnalysis() {
    setAiLoading(true)
    try {
      const { data } = await aiApi.analyze(id)
      qc.invalidateQueries(['finding', id])
      toast.success('AI analysis complete')
      setTab('AI Analysis')
    } catch { toast.error('AI analysis failed — check your API key') }
    finally { setAiLoading(false) }
  }

  async function runAiRemediation() {
    if (!finding) return
    setAiRemLoading(true)
    try {
      const { data } = await aiApi.remediation({ title: finding.title, description: finding.description, severity: finding.severity, cwe: finding.cwe, affected_component: finding.affected_component })
      updateMutation.mutate({ remediation: data.content })
      toast.success('Remediation generated')
    } catch { toast.error('Failed — check your API key') }
    finally { setAiRemLoading(false) }
  }

  async function runAiSteps() {
    if (!finding) return
    setAiStepsLoading(true)
    try {
      const { data } = await aiApi.steps(finding.title, finding.description, finding.affected_component)
      updateMutation.mutate({ steps_to_reproduce: data.content })
      toast.success('Steps generated')
    } catch { toast.error('Failed — check your API key') }
    finally { setAiStepsLoading(false) }
  }

  async function saveToLibrary() {
    if (!finding) return
    setSaveLoading(true)
    try {
      await api.post('/vulns/save', {
        title: finding.title,
        severity: finding.severity,
        cvss_score: finding.cvss_score,
        cwe: finding.cwe,
        category: 'Imported from Finding',
        description: finding.description,
        impact: finding.impact,
        remediation: finding.remediation,
        references: finding.references,
        tags: [finding.severity, finding.cwe || 'custom'].filter(Boolean),
      })
      toast.success('Saved to Vuln DB library — reusable for future engagements')
    } catch { toast.error('Failed to save to library') }
    finally { setSaveLoading(false) }
  }

  if (isLoading) return <div style={s.loading}>Loading...</div>
  if (!finding) return <div style={s.loading}>Finding not found</div>

  return (
    <div style={s.page}>
      <button onClick={() => navigate(-1)} style={s.back}>← Back</button>

      <div style={s.header}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ ...s.sevBadge, color: SEV_COLOR[finding.severity], borderColor: SEV_COLOR[finding.severity] + '55', background: SEV_DIM[finding.severity] }}>{finding.severity}</span>
            {finding.cvss_score && <span style={{ fontSize: 11, color: SEV_COLOR[finding.severity], fontFamily: 'monospace', fontWeight: 700 }}>CVSS {finding.cvss_score}</span>}
            {finding.cwe && <span style={s.tag}>{finding.cwe}</span>}
            <span style={s.tag}>{finding.ref_id}</span>
            <span style={s.tag}>{finding.source || 'manual'}</span>
          </div>
          <h1 style={s.title}>{finding.title}</h1>
          {finding.affected_component && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, fontFamily: 'monospace' }}>{finding.affected_component}</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <select style={s.statusSelect}
            value={finding.status}
            onChange={e => updateMutation.mutate({ status: e.target.value })}>
            {STATUSES.map(st => <option key={st}>{st}</option>)}
          </select>
          <button style={s.btnAi} onClick={runAiAnalysis} disabled={aiLoading}>
            {aiLoading ? '◎ Analyzing...' : '◎ AI Analysis'}
          </button>
          <button style={s.btnLib} onClick={saveToLibrary} disabled={saveLoading}>
            {saveLoading ? 'Saving...' : '💾 Save to Vuln DB'}
          </button>
        </div>
      </div>

      <div style={s.tabs}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}>
            {t}
            {t === 'AI Analysis' && finding.ai_analysis && <span style={{ marginLeft: 4, width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />}
          </button>
        ))}
      </div>

      <div style={s.tabContent}>

        {tab === 'Details' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              ['title', 'Title', finding.title],
              ['affected_component', 'Affected Component', finding.affected_component],
              ['cve', 'CVE', finding.cve],
              ['cvss_vector', 'CVSS Vector', finding.cvss_vector],
            ].map(([field, label, val]) => (
              <div key={field} style={s.field}>
                <div style={s.fieldLabel}>{label}</div>
                {editField === field
                  ? <div style={{ display: 'flex', gap: 6 }}>
                      <input style={s.input} value={editVal} onChange={e => setEditVal(e.target.value)} autoFocus />
                      <button style={s.btnPrimary} onClick={() => updateMutation.mutate({ [field]: editVal })}>Save</button>
                      <button style={s.btn} onClick={() => setEditField(null)}>✕</button>
                    </div>
                  : <div style={s.fieldValue} onClick={() => startEdit(field, val)}>{val || <span style={{ color: 'var(--muted2)' }}>Click to edit</span>}</div>
                }
              </div>
            ))}

            {/* Severity + CVSS row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={s.field}>
                <div style={s.fieldLabel}>Severity</div>
                <select style={{ ...s.input, cursor: 'pointer' }} value={finding.severity} onChange={e => updateMutation.mutate({ severity: e.target.value })}>
                  {['Critical', 'High', 'Medium', 'Low', 'Info'].map(sv => <option key={sv}>{sv}</option>)}
                </select>
              </div>
              <div style={s.field}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={s.fieldLabel}>CVSS Score</div>
                  <button style={{ ...s.btn, fontSize: 10, padding: '2px 8px' }} onClick={() => setShowCVSS(!showCVSS)}>
                    {showCVSS ? '✕ Close' : '⊕ CVSS Calculator'}
                  </button>
                </div>
                {showCVSS ? (
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
                    <CVSSCalculator
                      initialVector={finding.cvss_vector}
                      onApply={(score, vector, severity) => {
                        updateMutation.mutate({ cvss_score: score, cvss_vector: vector, severity })
                        setShowCVSS(false)
                      }}
                    />
                  </div>
                ) : (
                  editField === 'cvss_score'
                    ? <div style={{ display: 'flex', gap: 6 }}>
                        <input style={s.input} value={editVal} onChange={e => setEditVal(e.target.value)} type="number" min="0" max="10" step="0.1" autoFocus />
                        <button style={s.btnPrimary} onClick={() => updateMutation.mutate({ cvss_score: parseFloat(editVal) })}>Save</button>
                        <button style={s.btn} onClick={() => setEditField(null)}>✕</button>
                      </div>
                    : <div style={s.fieldValue} onClick={() => startEdit('cvss_score', finding.cvss_score)}>
                        {finding.cvss_score
                          ? <span>{finding.cvss_score} <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>{finding.cvss_vector}</span></span>
                          : <span style={{ color: 'var(--muted2)' }}>Click to edit or use CVSS Calculator</span>}
                      </div>
                )}
              </div>
            </div>

            {[
              ['description', 'Description', finding.description],
              ['impact', 'Impact', finding.impact],
            ].map(([field, label, val]) => (
              <div key={field} style={s.field}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={s.fieldLabel}>{label}</div>
                  {editField !== field && <button style={{ ...s.btn, fontSize: 10, padding: '2px 8px' }} onClick={() => startEdit(field, val)}>Edit</button>}
                </div>
                {editField === field
                  ? <div>
                      <MarkdownEditor value={editVal} onChange={setEditVal} minHeight={120} placeholder={`Write ${label.toLowerCase()} in markdown...`} />
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <button style={s.btnPrimary} onClick={() => updateMutation.mutate({ [field]: editVal })}>Save</button>
                        <button style={s.btn} onClick={() => setEditField(null)}>Cancel</button>
                      </div>
                    </div>
                  : <div style={{ fontSize: 12, color: val ? 'var(--text)' : 'var(--muted2)', lineHeight: 1.6, minHeight: 24 }}>
                      {val ? <ReactMarkdown>{val}</ReactMarkdown> : 'Click Edit to add content'}
                    </div>
                }
              </div>
            ))}

            <div style={s.field}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={s.fieldLabel}>Steps to Reproduce</div>
                <button style={{ ...s.btn, fontSize: 10 }} onClick={runAiSteps} disabled={aiStepsLoading}>{aiStepsLoading ? '...' : '◎ AI Generate'}</button>
              </div>
              {editField === 'steps_to_reproduce'
                ? <div>
                    <MarkdownEditor value={editVal} onChange={setEditVal} minHeight={120} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button style={s.btnPrimary} onClick={() => updateMutation.mutate({ steps_to_reproduce: editVal })}>Save</button>
                      <button style={s.btn} onClick={() => setEditField(null)}>Cancel</button>
                    </div>
                  </div>
                : <div style={{ ...s.fieldValue, whiteSpace: 'pre-wrap', minHeight: 40 }} onClick={() => startEdit('steps_to_reproduce', finding.steps_to_reproduce)}>{finding.steps_to_reproduce || <span style={{ color: 'var(--muted2)' }}>Click to edit or use AI Generate</span>}</div>
              }
            </div>

            <div style={s.field}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={s.fieldLabel}>Remediation</div>
                <button style={{ ...s.btn, fontSize: 10 }} onClick={runAiRemediation} disabled={aiRemLoading}>{aiRemLoading ? '...' : '◎ AI Generate'}</button>
              </div>
              {editField === 'remediation'
                ? <div>
                    <MarkdownEditor value={editVal} onChange={setEditVal} minHeight={120} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button style={s.btnPrimary} onClick={() => updateMutation.mutate({ remediation: editVal })}>Save</button>
                      <button style={s.btn} onClick={() => setEditField(null)}>Cancel</button>
                    </div>
                  </div>
                : <div style={{ ...s.fieldValue, whiteSpace: 'pre-wrap', minHeight: 40 }} onClick={() => startEdit('remediation', finding.remediation)}>{finding.remediation || <span style={{ color: 'var(--muted2)' }}>Click to edit or use AI Generate</span>}</div>
              }
            </div>

            <div style={s.field}>
              <div style={s.fieldLabel}>References</div>
              {editField === 'references'
                ? <div>
                    <textarea style={{ ...s.input, minHeight: 60, width: '100%', resize: 'vertical' }} value={editVal} onChange={e => setEditVal(e.target.value)} autoFocus />
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button style={s.btnPrimary} onClick={() => updateMutation.mutate({ references: editVal })}>Save</button>
                      <button style={s.btn} onClick={() => setEditField(null)}>Cancel</button>
                    </div>
                  </div>
                : <div style={{ ...s.fieldValue, whiteSpace: 'pre-wrap', minHeight: 30 }} onClick={() => startEdit('references', finding.references)}>{finding.references || <span style={{ color: 'var(--muted2)' }}>Click to edit</span>}</div>
              }
            </div>
          </div>
        )}

        {tab === 'Evidence' && (
          <div>
            {/* Upload area */}
            <div style={{ border: '2px dashed var(--border2)', borderRadius: 8, padding: 20, textAlign: 'center', marginBottom: 16, cursor: 'pointer' }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) evidenceMutation.mutate(f) }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>📎</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Drag & drop files here, or click to browse</div>
              <label style={{ ...s.btnPrimary, display: 'inline-block', cursor: 'pointer' }}>
                {evidenceMutation.isLoading ? 'Uploading...' : '+ Upload Evidence'}
                <input type="file" multiple style={{ display: 'none' }}
                  onChange={e => { Array.from(e.target.files).forEach(f => evidenceMutation.mutate(f)) }} />
              </label>
              <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 8 }}>Screenshots, logs, PoC files — max 25MB each</div>
            </div>

            {evidence.length === 0 ? (
              <div style={s.emptyBox}>No evidence uploaded yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {evidence.map(ev => {
                  const isImage = ev.mime_type?.startsWith('image/')
                  const isPdf = ev.mime_type === 'application/pdf'
                  const token = localStorage.getItem("access_token")
                  const fileUrl = `/api/findings/evidence/${ev.id}/file?token=${token}`
                  return (
                    <div key={ev.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      {/* Image preview */}
                      {isImage && (
                        <div style={{ background: 'var(--bg)', padding: 8, cursor: 'pointer', textAlign: 'center' }}
                          onClick={() => setPreviewImg(fileUrl)}>
                          <img src={fileUrl} alt={ev.original_name}
                            style={{ maxHeight: 300, maxWidth: '100%', objectFit: 'contain', borderRadius: 4 }}
                            onError={e => { e.target.style.display = 'none' }} />
                        </div>
                      )}
                      {/* File info row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px' }}>
                        <div style={{ fontSize: 20 }}>{isImage ? '🖼' : isPdf ? '📋' : '📄'}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{ev.original_name}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                            {ev.mime_type} · {(ev.size_bytes / 1024).toFixed(1)} KB · {ev.uploaded_at?.slice(0, 10)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {isImage && (
                            <button style={{ ...s.btn, fontSize: 10, padding: '3px 8px' }}
                              onClick={() => setPreviewImg(fileUrl)}>
                              🔍 View
                            </button>
                          )}
                          <button style={{ ...s.btn, fontSize: 10, padding: '3px 8px' }}
                            onClick={async () => {
                              const res = await fetch(fileUrl)
                              const blob = await res.blob()
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = ev.original_name
                              a.click()
                            }}>
                            ↓ Download
                          </button>
                          <button style={{ background: 'none', border: '1px solid var(--red-mid)', borderRadius: 4, color: 'var(--red)', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontFamily: 'monospace' }}
                            onClick={() => { if (confirm('Delete this evidence?')) deleteEvidenceMutation.mutate(ev.id) }}>
                            Del
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Full screen image preview */}
            {previewImg && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, cursor: 'pointer' }}
                onClick={() => setPreviewImg(null)}>
                <img src={previewImg} style={{ maxHeight: '90vh', maxWidth: '90vw', objectFit: 'contain', borderRadius: 8 }} />
                <button style={{ position: 'absolute', top: 20, right: 20, background: 'none', border: 'none', color: '#fff', fontSize: 32, cursor: 'pointer' }}
                  onClick={() => setPreviewImg(null)}>×</button>
              </div>
            )}
          </div>
        )}

        {tab === 'Comments' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {comments.length === 0 && <div style={s.emptyBox}>No comments yet.</div>}
              {comments.map(c => (
                <div key={c.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6 }}>{c.created_at?.slice(0, 16).replace('T', ' ')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{c.body}</div>
                </div>
              ))}
            </div>
            <div>
              <textarea style={{ ...s.input, width: '100%', minHeight: 80, resize: 'vertical', marginBottom: 8 }}
                placeholder="Add a comment or note..."
                value={comment} onChange={e => setComment(e.target.value)} />
              <button style={s.btnPrimary} onClick={() => comment.trim() && commentMutation.mutate(comment)} disabled={!comment.trim()}>Add Comment</button>
            </div>
          </div>
        )}

        {/* Evidence thumbnails in Details tab */}
        {tab === 'Details' && evidence.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 10, fontWeight: 700 }}>
              Evidence ({evidence.length})
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {evidence.map(ev => {
                const isImage = ev.mime_type?.startsWith('image/')
                const token = localStorage.getItem("access_token")
                const fileUrl = `/api/findings/evidence/${ev.id}/file?token=${token}`
                return (
                  <div key={ev.id} style={{ width: 80, cursor: 'pointer' }} onClick={() => { if (isImage) setPreviewImg(fileUrl) }}>
                    {isImage ? (
                      <img src={fileUrl} alt={ev.original_name}
                        style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 5, border: '1px solid var(--border)' }}
                        onError={e => { e.target.style.display = 'none' }} />
                    ) : (
                      <div style={{ width: 80, height: 60, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                        <div style={{ fontSize: 20 }}>📄</div>
                        <div style={{ fontSize: 8, color: 'var(--muted)', textAlign: 'center', padding: '0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>{ev.original_name}</div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {tab === 'AI Analysis' && (
          <div>
            {!finding.ai_analysis ? (
              <div style={s.emptyBox}>
                No AI analysis yet.
                <button style={{ ...s.btnPrimary, marginTop: 12, display: 'block' }} onClick={runAiAnalysis} disabled={aiLoading}>
                  {aiLoading ? '◎ Analyzing...' : '◎ Run AI Analysis'}
                </button>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                  <button style={s.btn} onClick={runAiAnalysis} disabled={aiLoading}>{aiLoading ? 'Re-analyzing...' : '↺ Re-analyze'}</button>
                </div>
                <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, fontSize: 12, color: 'var(--text)', lineHeight: 1.8 }}>
                  <ReactMarkdown>{finding.ai_analysis}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const s = {
  page: { padding: 24, maxWidth: 900, margin: '0 auto' },
  loading: { padding: 40, color: 'var(--red)', fontFamily: 'monospace' },
  back: { background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--muted)', padding: '6px 12px', cursor: 'pointer', fontSize: 11, fontFamily: 'monospace', marginBottom: 20, display: 'block' },
  header: { display: 'flex', gap: 20, marginBottom: 20, alignItems: 'flex-start', flexWrap: 'wrap' },
  sevBadge: { padding: '3px 9px', borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', border: '1px solid' },
  tag: { background: 'var(--surface2)', color: 'var(--muted)', padding: '2px 7px', borderRadius: 4, fontSize: 10, border: '1px solid var(--border)', fontFamily: 'monospace' },
  title: { fontSize: 18, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 },
  statusSelect: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '6px 10px', fontSize: 11, fontFamily: 'monospace', outline: 'none', cursor: 'pointer' },
  btnAi: { background: 'var(--green-dim)', border: '1px solid var(--green)', borderRadius: 5, color: 'var(--green)', padding: '6px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnLib: { background: 'var(--blue-dim)', border: '1px solid var(--blue)', borderRadius: 5, color: 'var(--blue)', padding: '6px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  tabs: { display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 0 },
  tab: { padding: '8px 16px', fontSize: 11, cursor: 'pointer', color: 'var(--muted)', background: 'none', border: 'none', borderBottom: '2px solid transparent', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 4 },
  tabActive: { color: 'var(--red)', borderBottomColor: 'var(--red)' },
  tabContent: { background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 20 },
  field: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: 12 },
  fieldLabel: { fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6, fontWeight: 700 },
  fieldValue: { fontSize: 12, color: 'var(--text)', lineHeight: 1.6, cursor: 'pointer', minHeight: 24, padding: 2, borderRadius: 3 },
  input: { background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', width: '100%', boxSizing: 'border-box' },
  btn: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '6px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace', whiteSpace: 'nowrap' },
  btnPrimary: { background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace', whiteSpace: 'nowrap' },
  emptyBox: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: 24, color: 'var(--muted)', fontSize: 12, textAlign: 'center' },
}
