import os
import uuid
from dotenv import load_dotenv

load_dotenv()

import httpx
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import ingest
import vectorstore
import llm

app = FastAPI(title="Doc Q&A (RAG)")

# Comma-separated list of frontend origins allowed to call this API.
# Local dev default; in production set FRONTEND_URL to the deployed
# frontend URL, e.g. FRONTEND_URL=https://docqa-rag-two.vercel.app
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in FRONTEND_URL.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    question: str
    doc_id: str | None = None
    top_k: int = 5


@app.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    file_bytes = await file.read()
    try:
        pages = ingest.load_document(file.filename, file_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    doc_id = uuid.uuid4().hex[:12]
    chunks = ingest.chunk_document(doc_id, file.filename, pages)
    if not chunks:
        raise HTTPException(status_code=400, detail="No extractable text found in this file.")

    try:
        vectorstore.add_chunks(chunks)
    except httpx.HTTPStatusError as e:
        # e.g. bad/expired GOOGLE_API_KEY or a retired embedding model --
        # surface it readably instead of a bare 500.
        raise HTTPException(
            status_code=502,
            detail=f"Embedding service error ({e.response.status_code}): "
            "check GOOGLE_API_KEY and the Gemini embedding model.",
        )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Embedding service unreachable: {e}")
    return {"doc_id": doc_id, "doc_name": file.filename, "chunks_indexed": len(chunks)}


@app.get("/documents")
def get_documents():
    return vectorstore.list_documents()


@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str):
    vectorstore.delete_document(doc_id)
    return {"status": "deleted", "doc_id": doc_id}


@app.post("/chat")
def chat(req: ChatRequest):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    try:
        hits = vectorstore.query(req.question, top_k=req.top_k, doc_id=req.doc_id)
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Embedding service error ({e.response.status_code}): "
            "check GOOGLE_API_KEY and the Gemini embedding model.",
        )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Embedding service unreachable: {e}")

    answer = llm.answer_question(req.question, hits)

    sources = [
        {
            "index": i + 1,
            "doc_name": h["doc_name"],
            "page": h["page"],
            "similarity": h["similarity"],
            "excerpt": h["text"][:280] + ("..." if len(h["text"]) > 280 else ""),
        }
        for i, h in enumerate(hits)
    ]
    return {"answer": answer, "sources": sources}


@app.get("/health")
def health():
    return {"status": "ok"}
