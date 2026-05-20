import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import { reportsApi, aiApi } from '../api/client'
import api from '../api/client'
import toast from 'react-hot-toast'

export default function EngagementReports({ engagementId, engagementObj }) {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [generatingId, setGeneratingId] = useState(null)
  const [downloadingId, setDownloadingId] = useState(null)
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false)
  const [form, setForm] = useState({ title: '', version: '1.0', executive_summary: '', methodology_section: '' })

  const { data: reports = [], isLoading } = useQuery(
    ['reports', engagementId],
    () => reportsApi.listByEngagement(engagementId).then(r => r.data),
    { enabled: !!engagementId }
  )

  const { data: templates = [] } = useQuery(
    'report-templates',
    () => api.get('/reports/templates/list').then(r => r.data)
  )

  const createMutation = useMutation(
    (data) => reportsApi.create(engagementId, data),
    {
      onSuccess: () => {
        qc.invalidateQueries(['reports', engagementId])
        setShowModal(false)
        setForm({ title: '', version: '1.0', executive_summary: '', methodology_section: '' })
        toast.success('Report created')
      },
      onError: () => toast.error('Failed to create report'),
    }
  )

  async function generateReport(reportId) {
    setGeneratingId(reportId)
    try {
      const params = selectedTemplate ? `?template_id=${selectedTemplate}` : ''
      await api.post(`/reports/${reportId}/generate${params}`)
      qc.invalidateQueries(['reports', engagementId])
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
      a.download = `${engagementObj?.ref_id || 'report'}_pentest_report.${ext}`
      a.click()
    } catch { toast.error('Download failed') }
    finally { setDownloadingId(null) }
  }

  async function generateAISummary() {
    setAiSummaryLoading(true)
    try {
      const { data } = await aiApi.executiveSummary(engagementId)
      setForm(f => ({ ...f, executive_summary: data.content }))
      toast.success('Executive summary generated')
    } catch { toast.error('AI failed — check your API key') }
    finally { setAiSummaryLoading(false) }
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {reports.length} report{reports.length !== 1 ? 's' : ''} for this engagement
        </div>
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
          <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 16 }}>
            Create a report, fill in the details, then generate a .docx or PDF
          </div>
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
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
                    Created {r.created_at?.slice(0, 10)}
                  </span>
                  {r.generated_at && (
                    <span style={{ fontSize: 10, color: 'var(--green)' }}>✓ Generated {r.generated_at?.slice(0, 10)}</span>
                  )}
                </div>
                {r.executive_summary && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, maxWidth: 500 }}>
                    {r.executive_summary.slice(0, 180)}{r.executive_summary.length > 180 ? '...' : ''}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 }}>
                <button style={s.btnPrimary} onClick={() => generateReport(r.id)} disabled={generatingId === r.id}>
                  {generatingId === r.id ? '⚙ Generating...' : '⚙ Generate'}
                </button>
                {r.file_path && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={s.btnDocx}
                      onClick={() => downloadFile(r.id, 'docx')}
                      disabled={downloadingId === r.id + 'docx'}>
                      ↓ .docx
                    </button>
                    <button style={s.btnPdf}
                      onClick={() => downloadFile(r.id, 'pdf')}
                      disabled={downloadingId === r.id + 'pdf'}>
                      ↓ PDF
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showModal && (
        <div style={s.modalBg} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div style={s.modal}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>New Report — {engagementObj?.client}</span>
              <button style={s.closeBtn} onClick={() => setShowModal(false)}>×</button>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={s.label}>Report Title</label>
                  <input style={s.input}
                    value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    placeholder={`${engagementObj?.type || 'Penetration'} Test Report — ${engagementObj?.client || ''}`}
                  />
                </div>
                <div>
                  <label style={s.label}>Version</label>
                  <input style={s.input} value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={s.label}>Executive Summary</label>
                  <button style={{ ...s.btn, fontSize: 10 }} onClick={generateAISummary} disabled={aiSummaryLoading}>
                    {aiSummaryLoading ? '...' : '◎ AI Generate'}
                  </button>
                </div>
                <textarea style={{ ...s.input, minHeight: 120, resize: 'vertical' }}
                  value={form.executive_summary}
                  onChange={e => setForm({ ...form, executive_summary: e.target.value })}
                  placeholder="Write or AI-generate an executive summary..." />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={s.label}>Methodology</label>
                <textarea style={{ ...s.input, minHeight: 60, resize: 'vertical' }}
                  value={form.methodology_section}
                  onChange={e => setForm({ ...form, methodology_section: e.target.value })}
                  placeholder="Testing methodology and approach..." />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <button style={s.btn} onClick={() => setShowModal(false)}>Cancel</button>
                <button style={s.btnPrimary}
                  disabled={!form.title || createMutation.isLoading}
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
  select: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '6px 10px', fontSize: 11, fontFamily: 'monospace', outline: 'none', cursor: 'pointer' },
  btn: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnPrimary: { background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnDocx: { background: 'var(--blue-dim)', border: '1px solid var(--blue)', borderRadius: 5, color: 'var(--blue)', padding: '5px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnPdf: { background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 5, color: 'var(--red)', padding: '5px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  tag: { background: 'var(--surface2)', color: 'var(--muted)', padding: '2px 7px', borderRadius: 4, fontSize: 10, border: '1px solid var(--border)' },
  label: { fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', display: 'block', marginBottom: 5 },
  input: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' },
  empty: { padding: 40, color: 'var(--muted)', fontSize: 12, textAlign: 'center' },
  emptyBox: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 40, color: 'var(--muted)', fontSize: 12, textAlign: 'center' },
  reportCard: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, display: 'flex', alignItems: 'flex-start', gap: 16 },
  modalBg: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, width: '90%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto' },
  modalHeader: { padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--surface)' },
  modalTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 },
}
