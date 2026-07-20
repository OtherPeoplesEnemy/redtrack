import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import { reportDashboardApi } from '../api/client'
import toast from 'react-hot-toast'

/**
 * Report Dashboard editor. Fills the bespoke sections of the report that RedTrack
 * can't derive from findings — KPI callouts, risk matrix, attack chain,
 * remediation timeline, defensive controls. Saved per engagement and rendered
 * into the report template at generation time.
 */
export default function ReportDashboard({ engagementId }) {
  const qc = useQueryClient()
  const [data, setData] = useState(null)

  const { data: loaded, isLoading } = useQuery(
    ['report-dashboard', engagementId],
    () => reportDashboardApi.get(engagementId).then(r => r.data)
  )

  useEffect(() => { if (loaded) setData(loaded) }, [loaded])

  const save = useMutation(
    (payload) => reportDashboardApi.save(engagementId, payload).then(r => r.data),
    {
      onSuccess: () => { qc.invalidateQueries(['report-dashboard', engagementId]); toast.success('Report dashboard saved') },
      onError: (e) => toast.error(e.response?.data?.detail || 'Save failed'),
    }
  )

  if (isLoading || !data) return <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</div>

  // ── helpers to update nested list/dict state ──
  const setField = (key, val) => setData(d => ({ ...d, [key]: val }))
  const updateList = (key, idx, field, val) =>
    setData(d => ({ ...d, [key]: d[key].map((it, i) => i === idx ? { ...it, [field]: val } : it) }))
  const addRow = (key, row) => setData(d => ({ ...d, [key]: [...(d[key] || []), row] }))
  const removeRow = (key, idx) => setData(d => ({ ...d, [key]: d[key].filter((_, i) => i !== idx) }))

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          These sections populate the report's executive dashboard. Filled per engagement, rendered into the report when you generate it.
        </div>
        <button style={s.saveBtn} onClick={() => save.mutate(data)} disabled={save.isLoading}>
          {save.isLoading ? 'Saving…' : 'Save Dashboard'}
        </button>
      </div>

      {/* ── KPI Callouts ── */}
      <Section title="KPI Callouts" hint="The big stat cards at the top of the dashboard.">
        {(data.kpi_callouts || []).map((c, i) => (
          <div key={i} style={s.row}>
            <input style={s.input} placeholder="Label (e.g. Records exposed)" value={c.label || ''} onChange={e => updateList('kpi_callouts', i, 'label', e.target.value)} />
            <input style={{ ...s.input, width: 110 }} placeholder="Value" value={c.value || ''} onChange={e => updateList('kpi_callouts', i, 'value', e.target.value)} />
            <input style={s.input} placeholder="Note (optional)" value={c.note || ''} onChange={e => updateList('kpi_callouts', i, 'note', e.target.value)} />
            <button style={s.del} onClick={() => removeRow('kpi_callouts', i)}>✕</button>
          </div>
        ))}
        <button style={s.add} onClick={() => addRow('kpi_callouts', { label: '', value: '', note: '' })}>+ Add callout</button>
      </Section>

      {/* ── Risk Matrix ── */}
      <Section title="Risk Matrix" hint="Finding counts per likelihood × impact cell (3×3).">
        <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr>
              <th style={s.mth}></th><th style={s.mth}>Low impact</th><th style={s.mth}>Med impact</th><th style={s.mth}>High impact</th>
            </tr>
          </thead>
          <tbody>
            {[['High', 'high'], ['Med', 'med'], ['Low', 'low']].map(([rlabel, rkey]) => (
              <tr key={rkey}>
                <td style={s.mth}>{rlabel} likelihood</td>
                {['low', 'med', 'high'].map(ckey => {
                  const k = `${rkey}_${ckey}`
                  return (
                    <td key={k} style={s.mtd}>
                      <input style={s.matrixInput} type="number" min="0"
                        value={data.risk_matrix?.[k] ?? ''}
                        onChange={e => setField('risk_matrix', { ...data.risk_matrix, [k]: parseInt(e.target.value) || 0 })} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* ── Attack Chain ── */}
      <Section title="Attack Chain" hint="The step-by-step compromise path.">
        {(data.attack_chain || []).map((c, i) => (
          <div key={i} style={s.row}>
            <span style={s.num}>{i + 1}</span>
            <input style={s.input} placeholder="Action (e.g. Initial Access)" value={c.step || ''} onChange={e => updateList('attack_chain', i, 'step', e.target.value)} />
            <input style={s.input} placeholder="Detail" value={c.detail || ''} onChange={e => updateList('attack_chain', i, 'detail', e.target.value)} />
            <input style={s.input} placeholder="Outcome" value={c.outcome || ''} onChange={e => updateList('attack_chain', i, 'outcome', e.target.value)} />
            <button style={s.del} onClick={() => removeRow('attack_chain', i)}>✕</button>
          </div>
        ))}
        <button style={s.add} onClick={() => addRow('attack_chain', { step: '', detail: '', outcome: '' })}>+ Add step</button>
      </Section>

      {/* ── Remediation ── */}
      <Section title="Remediation Priorities" hint="P0–P3 timeline of what to fix.">
        {(data.remediation || []).map((c, i) => (
          <div key={i} style={s.row}>
            <input style={{ ...s.input, width: 140 }} placeholder="P0 — Now" value={c.priority || ''} onChange={e => updateList('remediation', i, 'priority', e.target.value)} />
            <input style={s.input} placeholder="Items (· separated)" value={c.items || ''} onChange={e => updateList('remediation', i, 'items', e.target.value)} />
            <button style={s.del} onClick={() => removeRow('remediation', i)}>✕</button>
          </div>
        ))}
        <button style={s.add} onClick={() => addRow('remediation', { priority: '', items: '' })}>+ Add priority</button>
      </Section>

      {/* ── Defensive Controls ── */}
      <Section title="Defensive Controls" hint="What worked (pass) and what didn't (fail).">
        {(data.defensive_controls || []).map((c, i) => (
          <div key={i} style={s.row}>
            <select style={{ ...s.input, width: 90 }} value={c.status || 'pass'} onChange={e => updateList('defensive_controls', i, 'status', e.target.value)}>
              <option value="pass">PASS</option>
              <option value="fail">FAIL</option>
            </select>
            <input style={s.input} placeholder="Control description" value={c.text || ''} onChange={e => updateList('defensive_controls', i, 'text', e.target.value)} />
            <button style={s.del} onClick={() => removeRow('defensive_controls', i)}>✕</button>
          </div>
        ))}
        <button style={s.add} onClick={() => addRow('defensive_controls', { status: 'pass', text: '' })}>+ Add control</button>
      </Section>

      <div style={{ marginTop: 20, textAlign: 'right' }}>
        <button style={s.saveBtn} onClick={() => save.mutate(data)} disabled={save.isLoading}>
          {save.isLoading ? 'Saving…' : 'Save Dashboard'}
        </button>
      </div>
    </div>
  )
}

function Section({ title, hint, children }) {
  return (
    <div style={{ marginBottom: 24, border: '1px solid var(--border)', borderRadius: 8, padding: 16, background: 'var(--surface)' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 10, color: 'var(--muted2)', marginBottom: 12 }}>{hint}</div>
      {children}
    </div>
  )
}

const s = {
  row: { display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' },
  input: { flex: 1, background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 4, color: 'var(--text)', padding: '5px 8px', fontSize: 11, minWidth: 0 },
  num: { width: 20, textAlign: 'center', fontSize: 11, color: 'var(--muted2)', flexShrink: 0 },
  del: { background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 12, flexShrink: 0, padding: '0 4px' },
  add: { background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 4, color: 'var(--text)', padding: '5px 10px', fontSize: 10, cursor: 'pointer', marginTop: 4 },
  saveBtn: { background: 'var(--accent, #2e5fa3)', border: 'none', borderRadius: 5, color: '#fff', padding: '7px 16px', fontSize: 12, cursor: 'pointer', fontWeight: 600 },
  mth: { border: '1px solid var(--border)', padding: '4px 8px', fontSize: 10, color: 'var(--muted)', background: 'var(--surface2)', fontWeight: 600 },
  mtd: { border: '1px solid var(--border)', padding: 2 },
  matrixInput: { width: 50, background: 'var(--surface2)', border: 'none', color: 'var(--text)', padding: '6px', fontSize: 12, textAlign: 'center' },
}
