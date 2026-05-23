import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import api from '../api/client'
import { engagementsApi } from '../api/client'
import toast from 'react-hot-toast'

const CATEGORIES = ['All', 'Recon & OSINT', 'Web Application', 'Network & Internal', 'Cloud Security', 'AI Red Team', 'Reporting', 'Custom']
const PRIORITIES = ['All', 'Critical', 'High', 'Medium', 'Low']
const PRIORITY_COLOR = { Critical: '#a855f7', High: '#e05252', Medium: '#f0883e', Low: '#60a5fa' }
const PRIORITY_DIM = { Critical: 'var(--purple-dim)', High: 'var(--red-dim)', Medium: 'var(--amber-dim)', Low: 'var(--blue-dim)' }

export default function TaskLibrary() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [priFilter, setPriFilter] = useState('All')
  const [selected, setSelected] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [importEngId, setImportEngId] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [activeSource, setActiveSource] = useState('library')
  const [createForm, setCreateForm] = useState({ title: '', category: 'Custom', priority: 'Medium', description: '', tools: '', references: '' })

  const { data: templates = [], isLoading } = useQuery(
    ['task-library', search, catFilter],
    () => api.get('/task-library/', { params: { search: search || undefined, category: catFilter !== 'All' ? catFilter : undefined } }).then(r => r.data)
  )

  const { data: engagements = [] } = useQuery('engagements', () => engagementsApi.list({}).then(r => r.data))

  const importMutation = useMutation(
    ({ templateId, engId }) => api.post(`/task-library/${templateId}/import/${engId}`),
    {
      onSuccess: (res) => { toast.success(`Task added to engagement`); setShowImport(false); setImportEngId('') },
      onError: () => toast.error('Import failed'),
    }
  )

  const createMutation = useMutation(
    (data) => api.post('/task-library/', data),
    {
      onSuccess: () => { qc.invalidateQueries('task-library'); setShowCreate(false); setCreateForm({ title: '', category: 'Custom', priority: 'Medium', description: '', tools: '', references: '' }); toast.success('Task template saved') },
      onError: () => toast.error('Failed to save'),
    }
  )

  const deleteMutation = useMutation(
    (id) => api.delete(`/task-library/${id}`),
    { onSuccess: () => { qc.invalidateQueries('task-library'); setSelected(null); toast.success('Template deleted') } }
  )

  async function generateAI() {
    if (!aiPrompt.trim()) { toast.error('Describe the task first'); return }
    setAiLoading(true)
    try {
      const { data } = await api.post('/task-library/ai-generate', { prompt: aiPrompt })
      setSelected(data)
      qc.invalidateQueries('task-library')
      toast.success('Task generated and saved to library')
      setAiPrompt('')
      setActiveSource('library')
    } catch { toast.error('AI generation failed') }
    finally { setAiLoading(false) }
  }

  const filtered = templates.filter(t => priFilter === 'All' || t.priority === priFilter)

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <div style={s.title}>Task Library <span style={s.sub}>{filtered.length} templates</span></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={activeSource === 'ai' ? s.btnAi : s.btn} onClick={() => setActiveSource(activeSource === 'ai' ? 'library' : 'ai')}>
            ◎ AI Generate
          </button>
          <button style={s.btnPrimary} onClick={() => setShowCreate(true)}>+ Create Template</button>
        </div>
      </div>

      {/* AI Generate panel */}
      {activeSource === 'ai' && (
        <div style={{ background: 'var(--purple-dim)', border: '1px solid var(--purple)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 700, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>◎ AI Task Generator</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <input style={{ ...s.search, flex: 1 }}
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && generateAI()}
              placeholder='Describe a pentest task e.g. "Test for JWT algorithm confusion" or "Enumerate Azure storage accounts"' />
            <button style={{ ...s.btnPrimary, background: 'var(--purple)', whiteSpace: 'nowrap' }} onClick={generateAI} disabled={aiLoading}>
              {aiLoading ? 'Generating...' : '◎ Generate'}
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>Generated tasks are saved to your library automatically</div>
        </div>
      )}

      {/* Filters */}
      <div style={s.filterRow}>
        <input style={s.search} placeholder="Search tasks..." value={search} onChange={e => setSearch(e.target.value)} />
        <select style={s.select} value={priFilter} onChange={e => setPriFilter(e.target.value)}>
          {PRIORITIES.map(p => <option key={p}>{p}</option>)}
        </select>
      </div>

      {/* Category pills */}
      <div style={s.catRow}>
        {CATEGORIES.map(cat => (
          <button key={cat} onClick={() => setCatFilter(cat)}
            style={{ ...s.catBtn, background: catFilter === cat ? 'var(--red-dim)' : 'var(--surface)', color: catFilter === cat ? 'var(--red)' : 'var(--muted)', borderColor: catFilter === cat ? 'var(--red)' : 'var(--border)' }}>
            {cat}
          </button>
        ))}
      </div>

      <div style={s.layout}>
        {/* List */}
        <div style={s.list}>
          {isLoading && <div style={s.empty}>Loading...</div>}
          {!isLoading && filtered.length === 0 && <div style={s.empty}>No templates found</div>}
          {filtered.map(t => (
            <div key={t.id} onClick={() => setSelected(t)}
              style={{ ...s.card, borderColor: selected?.id === t.id ? 'var(--red)' : 'var(--border)', background: selected?.id === t.id ? 'var(--red-dim)' : 'var(--surface)' }}>
              <div style={s.cardTop}>
                <span style={{ ...s.priBadge, color: PRIORITY_COLOR[t.priority], borderColor: PRIORITY_COLOR[t.priority] + '55', background: PRIORITY_DIM[t.priority] }}>{t.priority}</span>
                {t.tags?.slice(0, 2).map(tag => <span key={tag} style={s.tag}>{tag}</span>)}
              </div>
              <div style={s.cardTitle}>{t.title}</div>
              <div style={s.cardCat}>{t.category}</div>
            </div>
          ))}
        </div>

        {/* Detail */}
        <div style={s.detail}>
          {!selected ? (
            <div style={s.detailEmpty}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Select a task template</div>
              <div style={{ fontSize: 11, color: 'var(--muted2)' }}>Click any task to preview and import into an engagement</div>
            </div>
          ) : (
            <div style={s.detailContent}>
              <div style={s.detailHeader}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <span style={{ ...s.priBadge, color: PRIORITY_COLOR[selected.priority], borderColor: PRIORITY_COLOR[selected.priority] + '55', background: PRIORITY_DIM[selected.priority] }}>{selected.priority}</span>
                    <span style={s.tag}>{selected.category}</span>
                    {selected.tags?.map(tag => <span key={tag} style={s.tag}>{tag}</span>)}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3, marginBottom: 12 }}>{selected.title}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button style={s.btnPrimary} onClick={() => setShowImport(true)}>↓ Import to Engagement</button>
                    <button style={{ ...s.btn, color: 'var(--red)', borderColor: 'var(--red-mid)' }}
                      onClick={() => { if (confirm('Delete this template?')) deleteMutation.mutate(selected.id) }}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>

              {selected.engagement_types?.length > 0 && (
                <div style={s.section}>
                  <div style={s.sectionLabel}>Engagement Types</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {selected.engagement_types.map(et => <span key={et} style={s.tag}>{et}</span>)}
                  </div>
                </div>
              )}

              {[['Description', selected.description], ['Tools & Commands', selected.tools], ['References', selected.references]].filter(([, v]) => v).map(([label, val]) => (
                <div key={label} style={s.section}>
                  <div style={s.sectionLabel}>{label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap', fontFamily: label === 'Tools & Commands' ? 'monospace' : 'inherit', background: label === 'Tools & Commands' ? 'var(--bg)' : 'transparent', padding: label === 'Tools & Commands' ? '8px 10px' : 0, borderRadius: 5, border: label === 'Tools & Commands' ? '1px solid var(--border)' : 'none' }}>{val}</div>
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
              <span style={s.modalTitle}>Import Task to Engagement</span>
              <button style={s.closeBtn} onClick={() => setShowImport(false)}>×</button>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: 12, marginBottom: 20 }}>
                <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 4 }}>Importing</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{selected.title}</div>
                <div style={{ fontSize: 11, color: PRIORITY_COLOR[selected.priority], marginTop: 4 }}>{selected.priority} · {selected.category}</div>
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={s.label}>Select Engagement</label>
                <select style={s.formSelect} value={importEngId} onChange={e => setImportEngId(e.target.value)}>
                  <option value="">— Choose an engagement —</option>
                  {engagements.map(e => <option key={e.id} value={e.id}>{e.ref_id} — {e.client} ({e.name})</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button style={s.btn} onClick={() => setShowImport(false)}>Cancel</button>
                <button style={{ ...s.btnPrimary, opacity: !importEngId ? 0.5 : 1 }} disabled={!importEngId}
                  onClick={() => importMutation.mutate({ templateId: selected.id, engId: importEngId })}>
                  Import Task
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create template modal */}
      {showCreate && (
        <div style={s.modalBg} onClick={e => e.target === e.currentTarget && setShowCreate(false)}>
          <div style={{ ...s.modal, maxWidth: 560, maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>Create Task Template</span>
              <button style={s.closeBtn} onClick={() => setShowCreate(false)}>×</button>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>Title *</label>
                <input style={s.formInput} value={createForm.title} onChange={e => setCreateForm({ ...createForm, title: e.target.value })} placeholder="e.g. LDAP Enumeration via BloodHound" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={s.label}>Category</label>
                  <select style={s.formSelect} value={createForm.category} onChange={e => setCreateForm({ ...createForm, category: e.target.value })}>
                    {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={s.label}>Priority</label>
                  <select style={s.formSelect} value={createForm.priority} onChange={e => setCreateForm({ ...createForm, priority: e.target.value })}>
                    {['Critical', 'High', 'Medium', 'Low'].map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>Description</label>
                <textarea style={{ ...s.formInput, minHeight: 80, resize: 'vertical' }} value={createForm.description} onChange={e => setCreateForm({ ...createForm, description: e.target.value })} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>Tools & Commands</label>
                <textarea style={{ ...s.formInput, minHeight: 80, resize: 'vertical', fontFamily: 'monospace' }} value={createForm.tools} onChange={e => setCreateForm({ ...createForm, tools: e.target.value })} placeholder="Specific commands, tool syntax, flags..." />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={s.label}>References</label>
                <input style={s.formInput} value={createForm.references} onChange={e => setCreateForm({ ...createForm, references: e.target.value })} placeholder="Links, standards, CVEs..." />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <button style={s.btn} onClick={() => setShowCreate(false)}>Cancel</button>
                <button style={s.btnPrimary} disabled={!createForm.title || createMutation.isLoading}
                  onClick={() => createMutation.mutate(createForm)}>
                  Save Template
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
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 },
  sub: { fontSize: 12, color: 'var(--muted)', fontWeight: 400 },
  filterRow: { display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' },
  search: { flex: 1, minWidth: 200, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '7px 12px', fontSize: 12, fontFamily: 'monospace', outline: 'none' },
  select: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '7px 10px', fontSize: 11, fontFamily: 'monospace', outline: 'none', cursor: 'pointer' },
  catRow: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 },
  catBtn: { border: '1px solid', borderRadius: 5, padding: '4px 10px', fontSize: 10, cursor: 'pointer', fontFamily: 'monospace' },
  layout: { display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, flex: 1, minHeight: 0, overflow: 'hidden' },
  list: { overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 },
  card: { border: '1px solid', borderRadius: 7, padding: 12, cursor: 'pointer', transition: 'border-color .15s, background .15s' },
  cardTop: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' },
  cardTitle: { fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3, marginBottom: 3 },
  cardCat: { fontSize: 10, color: 'var(--muted)' },
  priBadge: { padding: '2px 7px', borderRadius: 3, fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', border: '1px solid', whiteSpace: 'nowrap' },
  tag: { background: 'var(--surface2)', color: 'var(--muted)', padding: '2px 7px', borderRadius: 4, fontSize: 10, border: '1px solid var(--border)', fontFamily: 'monospace' },
  empty: { padding: 40, color: 'var(--muted)', fontSize: 12, textAlign: 'center' },
  detail: { overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 },
  detailEmpty: { height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', textAlign: 'center', padding: 40 },
  detailContent: { padding: 20 },
  detailHeader: { marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6, fontWeight: 700 },
  btn: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnPrimary: { background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btnAi: { background: 'var(--purple-dim)', border: '1px solid var(--purple)', borderRadius: 5, color: 'var(--purple)', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  label: { fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', display: 'block', marginBottom: 5 },
  formInput: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' },
  formSelect: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', cursor: 'pointer' },
  modalBg: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, width: '90%', maxWidth: 480 },
  modalHeader: { padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 },
}
