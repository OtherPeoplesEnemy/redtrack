import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import api from '../api/client'
import toast from 'react-hot-toast'

const COLUMNS = [
  { id: 'Todo', label: 'To Do', color: 'var(--muted)' },
  { id: 'In Progress', label: 'In Progress', color: '#f0883e' },
  { id: 'Review', label: 'Review', color: '#60a5fa' },
  { id: 'Done', label: 'Done', color: '#4ade80' },
  { id: 'Blocked', label: 'Blocked', color: '#e05252' },
]

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical']
const PRIORITY_COLOR = { Low: '#60a5fa', Medium: '#f0883e', High: '#e05252', Critical: '#a855f7' }

export default function TaskBoard({ engagementId }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [expandedTask, setExpandedTask] = useState(null)
  const [dragTask, setDragTask] = useState(null)
  const [form, setForm] = useState({ title: '', description: '', assignee: '', priority: 'Medium', due_date: '' })

  const { data: tasks = [], isLoading } = useQuery(
    ['tasks', engagementId],
    () => api.get(`/tasks/${engagementId}`).then(r => r.data),
    { enabled: !!engagementId }
  )

  const { data: users = [] } = useQuery('users', () => api.get('/users/').then(r => r.data))

  const createMutation = useMutation(
    (data) => api.post(`/tasks/${engagementId}`, data),
    {
      onSuccess: () => {
        qc.invalidateQueries(['tasks', engagementId])
        setShowModal(false)
        setForm({ title: '', description: '', assignee: '', priority: 'Medium', due_date: '' })
        toast.success('Task created')
      },
      onError: () => toast.error('Failed to create task'),
    }
  )

  const updateMutation = useMutation(
    ({ id, data }) => api.patch(`/tasks/task/${id}`, data),
    { onSuccess: () => qc.invalidateQueries(['tasks', engagementId]) }
  )

  const deleteMutation = useMutation(
    (id) => api.delete(`/tasks/task/${id}`),
    {
      onSuccess: () => { qc.invalidateQueries(['tasks', engagementId]); toast.success('Task deleted') }
    }
  )

  function handleDrop(newStatus) {
    if (!dragTask || dragTask.status === newStatus) return
    updateMutation.mutate({ id: dragTask.id, data: { status: newStatus } })
    setDragTask(null)
  }

  const byStatus = (status) => tasks.filter(t => t.status === status)

  const totalDone = tasks.filter(t => t.status === 'Done').length
  const progress = tasks.length ? Math.round(totalDone / tasks.length * 100) : 0

  if (isLoading) return <div style={{ padding: 20, color: 'var(--muted)', fontSize: 12 }}>Loading tasks...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
          {tasks.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{totalDone}/{tasks.length} done</div>
              <div style={{ flex: 1, maxWidth: 200, height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: '#4ade80', borderRadius: 2, transition: 'width .3s' }} />
              </div>
              <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 700 }}>{progress}%</div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={s.btn} onClick={() => navigate('/task-library')}>📚 Browse Library</button>
          <button style={s.btnPrimary} onClick={() => setShowModal(true)}>+ Add Task</button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div style={s.emptyBox}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No tasks yet</div>
          <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 16 }}>Add tasks and assign them to your team</div>
          <button style={s.btnPrimary} onClick={() => setShowModal(true)}>+ Add First Task</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, overflowX: 'auto' }}>
          {COLUMNS.map(col => (
            <div key={col.id}
              onDragOver={e => e.preventDefault()}
              onDrop={() => handleDrop(col.id)}
              style={s.column}>
              <div style={s.colHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: col.color, flexShrink: 0 }} />
                  <span style={{ ...s.colTitle, color: col.color }}>{col.label}</span>
                </div>
                <span style={s.colCount}>{byStatus(col.id).length}</span>
              </div>

              <div style={s.colBody}>
                {byStatus(col.id).map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    users={users}
                    expanded={expandedTask === task.id}
                    onExpand={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                    onUpdate={(data) => updateMutation.mutate({ id: task.id, data })}
                    onDelete={() => { if (confirm('Delete this task?')) deleteMutation.mutate(task.id) }}
                    onDragStart={() => setDragTask(task)}
                  />
                ))}
                {byStatus(col.id).length === 0 && (
                  <div style={s.dropZone}>Drop here</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create task modal */}
      {showModal && (
        <div style={s.modalBg} >
          <div style={s.modal}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>New Task</span>
              <button style={s.closeBtn} onClick={() => setShowModal(false)}>×</button>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>Title *</label>
                <input style={s.input} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Enumerate AD users via LDAP" autoFocus />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>Description</label>
                <textarea style={{ ...s.input, minHeight: 80, resize: 'vertical' }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What needs to be done?" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={s.label}>Assignee</label>
                  <select style={s.input} value={form.assignee} onChange={e => setForm({ ...form, assignee: e.target.value })}>
                    <option value="">— Unassigned —</option>
                    {users.map(u => <option key={u.id} value={u.username}>@{u.username} ({u.full_name})</option>)}
                  </select>
                </div>
                <div>
                  <label style={s.label}>Priority</label>
                  <select style={s.input} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                    {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={s.label}>Due Date</label>
                <input type="date" style={s.input} value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <button style={s.btn} onClick={() => setShowModal(false)}>Cancel</button>
                <button style={s.btnPrimary} disabled={!form.title || createMutation.isLoading}
                  onClick={() => createMutation.mutate(form)}>
                  {createMutation.isLoading ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TaskCard({ task, users, expanded, onExpand, onUpdate, onDelete, onDragStart }) {
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'Done'

  return (
    <div draggable onDragStart={onDragStart}
      style={{ ...cs.card, borderColor: isOverdue ? '#e0525255' : 'var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 6 }} onClick={onExpand}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3, marginBottom: 4 }}>{task.title}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <span style={{ ...cs.badge, color: PRIORITY_COLOR[task.priority], borderColor: PRIORITY_COLOR[task.priority] + '44' }}>{task.priority}</span>
            {task.assignee && <span style={cs.assignee}>@{task.assignee}</span>}
            {task.due_date && (
              <span style={{ ...cs.assignee, color: isOverdue ? '#e05252' : 'var(--muted)' }}>
                {isOverdue ? '⚠ ' : ''}{new Date(task.due_date).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <div>
            <div style={cs.fieldLabel}>Status</div>
            <select style={cs.input} value={task.status} onChange={e => onUpdate({ status: e.target.value })}>
              {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <div style={cs.fieldLabel}>Assignee</div>
            <select style={cs.input} value={task.assignee || ''} onChange={e => onUpdate({ assignee: e.target.value })}>
              <option value="">— Unassigned —</option>
              {users.map(u => <option key={u.id} value={u.username}>@{u.username} ({u.full_name})</option>)}
            </select>
          </div>
          <div>
            <div style={cs.fieldLabel}>Priority</div>
            <select style={cs.input} value={task.priority} onChange={e => onUpdate({ priority: e.target.value })}>
              {PRIORITIES.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <div style={cs.fieldLabel}>Due Date</div>
            <input type="date" style={cs.input} value={task.due_date?.slice(0, 10) || ''} onChange={e => onUpdate({ due_date: e.target.value || null })} />
          </div>
          <div>
            <div style={cs.fieldLabel}>Description</div>
            <textarea style={{ ...cs.input, minHeight: 60, resize: 'vertical' }}
              value={task.description || ''}
              onChange={e => onUpdate({ description: e.target.value })}
              placeholder="Task details, notes, results..." />
          </div>
          <div>
            <div style={cs.fieldLabel}>Notes</div>
            <textarea style={{ ...cs.input, minHeight: 60, resize: 'vertical' }}
              value={task.notes || ''}
              onChange={e => onUpdate({ notes: e.target.value })}
              placeholder="Progress notes, blockers, findings..." />
          </div>
          <button style={{ ...cs.deleteBtn }} onClick={onDelete}>Delete Task</button>
        </div>
      )}
    </div>
  )
}

const s = {
  btnPrimary: { background: 'var(--red)', border: 'none', borderRadius: 5, color: '#fff', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  btn: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  emptyBox: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 40, textAlign: 'center', color: 'var(--text)' },
  column: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 180 },
  colHeader: { padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface2)' },
  colTitle: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' },
  colCount: { fontSize: 10, color: 'var(--muted)', background: 'var(--surface)', padding: '1px 6px', borderRadius: 8 },
  colBody: { flex: 1, padding: 8, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 80 },
  dropZone: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted2)', fontSize: 11, border: '2px dashed var(--border)', borderRadius: 6, padding: 16, minHeight: 60 },
  label: { fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', display: 'block', marginBottom: 5 },
  input: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' },
  modalBg: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, width: '90%', maxWidth: 500, maxHeight: '85vh', overflowY: 'auto' },
  modalHeader: { padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--surface)' },
  modalTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 },
}

const cs = {
  card: { background: 'var(--surface2)', border: '1px solid', borderRadius: 6, padding: 10, cursor: 'grab' },
  badge: { fontSize: 9, padding: '1px 6px', borderRadius: 3, border: '1px solid', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' },
  assignee: { fontSize: 9, padding: '1px 6px', borderRadius: 3, border: '1px solid var(--border)', color: 'var(--muted)', background: 'var(--surface)', fontFamily: 'monospace' },
  fieldLabel: { fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 4, fontWeight: 700 },
  input: { width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 4, color: 'var(--text)', padding: '5px 8px', fontSize: 11, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' },
  deleteBtn: { background: 'none', border: '1px solid var(--red-mid)', borderRadius: 4, color: 'var(--red)', padding: '4px 10px', fontSize: 10, cursor: 'pointer', fontFamily: 'monospace', alignSelf: 'flex-start' },
}
