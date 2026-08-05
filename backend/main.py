import os
os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ["OMP_NUM_THREADS"] = "1"
import onnxruntime as ort
session = ort.InferenceSession("model.onnx", providers=["CPUExecutionProvider"])
import uuid
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import ingest
import vectorstore
import llm

app = FastAPI(title="Doc Q&A (RAG)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
    "http://localhost:5173",
    "https://YOUR_PROJECT.vercel.app",
],
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

    vectorstore.add_chunks(chunks)
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

    hits = vectorstore.query(req.question, top_k=req.top_k, doc_id=req.doc_id)
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
