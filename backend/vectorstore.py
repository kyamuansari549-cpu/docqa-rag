"""
Thin wrapper around a persistent Chroma collection. Embeddings are
generated with a local sentence-transformers model, so no API key or
network call is needed just to index documents -- only answering
questions calls out to Claude.
"""

import os
import uuid
import chromadb
from chromadb.utils import embedding_functions
from ingest import Chunk

CHROMA_DIR = os.getenv("CHROMA_DIR", "./chroma_data")
EMBED_MODEL = "all-MiniLM-L6-v2"

_client = chromadb.PersistentClient(path=CHROMA_DIR)
_embedder = embedding_functions.SentenceTransformerEmbeddingFunction(model_name=EMBED_MODEL)
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
    result = _collection.query(
        query_texts=[question],
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
