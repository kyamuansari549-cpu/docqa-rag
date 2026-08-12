import { useState, useRef, useEffect } from "react";

const API_BASE = "http://localhost:8000";

/* ---------- Icons (inline, no deps) ---------- */

const Icon = {
  upload: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
      <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </svg>
  ),
  doc: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v5h5" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  stack: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 13 9 5 9-5M3 18l9 5 9-5" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 13 4 4L19 7" />
    </svg>
  ),
};

function fileKind(name = "") {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "PDF";
  if (ext === "md") return "MD";
  return "TXT";
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text.replace(/\[\d+\]/g, "").trim());
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard unavailable, ignore */
        }
      }}
      title="Copy answer"
    >
      {copied ? Icon.check : Icon.copy}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function Message({ role, content, sources, msgId }) {
  if (role === "user") {
    return (
      <div className="msg msg-user">
        <div className="msg-bubble msg-bubble-user">{content}</div>
      </div>
    );
  }

  const parts = content.split(/(\[\d+\])/g);

  const scrollToSource = (n) => {
    const el = document.getElementById(`src-${msgId}-${n}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("source-card-pulse");
    setTimeout(() => el.classList.remove("source-card-pulse"), 900);
  };

  return (
    <div className="msg msg-assistant">
      <div className="msg-row">
        <div className="avatar avatar-assistant">§</div>
        <div className="msg-col">
          <div className="msg-bubble msg-bubble-assistant">
            {parts.map((part, i) => {
              const match = part.match(/^\[(\d+)\]$/);
              if (match) {
                return (
                  <button
                    key={i}
                    className="footnote"
                    onClick={() => scrollToSource(match[1])}
                    title={`Jump to source ${match[1]}`}
                  >
                    {match[1]}
                  </button>
                );
              }
              return <span key={i}>{part}</span>;
            })}
          </div>
          <CopyButton text={content} />

          {sources && sources.length > 0 && (
            <div className="sources">
              <p className="sources-label">
                {Icon.stack}
                <span>Sources</span>
              </p>
              <div className="source-grid">
                {sources.map((s, idx) => (
                  <div
                    id={`src-${msgId}-${s.index}`}
                    className="source-card"
                    key={s.index}
                    style={{ "--tilt": idx % 2 === 0 ? "-0.6deg" : "0.6deg" }}
                  >
                    <div className="source-card-top">
                      <span className="source-index">{s.index}</span>
                      <p className="source-name">
                        {s.doc_name}
                        {s.page ? <span className="source-page">p.{s.page}</span> : null}
                      </p>
                    </div>
                    <p className="source-excerpt">{s.excerpt}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
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
  const textareaRef = useRef(null);

  useEffect(() => {
    refreshDocuments();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, asking]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

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

  function handleComposerKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk(e);
    }
  }

  const activeDoc = documents.find((d) => d.doc_id === activeDocId);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 28 28" width="22" height="22">
              <rect x="4" y="15" width="16" height="7" rx="1.5" transform="rotate(-18 4 15)" fill="var(--amber)" />
              <rect x="15" y="4" width="6" height="14" rx="1.5" transform="rotate(-18 15 4)" fill="var(--ink-elevated)" stroke="var(--amber)" strokeWidth="1.2" />
            </svg>
          </span>
          <div className="brand-text">
            <span className="brand-name">DocQA</span>
            <span className="brand-tag">grounded document Q&amp;A</span>
          </div>
        </div>

        <label
          className={`upload-btn ${dragOver ? "upload-btn-drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            uploadFile(e.dataTransfer.files?.[0]);
          }}
        >
          <span className="upload-icon">{Icon.upload}</span>
          <span className="upload-copy">
            <strong>{uploading ? "Indexing…" : "Drop a file or click to upload"}</strong>
            <small>PDF, TXT, MD</small>
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md"
            onChange={(e) => uploadFile(e.target.files?.[0])}
            disabled={uploading}
            hidden
          />
        </label>

        <div className="doc-section-label">
          <span>All documents</span>
          <span className="doc-count">{documents.length}</span>
        </div>

        <div className="doc-list">
          <button
            className={`doc-item doc-item-all ${activeDocId === null ? "doc-item-active" : ""}`}
            onClick={() => setActiveDocId(null)}
          >
            <span className="doc-item-icon">{Icon.stack}</span>
            <span className="doc-name">All documents</span>
          </button>

          {documents.map((doc) => (
            <div key={doc.doc_id} className={`doc-item ${activeDocId === doc.doc_id ? "doc-item-active" : ""}`}>
              <button className="doc-item-label" onClick={() => setActiveDocId(doc.doc_id)}>
                <span className="doc-kind">{fileKind(doc.doc_name)}</span>
                <span className="doc-item-text">
                  <span className="doc-name">{doc.doc_name}</span>
                  <span className="doc-meta">{doc.chunks} chunks indexed</span>
                </span>
              </button>
              <button className="doc-remove" onClick={() => handleDelete(doc.doc_id)} title="Remove">
                {Icon.trash}
              </button>
            </div>
          ))}

          {documents.length === 0 && (
            <p className="empty-hint">No documents yet. Upload a PDF or text file to begin.</p>
          )}
        </div>
      </aside>

      <main className="chat">
        <header className="chat-header">
          <div className="chat-header-title">
            {activeDoc ? (
              <>
                <span className="chat-header-kind">{fileKind(activeDoc.doc_name)}</span>
                <span>{activeDoc.doc_name}</span>
              </>
            ) : (
              <span>All documents</span>
            )}
          </div>
          <span className="chat-header-sub">
            {documents.length} {documents.length === 1 ? "document" : "documents"} indexed
          </span>
        </header>

        {error && <div className="error-banner">{error}</div>}

        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="chat-empty">
              <p className="chat-empty-eyebrow">grounded &amp; cited</p>
              <p className="chat-empty-title">Ask the page.</p>
              <p className="chat-empty-sub">
                Answers are grounded in your uploads, with citations back to the exact page.
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <Message key={i} msgId={i} role={m.role} content={m.content} sources={m.sources} />
          ))}

          {asking && (
            <div className="msg msg-assistant">
              <div className="msg-row">
                <div className="avatar avatar-assistant">§</div>
                <div className="msg-bubble msg-bubble-assistant msg-thinking">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </div>
              </div>
            </div>
          )}
        </div>

        <form className="composer" onSubmit={handleAsk}>
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={documents.length ? "Ask a question…" : "Upload a document first"}
            disabled={documents.length === 0}
          />
          <button type="submit" className="send-btn" disabled={!input.trim() || asking} title="Ask">
            {Icon.send}
          </button>
        </form>
      </main>
    </div>
  );
}
