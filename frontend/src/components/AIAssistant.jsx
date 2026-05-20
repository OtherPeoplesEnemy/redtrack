import { useState, useRef, useEffect } from 'react'
import { aiApi } from '../api/client'
import toast from 'react-hot-toast'

const QUICK_PROMPTS = [
  'What are the most critical findings?',
  'Summarize the attack surface',
  'What should be fixed first?',
  'Draft a risk statement for the client',
]

export default function AIAssistant({ engagementId, findingId, isAiRedteam, onClose }) {
  const [messages, setMessages] = useState([{ role: 'assistant', content: isAiRedteam ? "I have your AI Red Team framework loaded — NVIDIA Kill Chain, MITRE ATLAS, and OWASP LLM Top 10. How can I help?" : "I'm your pentest assistant. Ask me anything about this engagement." }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send(text) {
    const msgText = text || input.trim()
    if (!msgText || loading) return
    setInput('')
    const updated = [...messages, { role: 'user', content: msgText }]
    setMessages(updated)
    setLoading(true)
    try {
      const { data } = await aiApi.chat(updated.map(m => ({ role: m.role, content: m.content })), engagementId, findingId, isAiRedteam)
      setMessages([...updated, { role: 'assistant', content: data.content }])
    } catch { toast.error('AI request failed — check your API key in .env'); setMessages(updated) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface)', borderLeft: '1px solid var(--border)' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)' }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>AI Assistant</span>
        </div>
        <button style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20 }} onClick={onClose}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            {msg.role === 'assistant' && <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#fff', flexShrink: 0 }}>AI</div>}
            <div style={{ background: msg.role === 'user' ? 'var(--red)' : 'var(--surface2)', border: msg.role === 'user' ? 'none' : '1px solid var(--border)', borderRadius: msg.role === 'user' ? '12px 4px 12px 12px' : '4px 12px 12px 12px', padding: '10px 14px', fontSize: 12, color: msg.role === 'user' ? '#fff' : 'var(--text)', lineHeight: 1.6, maxWidth: '85%', whiteSpace: 'pre-wrap' }}>{msg.content}</div>
          </div>
        ))}
        {loading && <div style={{ display: 'flex', gap: 8 }}><div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff' }}>AI</div><div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '4px 12px 12px 12px', padding: '10px 14px', color: 'var(--muted)', fontSize: 12 }}>●●●</div></div>}
        <div ref={bottomRef} />
      </div>
      {messages.length === 1 && <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>{QUICK_PROMPTS.map(p => <button key={p} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--muted)', padding: '6px 10px', fontSize: 11, cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace' }} onClick={() => send(p)}>{p}</button>)}</div>}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <input style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text)', padding: '8px 12px', fontSize: 12, fontFamily: 'monospace', outline: 'none' }} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()} placeholder="Ask anything..." disabled={loading} />
        <button style={{ background: 'var(--red)', border: 'none', borderRadius: 6, color: '#fff', width: 36, height: 36, cursor: 'pointer', fontSize: 16, flexShrink: 0 }} onClick={() => send()} disabled={loading || !input.trim()}>↑</button>
      </div>
    </div>
  )
}
