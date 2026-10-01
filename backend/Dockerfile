# Backend image for Hugging Face Spaces (Docker SDK).
# The Space repo should contain the backend/ files at its root
# (main.py, ingest.py, vectorstore.py, llm.py, requirements.txt, this file).

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .

# CPU-only torch wheel (~200MB instead of the ~550MB CUDA bundle) --
# faster to download and all this app needs. Installed first so pip
# keeps it when resolving sentence-transformers' torch dependency.
RUN pip install --upgrade pip && \
    pip install torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install -r requirements.txt

COPY . .

# HF Spaces routes public traffic to $PORT (7860)
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-7860}"]
