"""
Vector store: SQLite for persistence, NumPy for brute-force cosine search.

Why not ChromaDB? ChromaDB ships native extensions (chroma-hnswlib's C++
index, onnxruntime, tokenizers) that execute illegal CPU instructions
(SIGILL, "Exited with status 132") on free-tier hosts like Render's --
the process dies ~25s after startup, before serving anything. A
brute-force cosine search over a few hundred 768-dim vectors takes
milliseconds, so for this app's scale an index is unnecessary complexity.
Embeddings come from the Gemini embedding API (free tier), so this
service has no heavy local ML dependencies -- answering questions calls
out to Groq.
"""

import os
import sqlite3
import uuid

import httpx
import numpy as np

from ingest import Chunk

DB_PATH = os.getenv("DB_PATH", "./docqa.db")
EMBED_MODEL = os.getenv("GEMINI_EMBED_MODEL", "models/text-embedding-004")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")  # free key: https://aistudio.google.com/apikey
_EMBED_BATCH_SIZE = 50


class GeminiEmbedder:
    """Document/query embeddings via the Gemini API (generous free tier)."""

    def __init__(self, api_key: str | None = GOOGLE_API_KEY, model: str = EMBED_MODEL):
        if not api_key:
            raise RuntimeError(
                "GOOGLE_API_KEY is not set. Get a free key at "
                "https://aistudio.google.com/apikey and set it as an env var."
            )
        self._api_key = api_key
        self._model = model

    def embed_texts(self, texts: list[str], task_type: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
        if not texts:
            return []
        model_name = self._model.removeprefix("models/")
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_name}:batchEmbedContents?key={self._api_key}"
        )
        out: list[list[float]] = []
        with httpx.Client(timeout=60.0) as client:
            for i in range(0, len(texts), _EMBED_BATCH_SIZE):
                batch = texts[i : i + _EMBED_BATCH_SIZE]
                resp = client.post(
                    url,
                    json={
                        "requests": [
                            {
                                "model": self._model,
                                "content": {"parts": [{"text": t}]},
                                "taskType": task_type,
                            }
                            for t in batch
                        ]
                    },
                )
                resp.raise_for_status()
                for emb in resp.json().get("embeddings", []):
                    out.append(emb["values"])
        if len(out) != len(texts):
            raise RuntimeError(f"Gemini returned {len(out)} embeddings for {len(texts)} texts")
        return out


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS chunks (
               id TEXT PRIMARY KEY,
               doc_id TEXT NOT NULL,
               doc_name TEXT NOT NULL,
               page INTEGER NOT NULL,
               chunk_index INTEGER NOT NULL,
               text TEXT NOT NULL,
               embedding BLOB NOT NULL
           )"""
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id)")
    conn.commit()
    return conn


_embedder = GeminiEmbedder()
# Ensure the table exists at startup.
_connect().close()


def _to_blob(vec: list[float]) -> bytes:
    return np.asarray(vec, dtype=np.float32).tobytes()


def _from_blob(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)


def add_chunks(chunks: list[Chunk]) -> None:
    if not chunks:
        return
    vectors = _embedder.embed_texts([c.text for c in chunks], task_type="RETRIEVAL_DOCUMENT")
    rows = [
        (
            f"{c.doc_id}-{c.chunk_index}-{uuid.uuid4().hex[:6]}",
            c.doc_id,
            c.doc_name,
            c.page or 0,
            c.chunk_index,
            c.text,
            _to_blob(v),
        )
        for c, v in zip(chunks, vectors)
    ]
    conn = _connect()
    try:
        conn.executemany(
            "INSERT INTO chunks (id, doc_id, doc_name, page, chunk_index, text, embedding)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        conn.commit()
    finally:
        conn.close()


def query(question: str, top_k: int = 5, doc_id: str | None = None) -> list[dict]:
    # Queries are embedded with RETRIEVAL_QUERY (documents were indexed
    # with RETRIEVAL_DOCUMENT) -- the task-optimized pair retrieves better.
    q = np.asarray(
        _embedder.embed_texts([question], task_type="RETRIEVAL_QUERY")[0], dtype=np.float32
    )
    q_norm = np.linalg.norm(q)
    if q_norm == 0:
        return []
    q = q / q_norm

    conn = _connect()
    try:
        if doc_id:
            cur = conn.execute(
                "SELECT text, doc_id, doc_name, page, embedding FROM chunks WHERE doc_id = ?",
                (doc_id,),
            )
        else:
            cur = conn.execute("SELECT text, doc_id, doc_name, page, embedding FROM chunks")
        rows = cur.fetchall()
    finally:
        conn.close()

    if not rows:
        return []

    texts, doc_ids, doc_names, pages, blobs = zip(*rows)
    mat = np.stack([_from_blob(b) for b in blobs])  # (n, dim)
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    sims = (mat / norms) @ q  # cosine similarity

    k = min(top_k, len(rows))
    top_idx = np.argpartition(sims, -k)[-k:]
    top_idx = top_idx[np.argsort(sims[top_idx])][::-1]

    return [
        {
            "text": texts[i],
            "doc_id": doc_ids[i],
            "doc_name": doc_names[i],
            "page": pages[i],
            "similarity": round(float(sims[i]), 4),
        }
        for i in top_idx
    ]


def list_documents() -> list[dict]:
    conn = _connect()
    try:
        cur = conn.execute(
            "SELECT doc_id, doc_name, COUNT(*) FROM chunks GROUP BY doc_id, doc_name"
        )
        rows = cur.fetchall()
    finally:
        conn.close()
    return [{"doc_id": d, "doc_name": n, "chunks": c} for d, n, c in rows]


def delete_document(doc_id: str) -> None:
    conn = _connect()
    try:
        conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
        conn.commit()
    finally:
        conn.close()
