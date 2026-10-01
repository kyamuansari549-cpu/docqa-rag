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
│ Question │ ─────► │ Chroma    │──────► │ Groq API       │──► Answer
└──────────┘        │ similarity│  chunks│ (Llama, grounded│    + citations
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
docqa-rag/
├── backend/
│   ├── main.py          FastAPI app (routes)
│   ├── ingest.py        PDF/text parsing + chunking
│   ├── vectorstore.py   Chroma wrapper (embed + store + search)
│   ├── llm.py           Grounded-answer prompt + Groq API call
│   ├── requirements.txt
│   ├── Dockerfile       Backend image for Hugging Face Spaces
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx       Chat UI, upload, citations
│   │   └── App.css
│   └── package.json
└── render.yaml          One-click Render blueprint for the backend
```

## Setup

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# edit .env and add your GROQ_API_KEY (free at https://console.groq.com/keys)
# and set FRONTEND_URL to your deployed frontend URL when deploying

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

Open http://localhost:5173 — the frontend reads the backend URL from the
`VITE_API_URL` env var and falls back to http://localhost:8000 for local dev.

## Using it

1. Upload a PDF or `.txt` file from the sidebar.
2. Ask a question in the chat box.
3. The answer includes numbered citations `[1] [2]` — expand the source
   cards below the answer to see exactly which page and excerpt backed
   each claim.
4. Click a document in the sidebar to scope questions to just that file,
   or stay on "All documents" to search across everything you've uploaded.

## Deploying it (frontend on Vercel + backend on Hugging Face Spaces)

The frontend is a static Vite site (works fine on Vercel), but the backend
is a long-running FastAPI server with a local torch embedding model -- it
needs a host with enough RAM. Render's free tier (512MB) is **not** enough:
torch + transformers + chroma need ~700MB+ and the process gets OOM-killed.
So the backend lives on a Hugging Face Space -- free tier gives 2 vCPU and
16GB RAM, plenty for this stack.

### 1. Deploy the backend on Hugging Face Spaces (free)

1. Create a free account at https://huggingface.co, then **New Space**:
   SDK **Docker**, template **Blank**, name e.g. `docqa-rag-backend`
   (Public visibility is fine -- secrets stay in Settings).
2. Upload the backend files: on the Space page go to **Files > Add file >
   Upload files** and drag in everything from this repo's `backend/`
   folder (`main.py`, `ingest.py`, `vectorstore.py`, `llm.py`,
   `requirements.txt`, `Dockerfile`, `.dockerignore`, `.env.example`)
   so they sit at the Space repo's root. The Space builds automatically
   (takes a few minutes -- torch is a big download).
3. Space page > **Settings > Variables and secrets** > **New secret**, add:
   - `GROQ_API_KEY` = your key (free at https://console.groq.com/keys)
   - `FRONTEND_URL` = your deployed frontend URL
     (e.g. `https://docqa-rag-two.vercel.app`)
4. Wait for the status to turn **Running**, then open
   `https://<username>-docqa-rag-backend.hf.space/health` --
   it should return `{"status":"ok"}`.

### 2. Point the frontend at the backend

1. In the [Vercel dashboard](https://vercel.com/dashboard): open the project >
   **Settings > Environment Variables**.
2. Add `VITE_API_URL` = `https://<your-render-service-url>` (no trailing slash).
3. **Deployments > Redeploy** so the new env var is baked into the build.

### Notes

- The free Space sleeps after ~48h of inactivity -- the first request after
  that takes ~30-60s (cold start + embedding model load). Uploads are also
  lost on restart/redeploy because the disk is ephemeral; for a demo that's
  fine, for persistence attach a [persistent storage](https://huggingface.co/docs/hub/spaces-storage)
  volume or move Chroma to a hosted vector DB.

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
