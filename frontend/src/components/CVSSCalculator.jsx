import { useState, useEffect } from 'react'

// CVSS 3.1 Scoring
const METRICS = {
  AV: { label: 'Attack Vector', options: { N: ['Network', 0.85], A: ['Adjacent', 0.62], L: ['Local', 0.55], P: ['Physical', 0.2] } },
  AC: { label: 'Attack Complexity', options: { L: ['Low', 0.77], H: ['High', 0.44] } },
  PR: { label: 'Privileges Required', options: { N: ['None', 0.85], L: ['Low', 0.62], H: ['High', 0.27] } },
  UI: { label: 'User Interaction', options: { N: ['None', 0.85], R: ['Required', 0.62] } },
  S:  { label: 'Scope', options: { U: ['Unchanged', null], C: ['Changed', null] } },
  C:  { label: 'Confidentiality', options: { N: ['None', 0], L: ['Low', 0.22], H: ['High', 0.56] } },
  I:  { label: 'Integrity', options: { N: ['None', 0], L: ['Low', 0.22], H: ['High', 0.56] } },
  A:  { label: 'Availability', options: { N: ['None', 0], L: ['Low', 0.22], H: ['High', 0.56] } },
}

const DEFAULT = { AV: 'N', AC: 'L', PR: 'N', UI: 'N', S: 'U', C: 'N', I: 'N', A: 'N' }

function roundUp(val) {
  const int = Math.round(val * 100000)
  if (int % 10000 === 0) return int / 100000
  return (Math.floor(int / 10000) + 1) / 10
}

function calcScore(v) {
  const av = METRICS.AV.options[v.AV][1]
  const ac = METRICS.AC.options[v.AC][1]
  const ui = METRICS.UI.options[v.UI][1]
  const c  = METRICS.C.options[v.C][1]
  const i  = METRICS.I.options[v.I][1]
  const a  = METRICS.A.options[v.A][1]
  const scope = v.S

  let pr = METRICS.PR.options[v.PR][1]
  // PR changes when scope is Changed
  if (scope === 'C') {
    pr = { N: 0.85, L: 0.68, H: 0.50 }[v.PR]
  }

  const iss = 1 - (1 - c) * (1 - i) * (1 - a)
  const impact = scope === 'U'
    ? 6.42 * iss
    : 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)

  if (impact <= 0) return 0

  const exploitability = 8.22 * av * ac * pr * ui
  const base = scope === 'U'
    ? Math.min(impact + exploitability, 10)
    : Math.min(1.08 * (impact + exploitability), 10)

  return roundUp(base)
}

function scoreToSeverity(score) {
  if (score === 0) return 'None'
  if (score < 4) return 'Low'
  if (score < 7) return 'Medium'
  if (score < 9) return 'High'
  return 'Critical'
}

function buildVector(v) {
  return `CVSS:3.1/AV:${v.AV}/AC:${v.AC}/PR:${v.PR}/UI:${v.UI}/S:${v.S}/C:${v.C}/I:${v.I}/A:${v.A}`
}

const SEV_COLOR = { None: '#6b7899', Low: '#60a5fa', Medium: '#f0883e', High: '#e05252', Critical: '#a855f7' }
const SEV_DIM = { None: 'var(--surface3)', Low: 'var(--blue-dim)', Medium: 'var(--amber-dim)', High: 'var(--red-dim)', Critical: 'var(--purple-dim)' }

export default function CVSSCalculator({ onApply, initialVector }) {
  const [vals, setVals] = useState(() => {
    if (initialVector) {
      try {
        const parsed = {}
        initialVector.replace('CVSS:3.1/', '').split('/').forEach(part => {
          const [k, v] = part.split(':')
          parsed[k] = v
        })
        return { ...DEFAULT, ...parsed }
      } catch { return DEFAULT }
    }
    return DEFAULT
  })

  const score = calcScore(vals)
  const severity = scoreToSeverity(score)
  const vector = buildVector(vals)

  function set(metric, val) {
    setVals(prev => ({ ...prev, [metric]: val }))
  }

  return (
    <div style={s.calc}>
      {/* Score display */}
      <div style={{ ...s.scoreBox, background: SEV_DIM[severity], borderColor: SEV_COLOR[severity] + '55' }}>
        <div style={{ fontSize: 48, fontWeight: 900, color: SEV_COLOR[severity], fontFamily: 'monospace', lineHeight: 1 }}>{score.toFixed(1)}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: SEV_COLOR[severity], textTransform: 'uppercase', letterSpacing: '.1em', marginTop: 4 }}>{severity}</div>
        <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace', marginTop: 8, wordBreak: 'break-all', textAlign: 'center' }}>{vector}</div>
      </div>

      {/* Metrics */}
      <div style={s.metrics}>
        {Object.entries(METRICS).map(([key, metric]) => (
          <div key={key} style={s.metricRow}>
            <div style={s.metricLabel}>{metric.label}</div>
            <div style={s.metricOptions}>
              {Object.entries(metric.options).map(([optKey, [optLabel]]) => (
                <button key={optKey}
                  onClick={() => set(key, optKey)}
                  style={{
                    ...s.optBtn,
                    background: vals[key] === optKey ? 'var(--red)' : 'var(--surface2)',
                    color: vals[key] === optKey ? '#fff' : 'var(--muted)',
                    borderColor: vals[key] === optKey ? 'var(--red)' : 'var(--border)',
                    fontWeight: vals[key] === optKey ? 700 : 400,
                  }}>
                  {optLabel}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Apply button */}
      {onApply && (
        <button style={s.applyBtn} onClick={() => onApply(score, vector, severity)}>
          ✓ Apply Score ({score.toFixed(1)} {severity})
        </button>
      )}
    </div>
  )
}

const s = {
  calc: { display: 'flex', flexDirection: 'column', gap: 16 },
  scoreBox: { border: '2px solid', borderRadius: 12, padding: 20, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  metrics: { display: 'flex', flexDirection: 'column', gap: 10 },
  metricRow: { display: 'flex', alignItems: 'center', gap: 12 },
  metricLabel: { fontSize: 11, color: 'var(--text)', fontWeight: 600, width: 160, flexShrink: 0 },
  metricOptions: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  optBtn: { border: '1px solid', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace', transition: 'all .1s' },
  applyBtn: { background: 'var(--green)', border: 'none', borderRadius: 6, color: '#000', padding: '10px 20px', fontSize: 12, cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700, alignSelf: 'flex-start' },
}
