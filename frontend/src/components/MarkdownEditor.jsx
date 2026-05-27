import { useState } from 'react'
import ReactMarkdown from 'react-markdown'

export default function MarkdownEditor({ value, onChange, placeholder, minHeight = 120 }) {
  const [mode, setMode] = useState('edit') // edit | preview | split

  return (
    <div style={s.container}>
      {/* Toolbar */}
      <div style={s.toolbar}>
        <div style={s.toolbarLeft}>
          {/* Format buttons */}
          {[
            ['B', '**text**', 'Bold'],
            ['I', '_text_', 'Italic'],
            ['`', '`code`', 'Inline code'],
            ['```', '```\ncode\n```', 'Code block'],
            ['#', '## Heading', 'Heading'],
            ['—', '---', 'Divider'],
            ['•', '- item', 'List item'],
            ['1.', '1. item', 'Numbered list'],
          ].map(([label, insert, title]) => (
            <button key={label} title={title} style={s.fmtBtn}
              onClick={() => {
                const textarea = document.activeElement
                if (textarea && textarea.tagName === 'TEXTAREA') {
                  const start = textarea.selectionStart
                  const end = textarea.selectionEnd
                  const selected = value.slice(start, end)
                  let newText
                  if (selected && label === 'B') newText = `**${selected}**`
                  else if (selected && label === 'I') newText = `_${selected}_`
                  else if (selected && label === '`') newText = `\`${selected}\``
                  else newText = insert.replace('text', selected || 'text')
                  const newVal = value.slice(0, start) + newText + value.slice(end)
                  onChange(newVal)
                } else {
                  onChange((value || '') + '\n' + insert)
                }
              }}>
              {label}
            </button>
          ))}
        </div>
        <div style={s.toolbarRight}>
          {['edit', 'split', 'preview'].map(m => (
            <button key={m} onClick={() => setMode(m)}
              style={{ ...s.modeBtn, background: mode === m ? 'var(--red-dim)' : 'transparent', color: mode === m ? 'var(--red)' : 'var(--muted)' }}>
              {m === 'edit' ? '✎ Edit' : m === 'split' ? '⊞ Split' : '👁 Preview'}
            </button>
          ))}
        </div>
      </div>

      {/* Editor area */}
      <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border2)', borderTop: 'none', borderRadius: '0 0 6px 6px', overflow: 'hidden' }}>
        {(mode === 'edit' || mode === 'split') && (
          <textarea
            style={{ ...s.textarea, minHeight, flex: mode === 'split' ? '0 0 50%' : 1, borderRight: mode === 'split' ? '1px solid var(--border)' : 'none' }}
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder || 'Write in markdown...'}
          />
        )}
        {(mode === 'preview' || mode === 'split') && (
          <div style={{ ...s.preview, minHeight, flex: mode === 'split' ? '0 0 50%' : 1 }}>
            {value ? (
              <ReactMarkdown
                components={{
                  code: ({ node, inline, children, ...props }) => (
                    inline
                      ? <code style={{ background: 'var(--surface3)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace', fontSize: '0.9em' }}>{children}</code>
                      : <pre style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 12, overflow: 'auto', marginBottom: 12 }}>
                          <code style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--green)' }}>{children}</code>
                        </pre>
                  ),
                  h1: ({ children }) => <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>{children}</h1>,
                  h2: ({ children }) => <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6, marginTop: 16 }}>{children}</h2>,
                  h3: ({ children }) => <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4, marginTop: 12 }}>{children}</h3>,
                  p: ({ children }) => <p style={{ marginBottom: 10, lineHeight: 1.7, color: 'var(--text)' }}>{children}</p>,
                  ul: ({ children }) => <ul style={{ paddingLeft: 20, marginBottom: 10 }}>{children}</ul>,
                  ol: ({ children }) => <ol style={{ paddingLeft: 20, marginBottom: 10 }}>{children}</ol>,
                  li: ({ children }) => <li style={{ marginBottom: 4, lineHeight: 1.6, color: 'var(--text)' }}>{children}</li>,
                  strong: ({ children }) => <strong style={{ color: 'var(--text)', fontWeight: 700 }}>{children}</strong>,
                  hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '12px 0' }} />,
                  blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid var(--red)', paddingLeft: 12, color: 'var(--muted)', marginBottom: 10 }}>{children}</blockquote>,
                  table: ({ children }) => <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: 12 }}>{children}</table>,
                  th: ({ children }) => <th style={{ padding: '6px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', textAlign: 'left', fontWeight: 700 }}>{children}</th>,
                  td: ({ children }) => <td style={{ padding: '6px 10px', border: '1px solid var(--border)' }}>{children}</td>,
                }}>
                {value}
              </ReactMarkdown>
            ) : (
              <div style={{ color: 'var(--muted2)', fontSize: 12, fontStyle: 'italic' }}>Nothing to preview</div>
            )}
          </div>
        )}
      </div>

      <div style={{ fontSize: 9, color: 'var(--muted2)', marginTop: 4 }}>
        Supports **bold**, _italic_, `code`, ```code blocks```, ## headings, - lists, | tables |
      </div>
    </div>
  )
}

const s = {
  container: { display: 'flex', flexDirection: 'column' },
  toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: '6px 6px 0 0', padding: '4px 8px', flexWrap: 'wrap', gap: 4 },
  toolbarLeft: { display: 'flex', gap: 2, flexWrap: 'wrap' },
  toolbarRight: { display: 'flex', gap: 2 },
  fmtBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--muted)', padding: '2px 7px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700 },
  modeBtn: { border: '1px solid transparent', borderRadius: 4, padding: '2px 8px', fontSize: 10, cursor: 'pointer', fontFamily: 'monospace' },
  textarea: { background: 'var(--surface2)', border: 'none', color: 'var(--text)', padding: 12, fontSize: 12, fontFamily: 'monospace', outline: 'none', resize: 'vertical', lineHeight: 1.6 },
  preview: { background: 'var(--surface)', padding: 12, fontSize: 12, overflowY: 'auto' },
}
