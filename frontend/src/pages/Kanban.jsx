import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import { useNavigate } from 'react-router-dom'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import { engagementsApi } from '../api/client'
import toast from 'react-hot-toast'

const COLUMNS = [
  { id: 'Planning', label: 'Planning', color: '#60a5fa' },
  { id: 'Active', label: 'Active', color: '#4ade80' },
  { id: 'Completed', label: 'Completed', color: '#6b7899' },
  { id: 'Archived', label: 'Archived', color: '#4a5568' },
]

const SEV_COLOR = { Critical: '#e05252', High: '#f0883e', Medium: '#fbbf24', Low: '#60a5fa', Info: '#6b7899' }

export default function Kanban() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: engagements = [] } = useQuery('engagements', () =>
    engagementsApi.list({}).then(r => r.data)
  )

  const updateMutation = useMutation(
    ({ id, status }) => engagementsApi.updateStatus(id, status),
    {
      onSuccess: () => qc.invalidateQueries('engagements'),
      onError: () => toast.error('Failed to update status'),
    }
  )

  function onDragEnd(result) {
    const { destination, source, draggableId } = result
    if (!destination) return
    if (destination.droppableId === source.droppableId) return
    updateMutation.mutate({ id: draggableId, status: destination.droppableId })
  }

  const byStatus = (status) => engagements.filter(e => e.status === status)

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <div style={s.title}>Kanban Board <span style={s.sub}>engagement pipeline</span></div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{engagements.length} total engagements</div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div style={s.board}>
          {COLUMNS.map(col => (
            <div key={col.id} style={s.column}>
              <div style={s.colHeader}>
                <div style={{ ...s.colDot, background: col.color }} />
                <span style={s.colTitle}>{col.label}</span>
                <span style={s.colCount}>{byStatus(col.id).length}</span>
              </div>

              <Droppable droppableId={col.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    style={{
                      ...s.colBody,
                      background: snapshot.isDraggingOver ? 'var(--surface3)' : 'transparent',
                    }}
                  >
                    {byStatus(col.id).map((eng, index) => (
                      <Draggable key={eng.id} draggableId={eng.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            style={{
                              ...s.card,
                              boxShadow: snapshot.isDragging ? '0 8px 24px rgba(0,0,0,.4)' : 'none',
                              ...provided.draggableProps.style,
                            }}
                            onClick={() => navigate(`/engagements/${eng.id}`)}
                          >
                            <div style={s.cardType}>{eng.type}</div>
                            <div style={s.cardName}>{eng.name}</div>
                            <div style={s.cardClient}>{eng.client}</div>

                            <div style={s.cardMeta}>
                              <div style={s.cardMetaItem}>
                                <span style={{ color: 'var(--muted)', fontSize: 9 }}>FINDINGS</span>
                                <span style={{ fontSize: 13, fontWeight: 700 }}>{eng.finding_count}</span>
                              </div>
                              {eng.critical_count > 0 && (
                                <div style={s.cardMetaItem}>
                                  <span style={{ color: 'var(--muted)', fontSize: 9 }}>CRITICAL</span>
                                  <span style={{ fontSize: 13, fontWeight: 700, color: '#e05252' }}>{eng.critical_count}</span>
                                </div>
                              )}
                              <div style={s.cardMetaItem}>
                                <span style={{ color: 'var(--muted)', fontSize: 9 }}>OPEN</span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: '#f0883e' }}>{eng.open_count}</span>
                              </div>
                            </div>

                            {eng.finding_count > 0 && (
                              <div style={s.progressBar}>
                                <div style={{
                                  height: '100%',
                                  width: `${Math.round(eng.remediated_count / eng.finding_count * 100)}%`,
                                  background: '#4ade80',
                                  borderRadius: 2,
                                  transition: 'width .3s',
                                }} />
                              </div>
                            )}

                            <div style={s.cardFooter}>
                              <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>{eng.ref_id}</span>
                              {eng.end_date && (
                                <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                                  Due {new Date(eng.end_date).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {byStatus(col.id).length === 0 && (
                      <div style={s.empty}>Drop here</div>
                    )}
                  </div>
                )}
              </Droppable>
            </div>
          ))}
        </div>
      </DragDropContext>
    </div>
  )
}

const s = {
  page: { padding: 24, height: '100%', display: 'flex', flexDirection: 'column' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 },
  sub: { fontSize: 12, color: 'var(--muted)', fontWeight: 400 },
  board: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, flex: 1, minHeight: 0 },
  column: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  colHeader: { padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 },
  colDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  colTitle: { fontSize: 11, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.08em', flex: 1 },
  colCount: { fontSize: 11, color: 'var(--muted)', background: 'var(--surface2)', padding: '2px 7px', borderRadius: 10 },
  colBody: { flex: 1, padding: 10, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 100, borderRadius: '0 0 8px 8px', transition: 'background .15s' },
  card: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, padding: 12, cursor: 'pointer', transition: 'border-color .15s' },
  cardType: { fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 4 },
  cardName: { fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2, lineHeight: 1.3 },
  cardClient: { fontSize: 11, color: 'var(--muted)', marginBottom: 10 },
  cardMeta: { display: 'flex', gap: 12, marginBottom: 8 },
  cardMetaItem: { display: 'flex', flexDirection: 'column', gap: 1 },
  progressBar: { height: 3, background: 'var(--surface3)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 },
  cardFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  empty: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted2)', fontSize: 11, border: '2px dashed var(--border)', borderRadius: 6, padding: 20, minHeight: 80 },
}
