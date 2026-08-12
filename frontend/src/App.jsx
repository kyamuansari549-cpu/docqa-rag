import { useState, useRef, useEffect } from "react";

const API_BASE = import.meta.env.VITE_API_URL;

const icons = {
  upload: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 16V4M12 4l-4 4M12 4l4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  file: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  trash: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  send: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  book: (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

function Avatar({ role }) {
  return (
    <div className={`avatar avatar-${role}`}>
      {role === "user" ? "You" : "§"}
    </div>
  );
}

function Message({ role, content, sources }) {
  if (role === "user") {
    return (
      <div className="msg msg-user">
        <div className="msg-bubble">{content}</div>
        <Avatar role="user" />
      </div>
    );
  }

  const parts = content.split(/(\[\d+\])/g);

  return (
    <div className="msg msg-assistant">
      <Avatar role="assistant" />
      <div className="msg-col">
        <div className="msg-bubble">
          {parts.map((part, i) => {
            const match = part.match(/^\[(\d+)\]$/);
            if (match) {
              return (
                <sup className="footnote" key={i}>
                  {match[1]}
                </sup>
              );
            }
            return <span key={i}>{part}</span>;
          })}
        </div>
        {sources && sources.length > 0 && (
          <div className="sources">
            <p className="sources-label">Sources</p>
            {sources.map((s) => (
              <div className="source-card" key={s.index}>
                <span className="source-index">{s.index}</span>
                <div className="source-body">
                  <p className="source-name">
                    {s.doc_name}
                    {s.page ? <span className="source-page"> · p.{s.page}</span> : null}
                  </p>
                  <p className="source-excerpt">{s.excerpt}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="msg msg-assistant">
      <Avatar role="assistant" />
      <div className="msg-col">
        <div className="msg-bubble msg-thinking">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [activeDocId, setActiveDocId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    refreshDocuments();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, asking]);

  async function refreshDocuments() {
    try {
      const res = await fetch(`${API_BASE}/documents`);
      const data = await res.json();
      setDocuments(data);
    } catch {
      setError("Can't reach the backend. Is it running on port 8000?");
    }
  }

  async function uploadFile(file) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.detail || "Upload failed");
      }
      await refreshDocuments();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    uploadFile(file);
  }

  async function handleDelete(docId) {
    await fetch(`${API_BASE}/documents/${docId}`, { method: "DELETE" });
    if (activeDocId === docId) setActiveDocId(null);
    await refreshDocuments();
  }

  async function handleAsk(e) {
    e.preventDefault();
    const question = input.trim();
    if (!question || asking) return;

    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setAsking(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, doc_id: activeDocId }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.detail || "Something went wrong");
      }
      const data = await res.json();
      setMessages((m) => [...m, { role: "assistant", content: data.answer, sources: data.sources }]);
    } catch (err) {
      setError(err.message);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "I hit an error answering that — check the backend logs.", sources: [] },
      ]);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">§</span>
          <div>
            <div className="brand-name">DocQA</div>
            <div className="brand-sub">grounded document Q&amp;A</div>
          </div>
        </div>

        <label
          className={`upload-zone ${dragOver ? "upload-zone-drag" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <span className="upload-icon">{icons.upload}</span>
          <span className="upload-text">
            {uploading ? "Indexing…" : "Drop a file or click to upload"}
          </span>
          <span className="upload-hint">PDF, TXT, MD</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md"
            onChange={(e) => uploadFile(e.target.files?.[0])}
            disabled={uploading}
            hidden
          />
        </label>

        <div className="doc-list">
          <button
            className={`doc-item doc-item-all ${activeDocId === null ? "doc-item-active" : ""}`}
            onClick={() => setActiveDocId(null)}
          >
            All documents
            {documents.length > 0 && <span className="doc-count">{documents.length}</span>}
          </button>
          {documents.map((doc) => (
            <div
              key={doc.doc_id}
              className={`doc-item ${activeDocId === doc.doc_id ? "doc-item-active" : ""}`}
            >
              <button className="doc-item-label" onClick={() => setActiveDocId(doc.doc_id)}>
                <span className="doc-file-icon">{icons.file}</span>
                <span className="doc-text">
                  <span className="doc-name">{doc.doc_name}</span>
                  <span className="doc-meta">{doc.chunks} chunks indexed</span>
                </span>
              </button>
              <button className="doc-remove" onClick={() => handleDelete(doc.doc_id)} title="Remove document">
                {icons.trash}
              </button>
            </div>
          ))}
          {documents.length === 0 && (
            <p className="empty-hint">Nothing uploaded yet — add a document above to start asking questions.</p>
          )}
        </div>
      </aside>

      <main className="chat">
        {error && <div className="error-banner">{error}</div>}

        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="chat-empty">
              <div className="chat-empty-icon">{icons.book}</div>
              <p className="chat-empty-title">Ask anything about your documents</p>
              <p className="chat-empty-sub">
                Answers are grounded in what you upload, with citations back to the exact page they came from.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <Message key={i} role={m.role} content={m.content} sources={m.sources} />
          ))}
          {asking && <ThinkingBubble />}
        </div>

        <form className="composer" onSubmit={handleAsk}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={documents.length ? "Ask a question…" : "Upload a document first"}
            disabled={documents.length === 0}
          />
          <button type="submit" disabled={!input.trim() || asking} aria-label="Send question">
            {icons.send}
          </button>
        </form>
      </main>
    </div>
  );
}
