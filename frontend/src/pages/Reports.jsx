import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import { reportsApi, engagementsApi, aiApi } from '../api/client'
import api from '../api/client'
import toast from 'react-hot-toast'

export default function Reports() {
  const qc = useQueryClient()
  const [selectedEng, setSelectedEng] = useState('')
  const [activeTab, setActiveTab] = useState('reports')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ title: '', version: '1.0', executive_summary: '', methodology_section: '' })
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false)
  const [generatingId, setGeneratingId] = useState(null)
  const [downloadingId, setDownloadingId] = useState(null)

  const { data: engagements = [] } = useQuery('engagements', () => engagementsApi.list({}).then(r => r.data))

  const { data: reports = [], isLoading } = useQuery(
    ['reports', selectedEng],
    () => selectedEng ? reportsApi.listByEngagement(selectedEng).then(r => r.data) : Promise.resolve([]),
    { enabled: !!selectedEng }
  )

  const { data: templates = [], refetch: refetchTemplates } = useQuery(
    'report-templates',
    () => api.get('/reports/templates/list').then(r => r.data)
  )

  const createMutation = useMutation(
    (data) => reportsApi.create(selectedEng, data),
    {
      onSuccess: () => { qc.invalidateQueries(['reports', selectedEng]); setShowModal(false); toast.success('Report created') },
      onError: () => toast.error('Failed to create report'),
    }
  )

  async function generateReport(reportId) {
    setGeneratingId(reportId)
    try {
      const params = selectedTemplate ? `?template_id=${selectedTemplate}` : ''
      await api.post(`/reports/${reportId}/generate${params}`)
      qc.invalidateQueries(['reports', selectedEng])
      toast.success('Report generated — ready to download')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Generation failed')
    } finally {
      setGeneratingId(null)
    }
  }

  async function downloadFile(reportId, fmt) {
    setDownloadingId(reportId + fmt)
    try {
      const res = await api.get(`/reports/${reportId}/download?fmt=${fmt}`, { responseType: 'blob' })
      const ext = fmt === 'pdf' ? 'pdf' : 'docx'
      const mime = fmt === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      const url = URL.createObjectURL(new Blob([res.data], { type: mime }))
      const a = document.createElement('a')
      a.href = url
      a.download = `pentest_report.${ext}`
      a.click()
    } catch { toast.error('Download failed') }
    finally { setDownloadingId(null) }
  }

  async function uploadTemplate(file) {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('name', file.name.replace('.docx', ''))
    try {
      await api.post('/reports/templates/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast.success('Template uploaded')
      refetchTemplates()
    } catch { toast.error('Upload failed — must be a .docx file') }
  }

  async function deleteTemplate(id) {
    try {
      await api.delete(`/reports/templates/${id}`)
      toast.success('Template deleted')
      refetchTemplates()
      if (selectedTemplate === id) setSelectedTemplate('')
    } catch { toast.error('Delete failed') }
  }

  async function generateAISummary() {
    if (!selectedEng) return
    setAiSummaryLoading(true)
    try {
      const { data } = await aiApi.executiveSummary(selectedEng)
      setForm(f => ({ ...f, executive_summary: data.content }))
      toast.success('Executive summary generated')
    } catch { toast.error('AI failed — check your API key') }
    finally { setAiSummaryLoading(false) }
  }

  const selectedEngObj = engagements.find(e => e.id === selectedEng)

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <div style={s.title}>Reports</div>
        <div style={s.tabRow}>
          <button style={{ ...s.tab, ...(activeTab === 'reports' ? s.tabActive : {}) }} onClick={() => setActiveTab('reports')}>Reports</button>
          <button style={{ ...s.tab, ...(activeTab === 'templates' ? s.tabActive : {}) }} onClick={() => setActiveTab('templates')}>
            Templates <span style={{ fontSize: 9, background: 'var(--surface2)', padding: '1px 6px', borderRadius: 8, marginLeft: 4 }}>{templates.length}</span>
          </button>
        </div>
      </div>

      {activeTab === 'reports' && (
        <>
          {/* Engagement selector */}
          <div style={s.engSelector}>
            <div style={s.selectorLabel}>Select Engagement</div>
            <div style={s.engList}>
              {engagements.map(e => (
                <div key={e.id} onClick={() => setSelectedEng(e.id)}
                  style={{ ...s.engCard, borderColor: selectedEng === e.id ? 'var(--red)' : 'var(--border)', background: selectedEng === e.id ? 'var(--red-dim)' : 'var(--surface)' }}>
                  <div style={{ fontSize: 10, color: selectedEng === e.id ? 'var(--red)' : 'var(--muted)', fontFamily: 'monospace', marginBottom: 2 }}>{e.ref_id}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{e.client}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{e.finding_count} findings</div>
                </div>
              ))}
            </div>
          </div>

          {selectedEng && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={s.sectionTitle}>Reports — {selectedEngObj?.client} ({selectedEngObj?.ref_id})</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {templates.length > 0 && (
                    <select style={s.select} value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)}>
                      <option value="">Default template</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.filename.replace('.docx', '')}</option>)}
                    </select>
                  )}
                  <button style={s.btnPrimary} onClick={() => setShowModal(true)}>+ New Report</button>
                </div>
              </div>

              {isLoading ? (
                <div style={s.empty}>Loading...</div>
              ) : reports.length === 0 ? (
                <div style={s.emptyBox}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>◧</div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>No reports yet</div>
                  <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 16 }}>Create a report, then generate a .docx</div>
                  <button style={s.btnPrimary} onClick={() => setShowModal(true)}>+ Create First Report</button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {reports.map(r => (
                    <div key={r.id} style={s.reportCard}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{r.title}</div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={s.tag}>v{r.version}</span>
                          <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>Created {r.created_at?.slice(0, 10)}</span>
                          {r.generated_at && <span style={{ fontSize: 10, color: 'var(--green)' }}>✓ Ready</span>}
                        </div>
                        {r.executive_summary && (
                          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, maxWidth: 600 }}>
                            {r.executive_summary.slice(0, 200)}{r.executive_summary.length > 200 ? '...' : ''}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexDirection: 'column', alignItems: 'flex-end' }}>
                        <button style={s.btnPrimary} onClick={() => generateReport(r.id)} disabled={generatingId === r.id}>
                          {generatingId === r.id ? '⚙ Generating...' : '⚙ Generate'}
                        </button>
                        {r.file_path && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button style={s.btnDocx} onClick={() => downloadFile(r.id, 'docx')} disabled={downloadingId === r.id + 'docx'}>
                              ↓ .docx
                            </button>
                            <button style={s.btnPdf} onClick={() => downloadFile(r.id, 'pdf')} disabled={downloadingId === r.id + 'pdf'}>
                              ↓ PDF
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!selectedEng && <div style={s.emptyBox}>Select an engagement above to view and create reports</div>}
        </>
      )}

      {activeTab === 'templates' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={s.sectionTitle}>Report Templates</div>
            <label style={{ ...s.btnPrimary, cursor: 'pointer', display: 'inline-block' }}>
              + Upload Template
              <input type="file" accept=".docx" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) uploadTemplate(e.target.files[0]) }} />
            </label>
          </div>

          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: 14, marginBottom: 16, fontSize: 11, color: 'var(--muted)', lineHeight: 1.8 }}>
            <strong style={{ color: 'var(--text)' }}>How to use custom templates:</strong> Create a .docx file with your branding, then add these placeholders where you want data inserted:
            <br />
            <code style={{ color: 'var(--blue)' }}>
              {`{{client_name}} {{report_title}} {{executive_summary}} {{scope}} {{total_findings}} {{critical_count}} {{high_count}} {{medium_count}} {{low_count}} {{findings_table}} {{findings_detail}} {{start_date}} {{end_date}}`}
            </code>
          </div>

          {templates.length === 0 ? (
            <div style={s.emptyBox}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>📄</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>No templates yet</div>
              <div style={{ fontSize: 11, color: 'var(--muted2)' }}>Upload a .docx template with your custom branding</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {templates.map(t => (
                <div key={t.id} style={{ ...s.reportCard, alignItems: 'center' }}>
                  <div style={{ fontSize: 20, marginRight: 4 }}>📄</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{t.filename.replace('.docx', '')}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
                      {(t.size_bytes / 1024).toFixed(1)} KB · {t.created_at?.slice(0, 10)}
                    </div>
                  </div>
                  <button style={{ background: 'none', border: '1px solid var(--red-mid)', borderRadius: 4, color: 'var(--red)', padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' }}
                    onClick={() => { if (confirm('Delete this template?')) deleteTemplate(t.id) }}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div style={s.modalBg} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div style={s.modal}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>New Report</span>
              <button style={s.closeBtn} onClick={() => setShowModal(false)}>×</button>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={s.label}>Report Title</label>
                  <input style={s.formInput} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Web Application Penetration Test Report" />
                </div>
                <div>
                  <label style={s.label}>Version</label>
                  <input style={s.formInput} value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={s.label}>Executive Summary</label>
                  <button style={{ ...s.btn, fontSize: 10 }} onClick={generateAISummary} disabled={aiSummaryLoading}>
                    {aiSummaryLoading ? '...' : '◎ AI Generate'}
                  </button>
                </div>
                <textarea style={{ ...s.formInput, minHeight: 120, resize: 'vertical' }}
                  value={form.executive_summary}
                  onChange={e => setForm({ ...form, executive_summary: e.target.value })}
                  placeholder="Write or AI-generate an executive summary..." />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={s.label}>Methodology</label>
                <textarea style={{ ...s.formInput, minHeight: 60, resize: 'vertical' }}
                  value={form.methodology_section}
                  onChange={e => setForm({ ...form, methodology_section: e.target.value })}
                  placeholder="Testing methodology and approach..." />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <button style={s.btn} onClick={() => setShowModal(false)}>Cancel</button>
                <button style={s.btnPrimary} disabled={!form.title || createMutation.isLoading}
                  onClick={() => createMutation.mutate(form)}>
                  {createMutation.isLoading ? 'Creating...' : 'Create Report'}
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
  page: { padding: 24 },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text)' },
  tabRow: { display: 'flex', gap: 4 },
  tab: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--muted)', padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  tabActive: { background: 'var(--red-dim)', color: 'var(--red)', borderColor: 'var(--red)' },
  engSelector: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 20 },
  selectorLabel: { fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 12, fontWeight: 700 },
  engList: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  engCard: { border: '1px solid', borderRadius: 7, padding: 12, cursor: 'pointer', transition: 'all .15s', minWidth: 150 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  reportCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  tag: { background: 'var(--surface2)', color: 'var(--muted)', padding: '2px 7px', borderRadius: 4, fontSize: 10, border: '1px solid var(--border)' },
  select: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '6px 10px', fontSize: 11, fontFamily: 'monospace', outline: 'none', cursor: 'pointer' },
  empty: { padding: 40, color: 'var(--muted)', fontSize: 12, textAlign: 'center' },
  emptyBox: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 40, color: 'var(--muted)', fontSize: 12, textAlign: 'center' },
  btn: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnPrimary: { background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnDocx: { background: 'var(--blue-dim)', border: '1px solid var(--blue)', borderRadius: 5, color: 'var(--blue)', padding: '6px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnPdf: { background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 5, color: 'var(--red)', padding: '6px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  label: { fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', display: 'block', marginBottom: 5 },
  formInput: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' },
  modalBg: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, width: '90%', maxWidth: 580, maxHeight: '85vh', overflowY: 'auto' },
  modalHeader: { padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--surface)' },
  modalTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 },
}
