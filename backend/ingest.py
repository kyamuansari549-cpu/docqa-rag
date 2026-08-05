"""
Handles turning raw uploaded files into clean text, then splitting that
text into overlapping chunks small enough to embed and retrieve well.

Kept dependency-free (no LangChain) on purpose -- this is the part of a
RAG system interviewers most often ask you to explain, so it's worth
being able to walk through every line yourself.
"""

from __future__ import annotations
import io
import re
from dataclasses import dataclass
from pypdf import PdfReader


@dataclass
class Chunk:
    text: str
    doc_id: str
    doc_name: str
    page: int | None
    chunk_index: int


def extract_text_from_pdf(file_bytes: bytes) -> list[tuple[int, str]]:
    """Returns a list of (page_number, page_text) tuples, 1-indexed."""
    reader = PdfReader(io.BytesIO(file_bytes))
    pages = []
    for i, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        pages.append((i, text))
    return pages


def extract_text_from_txt(file_bytes: bytes) -> list[tuple[int, str]]:
    text = file_bytes.decode("utf-8", errors="ignore")
    return [(1, text)]


def load_document(filename: str, file_bytes: bytes) -> list[tuple[int, str]]:
    """Dispatches to the right extractor based on file extension."""
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return extract_text_from_pdf(file_bytes)
    if lower.endswith(".txt") or lower.endswith(".md"):
        return extract_text_from_txt(file_bytes)
    raise ValueError(f"Unsupported file type: {filename}")


def _split_into_sentences(text: str) -> list[str]:
    # Simple sentence splitter -- good enough for chunking purposes and
    # avoids pulling in a full NLP library for one regex's worth of work.
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    return re.split(r"(?<=[.!?])\s+", text)


def chunk_page(
    page_text: str,
    doc_id: str,
    doc_name: str,
    page_number: int,
    chunk_index_start: int,
    max_chars: int = 1200,
    overlap_sentences: int = 2,
) -> list[Chunk]:
    """
    Groups sentences into chunks up to max_chars, carrying the last
    `overlap_sentences` sentences into the next chunk so an answer that
    straddles a chunk boundary doesn't lose context.
    """
    sentences = _split_into_sentences(page_text)
    chunks: list[Chunk] = []
    current: list[str] = []
    current_len = 0
    idx = chunk_index_start

    for sentence in sentences:
        if current_len + len(sentence) > max_chars and current:
            chunks.append(
                Chunk(
                    text=" ".join(current).strip(),
                    doc_id=doc_id,
                    doc_name=doc_name,
                    page=page_number,
                    chunk_index=idx,
                )
            )
            idx += 1
            # carry overlap forward
            current = current[-overlap_sentences:] if overlap_sentences else []
            current_len = sum(len(s) for s in current)

        current.append(sentence)
        current_len += len(sentence)

    if current:
        chunks.append(
            Chunk(
                text=" ".join(current).strip(),
                doc_id=doc_id,
                doc_name=doc_name,
                page=page_number,
                chunk_index=idx,
            )
        )

    return chunks


def chunk_document(doc_id: str, doc_name: str, pages: list[tuple[int, str]]) -> list[Chunk]:
    all_chunks: list[Chunk] = []
    next_idx = 0
    for page_number, page_text in pages:
        if not page_text.strip():
            continue
        page_chunks = chunk_page(page_text, doc_id, doc_name, page_number, next_idx)
        all_chunks.extend(page_chunks)
        next_idx += len(page_chunks)
    return all_chunks
