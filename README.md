# DocQA — RAG-based Document Q&A System

Upload PDFs or text files, ask questions in plain English, and get answers
grounded in the documents themselves — with citations back to the exact
page they came from.

## How it works (architecture)

```
 Upload            Ingest             Embed              Store
┌──────┐   file    ┌─────────┐  text  ┌──────────┐ vector ┌─────────┐
│  PDF │ ────────► │ pypdf    │──────► │ Gemini   │──────► │ SQLite  │
│ /txt │           │ + chunk  │        │ embed API│        │ + NumPy │
└──────┘           └─────────┘        └──────────┘        └─────────┘

 Ask                Retrieve             Generate
┌──────────┐  query ┌───────────┐  top-k ┌────────────────┐
│ Question │ ─────► │ SQLite    │──────► │ Groq API       │──► Answer
└──────────┘        │ cosine    │  chunks│ (Llama, grounded│    + citations
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
│   ├── vectorstore.py   SQLite + NumPy vector store (embed + search)
│   ├── llm.py           Grounded-answer prompt + Groq API call
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx       Chat UI, upload, citations
│   │   └── App.css
│   └── package.json
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
# and GOOGLE_API_KEY (free at https://aistudio.google.com/apikey, for embeddings)
# and set FRONTEND_URL to your deployed frontend URL when deploying

uvicorn main:app --reload --port 8000
```

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

## Deploying it (frontend on Vercel + backend on Render)

The frontend is a static Vite site (works fine on Vercel). The backend is a
long-running FastAPI server, but it has no heavy or native ML dependencies:
document/query embeddings come from Gemini's free embedding API, answers
from Groq's free LLM API, and the vector store is plain SQLite + NumPy --
so the whole service idles around ~150MB and fits comfortably in Render's
free 512MB tier. (Two things were tried first: local torch embeddings
needed ~700MB+ and got OOM-killed; then ChromaDB, whose native HNSW
extension crashes with "Exited with status 132" on free-tier CPUs.
The SQLite store sidesteps both -- see `vectorstore.py`.)

### 1. Deploy the backend on Render (free)

1. In the [Render dashboard](https://dashboard.render.com): **New > Web
   Service**, select this repo, and set:
   - **Language:** Python, **Root Directory:** `backend`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - Instance type **Free**.
2. Under **Environment**, add:
   - `GROQ_API_KEY` = your key (free at https://console.groq.com/keys)
   - `GOOGLE_API_KEY` = your key (free at https://aistudio.google.com/apikey --
     used for embeddings)
   - `FRONTEND_URL` = your deployed frontend URL
     (e.g. `https://docqa-rag-two.vercel.app`)
3. Deploy, then check `https://<your-service>.onrender.com/health`
   returns `{"status":"ok"}`.

### 2. Point the frontend at the backend

1. In the [Vercel dashboard](https://vercel.com/dashboard): open the project >
   **Settings > Environment Variables**.
2. Add `VITE_API_URL` = `https://<your-service>.onrender.com` (no trailing slash).
3. **Deployments > Redeploy** so the new env var is baked into the build.

### Notes

- Render's free tier sleeps after ~15 min of inactivity -- the first request
  after that takes ~30-60s (cold start). Uploads are also lost on
  restart/redeploy because the disk is ephemeral; for a demo that's fine,
  for persistence attach a Render Disk or move Chroma to a hosted vector DB.

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
- Why the vector store is hand-rolled (SQLite + NumPy brute-force cosine)
  instead of ChromaDB: ChromaDB's native HNSW extension executes illegal
  CPU instructions (SIGILL) on free-tier hosts, killing the process at
  startup -- at this scale (hundreds of chunks) an index buys nothing and
  a ~70-line store is fully transparent. If the corpus grew to millions
  of vectors, that's when you'd reach for a real index.
- Trade-offs of embeddings via API (no local GPU/RAM needed, runs on a free
  host, but needs network and a key) vs. a local embedding model (private,
  works offline, but needs ~700MB+ RAM so it can't run on free tiers) --
  this project moved from local to API embeddings for exactly that reason.
- What "grounded" means in the system prompt (`llm.py::SYSTEM_PROMPT`) and
  why citations are enforced there rather than post-processed.
