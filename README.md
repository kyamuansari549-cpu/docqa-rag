# DocQA — RAG-based Document Q&A System

Upload PDFs or text files, ask questions in plain English, and get answers
grounded in the documents themselves — with citations back to the exact
page they came from.

## How it works (architecture)

```
 Upload            Ingest             Embed              Store
┌──────┐   file    ┌─────────┐  text  ┌──────────┐ vector ┌─────────┐
│  PDF │ ────────► │ pypdf    │──────► │ MiniLM   │──────► │ Chroma  │
│ /txt │           │ + chunk  │        │ embedder │        │ (local) │
└──────┘           └─────────┘        └──────────┘        └─────────┘

 Ask                Retrieve             Generate
┌──────────┐  query ┌───────────┐  top-k ┌────────────────┐
│ Question │ ─────► │ Chroma    │──────► │ Claude API     │──► Answer
└──────────┘        │ similarity│  chunks│ (grounded      │    + citations
                     │ search    │        │  prompt)       │
                     └───────────┘        └────────────────┘
```

**Retrieval** and **generation** are deliberately kept in separate files
(`vectorstore.py` vs `llm.py`) so it's obvious which part of the pipeline
does what — a common thing to be asked to explain in an interview.

No LangChain — the ingestion, chunking, retrieval, and prompt-building are
all plain Python so you can walk through every step of your own pipeline
without "the framework did it."

## Project structure

```
rag-doc-qa/
├── backend/
│   ├── main.py          FastAPI app (routes)
│   ├── ingest.py        PDF/text parsing + chunking
│   ├── vectorstore.py   Chroma wrapper (embed + store + search)
│   ├── llm.py           Grounded-answer prompt + Claude API call
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── App.jsx       Chat UI, upload, citations
    │   └── App.css
    └── package.json
```

## Setup

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# edit .env and add your ANTHROPIC_API_KEY (from console.anthropic.com)

uvicorn main:app --reload --port 8000
```

First run will download the local embedding model (~90MB) — needs
internet once, then works offline for indexing.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 — the frontend expects the backend on
http://localhost:8000 (already configured in `App.jsx`).

## Using it

1. Upload a PDF or `.txt` file from the sidebar.
2. Ask a question in the chat box.
3. The answer includes numbered citations `[1] [2]` — expand the source
   cards below the answer to see exactly which page and excerpt backed
   each claim.
4. Click a document in the sidebar to scope questions to just that file,
   or stay on "All documents" to search across everything you've uploaded.

## Ideas for extending it (good for standing out further)

- **Hybrid search**: combine keyword (BM25) with semantic search for
  queries with exact terms like product codes or names.
- **Multi-format support**: add `.docx` or OCR for scanned PDFs.
- **Comparison mode**: "answer using only doc A vs doc B" side by side.
- **Confidence indicator**: surface the similarity score to flag weak
  retrievals before they reach the LLM.

## Talking points for interviews

- Why chunking with overlap matters (avoids losing context at chunk
  boundaries) — see `ingest.py::chunk_page`.
- Why retrieval and generation are separate concerns, and what changes if
  you swap the vector DB or the LLM provider — the split between
  `vectorstore.py` and `llm.py` is designed to make this obvious.
- Trade-offs of a local embedding model (free, private, slower to start)
  vs. an API-based one (costs money, needs network, no cold-start delay).
- What "grounded" means in the system prompt (`llm.py::SYSTEM_PROMPT`) and
  why citations are enforced there rather than post-processed.
