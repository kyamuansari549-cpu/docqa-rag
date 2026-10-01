"""
Thin wrapper around a persistent Chroma collection. Embeddings come from
the Gemini embedding API (free tier), so this service has no heavy local
ML dependencies -- answering questions calls out to Groq.
"""

import os
import uuid
import httpx
import chromadb
from chromadb.api.types import Documents, Embeddings, EmbeddingFunction
from ingest import Chunk

CHROMA_DIR = os.getenv("CHROMA_DIR", "./chroma_data")
EMBED_MODEL = os.getenv("GEMINI_EMBED_MODEL", "models/text-embedding-004")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")  # free key: https://aistudio.google.com/apikey
_EMBED_BATCH_SIZE = 50


class GeminiEmbedder(EmbeddingFunction[Documents]):
    """Document/query embeddings via the Gemini API (generous free tier).

    The backend previously embedded locally with sentence-transformers +
    torch, but that stack idles at ~700MB+ RAM and gets OOM-killed on free
    hosts (Render's free tier is 512MB; Hugging Face now puts Docker Spaces
    behind PRO). The API embedder keeps this service around ~250MB with
    zero local ML dependencies, so it runs fine on a free host.
    """

    def __init__(self, api_key: str | None = GOOGLE_API_KEY, model: str = EMBED_MODEL):
        if not api_key:
            raise RuntimeError(
                "GOOGLE_API_KEY is not set. Get a free key at "
                "https://aistudio.google.com/apikey and set it as an env var."
            )
        self._api_key = api_key
        self._model = model

    def embed_texts(self, texts: list[str], task_type: str = "RETRIEVAL_DOCUMENT") -> Embeddings:
        if not texts:
            return []
        model_name = self._model.removeprefix("models/")
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_name}:batchEmbedContents?key={self._api_key}"
        )
        out: Embeddings = []
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

    def __call__(self, input: Documents) -> Embeddings:
        # Used by Chroma when indexing documents.
        return self.embed_texts(list(input), task_type="RETRIEVAL_DOCUMENT")


_client = chromadb.PersistentClient(path=CHROMA_DIR)
_embedder = GeminiEmbedder()
_collection = _client.get_or_create_collection(
    name="documents",
    embedding_function=_embedder,
    metadata={"hnsw:space": "cosine"},
)


def add_chunks(chunks: list[Chunk]) -> None:
    if not chunks:
        return
    ids = [f"{c.doc_id}-{c.chunk_index}-{uuid.uuid4().hex[:6]}" for c in chunks]
    documents = [c.text for c in chunks]
    metadatas = [
        {"doc_id": c.doc_id, "doc_name": c.doc_name, "page": c.page or 0, "chunk_index": c.chunk_index}
        for c in chunks
    ]
    _collection.add(ids=ids, documents=documents, metadatas=metadatas)


def query(question: str, top_k: int = 5, doc_id: str | None = None) -> list[dict]:
    where = {"doc_id": doc_id} if doc_id else None
    # Queries are embedded with RETRIEVAL_QUERY (documents were indexed
    # with RETRIEVAL_DOCUMENT) -- the task-optimized pair retrieves better.
    query_embedding = _embedder.embed_texts([question], task_type="RETRIEVAL_QUERY")[0]
    result = _collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
        where=where,
    )
    hits = []
    docs = result.get("documents", [[]])[0]
    metas = result.get("metadatas", [[]])[0]
    dists = result.get("distances", [[]])[0]
    for text, meta, dist in zip(docs, metas, dists):
        hits.append(
            {
                "text": text,
                "doc_id": meta.get("doc_id"),
                "doc_name": meta.get("doc_name"),
                "page": meta.get("page"),
                "similarity": round(1 - dist, 4),
            }
        )
    return hits


def list_documents() -> list[dict]:
    all_items = _collection.get(include=["metadatas"])
    seen = {}
    for meta in all_items.get("metadatas", []):
        doc_id = meta.get("doc_id")
        if doc_id not in seen:
            seen[doc_id] = {"doc_id": doc_id, "doc_name": meta.get("doc_name"), "chunks": 0}
        seen[doc_id]["chunks"] += 1
    return list(seen.values())


def delete_document(doc_id: str) -> None:
    _collection.delete(where={"doc_id": doc_id})
