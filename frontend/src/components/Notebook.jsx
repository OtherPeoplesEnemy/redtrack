import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import ReactMarkdown from 'react-markdown'
import { notesApi } from '../api/client'
import toast from 'react-hot-toast'

/**
 * Engagement notebook.
 *
 * Two kinds of note live in one tree:
 *   source='rednote'  — pushed from the desktop app, one subtree per pusher.
 *                       Read-only here; RedNote is the source of truth and would
 *                       overwrite anything edited on this side.
 *   source='redtrack' — written here, fully editable, for people not using RedNote.
 */
export default function Notebook({ engagementId }) {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState(null)
  const [collapsed, setCollapsed] = useState({})
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ title: '', content: '' })

  const { data: notes = [], isLoading } = useQuery(
    ['notes', engagementId],
    () => notesApi.list(engagementId).then(r => r.data)
  )

  const byParent = useMemo(() => {
    const m = {}
    for (const n of notes) {
      const k = n.parent_id || '__root__'
      ;(m[k] = m[k] || []).push(n)
    }
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title))
    return m
  }, [notes])

  const selected = notes.find(n => n.id === selectedId) || null
  const readOnly = selected?.source === 'rednote'

  const createNote = useMutation((data) => notesApi.create(engagementId, data).then(r => r.data), {
    onSuccess: (n) => {
      qc.invalidateQueries(['notes', engagementId])
      setSelectedId(n.id)
      setDraft({ title: n.title, content: n.content })
      setEditing(true)
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Could not create note'),
  })

  const saveNote = useMutation(({ id, data }) => notesApi.update(id, data).then(r => r.data), {
    onSuccess: () => { qc.invalidateQueries(['notes', engagementId]); setEditing(false); toast.success('Saved') },
    onError: (e) => toast.error(e.response?.data?.detail || 'Could not save'),
  })

  const deleteNote = useMutation((id) => notesApi.remove(id), {
    onSuccess: () => { qc.invalidateQueries(['notes', engagementId]); setSelectedId(null); toast.success('Deleted') },
    onError: (e) => toast.error(e.response?.data?.detail || 'Could not delete'),
  })

  function select(n) {
    setSelectedId(n.id)
    setEditing(false)
    setDraft({ title: n.title, content: n.content })
  }

  function renderTree(parentKey, depth) {
    const kids = byParent[parentKey] || []
    return kids.map(n => {
      const hasKids = (byParent[n.id] || []).length > 0
      const isCollapsed = collapsed[n.id]
      return (
        <div key={n.id}>
          <div
            onClick={() => select(n)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 8px', paddingLeft: 8 + depth * 14,
              cursor: 'pointer', fontSize: 12, borderRadius: 4,
              background: selectedId === n.id ? 'var(--surface2)' : 'transparent',
              color: selectedId === n.id ? 'var(--text)' : 'var(--muted)',
            }}
          >
            <span
              onClick={e => { e.stopPropagation(); if (hasKids) setCollapsed(c => ({ ...c, [n.id]: !c[n.id] })) }}
              style={{ width: 10, fontSize: 9, color: 'var(--muted2)', flexShrink: 0 }}
            >
              {hasKids ? (isCollapsed ? '▸' : '▾') : ''}
            </span>
            <span style={{ flexShrink: 0 }}>{n.icon || '📄'}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
            {n.source === 'rednote' && !n.parent_id && (
              <span style={{ marginLeft: 'auto', fontSize: 8, color: 'var(--muted2)', border: '1px solid var(--border)', borderRadius: 3, padding: '0 4px', flexShrink: 0 }}>
                SYNCED
              </span>
            )}
          </div>
          {hasKids && !isCollapsed && renderTree(n.id, depth + 1)}
        </div>
      )
    })
  }

  if (isLoading) return <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading notebook…</div>

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
        Notebooks pushed from RedNote appear per tester and are read-only here. Notes created in RedTrack are editable by the team.
      </div>

      <div style={{ display: 'flex', gap: 16, minHeight: 420 }}>
        {/* Tree */}
        <div style={{ width: 260, flexShrink: 0, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', padding: 8, overflowY: 'auto', maxHeight: 600 }}>
          <button
            style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: '6px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace', marginBottom: 8 }}
            onClick={() => createNote.mutate({ title: 'New note', icon: '📝', content: '' })}
          >
            + New note
          </button>
          {notes.length === 0
            ? <div style={{ fontSize: 11, color: 'var(--muted2)', fontStyle: 'italic', padding: 8 }}>
                Nothing here yet. Create a note, or push one from RedNote.
              </div>
            : renderTree('__root__', 0)}
        </div>

        {/* Viewer / editor */}
        <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', padding: 16, overflowY: 'auto', maxHeight: 600 }}>
          {!selected ? (
            <div style={{ color: 'var(--muted2)', fontSize: 12, textAlign: 'center', paddingTop: 60 }}>
              Select a note
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 16 }}>{selected.icon || '📄'}</span>
                {editing
                  ? <input
                      value={draft.title}
                      onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                      style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 4, color: 'var(--text)', padding: '4px 8px', fontSize: 13, fontFamily: 'monospace' }}
                    />
                  : <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{selected.title}</span>}

                {readOnly ? (
                  <span style={{ fontSize: 9, color: 'var(--muted2)', border: '1px solid var(--border)', borderRadius: 3, padding: '2px 6px' }}>
                    read-only · synced from RedNote{selected.owner_name ? ` · ${selected.owner_name}` : ''}
                  </span>
                ) : editing ? (
                  <>
                    <button style={btn} onClick={() => saveNote.mutate({ id: selected.id, data: draft })}>Save</button>
                    <button style={btn} onClick={() => { setEditing(false); setDraft({ title: selected.title, content: selected.content }) }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button style={btn} onClick={() => setEditing(true)}>Edit</button>
                    <button
                      style={{ ...btn, color: 'var(--red)' }}
                      onClick={() => { if (window.confirm(`Delete "${selected.title}"?`)) deleteNote.mutate(selected.id) }}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>

              {editing ? (
                <textarea
                  value={draft.content}
                  onChange={e => setDraft(d => ({ ...d, content: e.target.value }))}
                  placeholder="Markdown…"
                  style={{ width: '100%', minHeight: 380, boxSizing: 'border-box', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, color: 'var(--text)', padding: 10, fontSize: 12, fontFamily: 'monospace', lineHeight: 1.7, resize: 'vertical' }}
                />
              ) : selected.content?.trim() ? (
                <div className="selectable" style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.7 }}>
                  <ReactMarkdown>{selected.content}</ReactMarkdown>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--muted2)', fontStyle: 'italic' }}>Empty</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const btn = {
  background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 4,
  color: 'var(--text)', padding: '4px 10px', fontSize: 10, cursor: 'pointer', fontFamily: 'monospace',
}
