import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/bridge';
import { useProjectStore } from '../stores/project.store';
import { useAppStore } from '../stores/app.store';
import { useQueryStore } from '../stores/query.store';
import { ChatBubble } from '../components/query/ChatBubble';
import { SourceList } from '../components/query/SourceList';
import type { ChatSession, ChatMessage } from '../../shared/api.types';

interface SessionSummary {
  id: string;
  title: string;
  created: string;
  updated: string;
  messageCount: number;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function QueryPage() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const addNotification = useAppStore((s) => s.addNotification);
  const consumePendingQuestion = useQueryStore((s) => s.consumePendingQuestion);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const savePending = useRef(false);

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamContent, scrollToBottom]);

  // Sessions laden wenn Projekt wechselt
  useEffect(() => {
    if (!activeProject) return;
    loadSessions();
  }, [activeProject]);

  const loadSessions = async () => {
    if (!activeProject) return;
    try {
      const list = await api.query.listSessions(activeProject);
      setSessions(list);
    } catch {
      // Keine Sessions vorhanden
    }
  };

  const saveCurrentSession = useCallback(async (msgs: ChatMessage[], sessionId: string | null) => {
    if (!activeProject || msgs.length === 0) return;

    const now = new Date().toISOString();
    const firstUserMsg = msgs.find((m) => m.role === 'user');
    const title = firstUserMsg
      ? firstUserMsg.content.slice(0, 80) + (firstUserMsg.content.length > 80 ? '...' : '')
      : 'Neue Unterhaltung';

    const session: ChatSession = {
      id: sessionId || generateId(),
      title,
      created: sessionId
        ? sessions.find((s) => s.id === sessionId)?.created || now
        : now,
      updated: now,
      messages: msgs,
    };

    try {
      await api.query.saveSession(activeProject, session);
      if (!sessionId) {
        setActiveSessionId(session.id);
      }
      await loadSessions();
    } catch (err) {
      console.error('Session speichern fehlgeschlagen:', err);
    }

    return session.id;
  }, [activeProject, sessions]);

  // Auto-Save nach Streaming-Ende
  useEffect(() => {
    if (savePending.current && !streaming && messages.length > 0) {
      savePending.current = false;
      saveCurrentSession(messages, activeSessionId);
    }
  }, [streaming, messages, activeSessionId, saveCurrentSession]);

  // Streaming-Events
  useEffect(() => {
    const unsubChunk = api.on('query:stream-chunk', (data: unknown) => {
      const { chunk } = data as { chunk: string };
      setStreamContent((prev) => prev + chunk);
    });

    const unsubEnd = api.on('query:stream-end', (data: unknown) => {
      const { result } = data as {
        result: {
          answer: string;
          sources_used: string[];
          confidence: string;
        };
      };
      setStreaming(false);
      setStreamContent('');
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.answer,
        confidence: result.confidence,
        sources: result.sources_used,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      savePending.current = true;
    });

    return () => {
      unsubChunk();
      unsubEnd();
    };
  }, []);

  const askQuestion = useCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || !activeProject || streaming) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setStreaming(true);
    setStreamContent('');

    try {
      await api.query.ask(activeProject, trimmed);
    } catch (err) {
      setStreaming(false);
      setStreamContent('');
      addNotification(
        'error',
        `Query fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [activeProject, streaming, addNotification]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const question = input.trim();
    if (!question) return;
    setInput('');
    await askQuestion(question);
  };

  useEffect(() => {
    if (!activeProject) return;
    const pending = consumePendingQuestion();
    if (pending) {
      setActiveSessionId(null);
      setMessages([]);
      askQuestion(pending);
    }
  }, [activeProject, consumePendingQuestion, askQuestion]);

  const startNewSession = () => {
    setActiveSessionId(null);
    setMessages([]);
    setStreamContent('');
    setStreaming(false);
  };

  const openSession = async (sessionId: string) => {
    if (!activeProject) return;
    try {
      const session = await api.query.loadSession(activeProject, sessionId);
      setActiveSessionId(session.id);
      setMessages(session.messages);
      setSessionsOpen(false);
    } catch (err) {
      addNotification('error', `Session laden fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const deleteSession = async (sessionId: string) => {
    if (!activeProject) return;
    try {
      await api.query.deleteSession(activeProject, sessionId);
      if (activeSessionId === sessionId) {
        startNewSession();
      }
      await loadSessions();
    } catch (err) {
      addNotification('error', `Löschen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
        + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  if (!activeProject) {
    return (
      <div>
        <div className="page-header">
          <h1>Query</h1>
          <p>Kein Projekt ausgewählt.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="query-layout">
      {/* Session-Header */}
      <div className="query-session-bar">
        <button
          className="btn btn-ghost query-history-toggle"
          onClick={() => setSessionsOpen(!sessionsOpen)}
          title="Verlauf"
        >
          <span className="query-history-icon">{'\u2630'}</span>
          <span>Verlauf</span>
          {sessions.length > 0 && (
            <span className="badge badge-info query-history-count">{sessions.length}</span>
          )}
        </button>
        <div className="query-session-title">
          {activeSessionId
            ? sessions.find((s) => s.id === activeSessionId)?.title || 'Unterhaltung'
            : messages.length > 0 ? 'Neue Unterhaltung' : ''}
        </div>
        <button
          className="btn btn-ghost"
          onClick={startNewSession}
          disabled={messages.length === 0 && !activeSessionId}
          title="Neue Unterhaltung"
        >
          + Neu
        </button>
      </div>

      {/* Session-Liste (Sidebar-Overlay) */}
      {sessionsOpen && (
        <div className="query-sessions-overlay" onClick={() => setSessionsOpen(false)}>
          <div className="query-sessions-panel" onClick={(e) => e.stopPropagation()}>
            <div className="query-sessions-header">
              <h3>Verlauf</h3>
              <button className="btn btn-ghost" onClick={() => setSessionsOpen(false)}>
                {'\u2715'}
              </button>
            </div>
            {sessions.length === 0 ? (
              <div className="query-sessions-empty">Noch keine Unterhaltungen.</div>
            ) : (
              <div className="query-sessions-list">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`query-session-item ${s.id === activeSessionId ? 'query-session-active' : ''}`}
                  >
                    <div
                      className="query-session-item-content"
                      onClick={() => openSession(s.id)}
                    >
                      <div className="query-session-item-title">{s.title}</div>
                      <div className="query-session-item-meta">
                        {formatDate(s.updated)} · {s.messageCount} Nachrichten
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost query-session-delete"
                      onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                      title="Löschen"
                    >
                      {'\u2715'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Chat-Nachrichten */}
      <div className="query-messages">
        {messages.length === 0 && !streaming && (
          <div className="query-empty">
            <h2>Frag dein Wiki</h2>
            <p>Stelle eine Frage und 2Brain durchsucht dein Wissen.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i}>
            <ChatBubble
              role={msg.role}
              content={msg.content}
              confidence={msg.confidence}
            />
            {msg.sources && <SourceList sources={msg.sources} />}
          </div>
        ))}
        {streaming && (
          <ChatBubble
            role="assistant"
            content={streamContent || 'Denke nach...'}
            streaming
          />
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Eingabe */}
      <form className="query-input-bar" onSubmit={handleSubmit}>
        <input
          type="text"
          className="query-input"
          placeholder="Stelle eine Frage..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={streaming}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!input.trim() || streaming}
        >
          Fragen
        </button>
      </form>
    </div>
  );
}
