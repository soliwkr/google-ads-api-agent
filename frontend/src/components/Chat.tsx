'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Message {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: number
  streaming?: boolean
}

function formatMessage(text: string) {
  // Basic markdown-like rendering
  const lines = text.split('\n')
  return lines.map((line, i) => {
    if (line.startsWith('### ')) return <h3 key={i} className="text-base font-bold mt-3 mb-1 text-blue-300">{line.slice(4)}</h3>
    if (line.startsWith('## ')) return <h2 key={i} className="text-lg font-bold mt-3 mb-1 text-blue-200">{line.slice(3)}</h2>
    if (line.startsWith('# ')) return <h1 key={i} className="text-xl font-bold mt-3 mb-1 text-blue-100">{line.slice(2)}</h1>
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return <li key={i} className="ml-4 list-disc text-gray-200">{renderInline(line.slice(2))}</li>
    }
    if (/^\d+\. /.test(line)) {
      return <li key={i} className="ml-4 list-decimal text-gray-200">{renderInline(line.replace(/^\d+\. /, ''))}</li>
    }
    if (line.trim() === '') return <br key={i} />
    return <p key={i} className="text-gray-200 leading-relaxed">{renderInline(line)}</p>
  })
}

function renderInline(text: string): React.ReactNode {
  // Bold
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-bold text-white">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="bg-black/30 text-green-300 px-1 py-0.5 rounded text-sm font-mono">{part.slice(1, -1)}</code>
    }
    return part
  })
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Load session from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('ads_agent_session_id')
    if (saved) setSessionId(saved)
  }, [])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const newChat = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    setMessages([])
    setSessionId(null)
    setIsLoading(false)
    localStorage.removeItem('ads_agent_session_id')
  }, [])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || isLoading) return

    setInput('')
    setIsLoading(true)

    const userMsg: Message = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])

    // Add empty assistant message for streaming
    const assistantIdx = messages.length + 1
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`${API_URL}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session_id: sessionId }),
        signal: controller.signal,
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let accum = ''
      let currentSession = sessionId

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('event: session')) continue
          if (line.startsWith('event: done')) {
            setMessages(prev => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last?.role === 'assistant') {
                updated[updated.length - 1] = { ...last, streaming: false }
              }
              return updated
            })
            continue
          }
          if (line.startsWith('event: error')) continue
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            // Check if this is the session_id event
            if (data.match(/^[0-9a-f-]{36}$/)) {
              currentSession = data
              setSessionId(data)
              localStorage.setItem('ads_agent_session_id', data)
              continue
            }
            accum += data
            setMessages(prev => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last?.role === 'assistant') {
                updated[updated.length - 1] = { ...last, content: accum }
              }
              return updated
            })
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: last.content || '(cancelled)', streaming: false }
          }
          return updated
        })
        return
      }

      // Fallback to non-streaming
      try {
        const res2 = await fetch(`${API_URL}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, session_id: sessionId }),
        })
        const data = await res2.json()
        if (data.session_id) {
          setSessionId(data.session_id)
          localStorage.setItem('ads_agent_session_id', data.session_id)
        }
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = {
              ...last,
              content: data.response || 'No response received.',
              toolCalls: data.tool_calls_made,
              streaming: false,
            }
          }
          return updated
        })
      } catch {
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = {
              ...last,
              content: 'Error: Could not connect to the API. Please check that the backend is running.',
              streaming: false,
            }
          }
          return updated
        })
      }
    } finally {
      setIsLoading(false)
      abortRef.current = null
      textareaRef.current?.focus()
    }
  }, [input, isLoading, sessionId, messages.length])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'
  }

  return (
    <div className="flex flex-col h-screen bg-[#1a1a2e]">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#16213e] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-sm font-bold">G</div>
          <div>
            <h1 className="text-sm font-semibold text-white">Google Ads AI Agent</h1>
            <p className="text-xs text-gray-400">Powered by Claude</p>
          </div>
        </div>
        <button
          onClick={newChat}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </button>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 pb-20">
            <div className="w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white mb-1">Google Ads AI Agent</h2>
              <p className="text-gray-400 text-sm max-w-md">
                Ask me to manage your campaigns, analyze performance, create ads, optimize bids, and more.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full mt-2">
              {[
                'Show me an account summary',
                'Which campaigns have the highest ROAS?',
                'Pause underperforming ad groups',
                'Create a new search campaign',
              ].map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion); textareaRef.current?.focus() }}
                  className="text-left px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm text-gray-300 hover:text-white transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">G</div>
            )}
            <div className={`max-w-[85%] sm:max-w-[75%] ${msg.role === 'user' ? 'order-1' : ''}`}>
              <div
                className={`rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-tr-sm'
                    : 'bg-[#16213e] border border-white/10 rounded-tl-sm'
                }`}
              >
                {msg.role === 'user' ? (
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <div className="text-sm space-y-0.5 prose-chat">
                    {msg.content ? formatMessage(msg.content) : null}
                    {msg.streaming && (
                      <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
                    )}
                  </div>
                )}
              </div>
              {msg.role === 'assistant' && msg.toolCalls !== undefined && msg.toolCalls > 0 && (
                <p className="text-xs text-gray-500 mt-1 ml-1">{msg.toolCalls} tool call{msg.toolCalls !== 1 ? 's' : ''}</p>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-lg bg-gray-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">U</div>
            )}
          </div>
        ))}

        {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex gap-3 justify-start">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-xs font-bold shrink-0">G</div>
            <div className="bg-[#16213e] border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 px-4 pb-4 pt-2 border-t border-white/10 bg-[#1a1a2e]">
        <div className="max-w-3xl mx-auto relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your Google Ads campaigns…"
            rows={1}
            disabled={isLoading}
            className="w-full resize-none bg-[#16213e] border border-white/10 rounded-2xl px-4 py-3 pr-12 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-50 transition-colors"
            style={{ minHeight: '48px', maxHeight: '200px' }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className="absolute right-2 bottom-2 w-8 h-8 flex items-center justify-center bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:opacity-50 rounded-xl transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        <p className="text-center text-xs text-gray-600 mt-2">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
