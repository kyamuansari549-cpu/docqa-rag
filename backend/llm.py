"""
Builds the grounded-answer prompt from retrieved chunks and calls the
Claude API. Keeping this separate from vectorstore.py makes the
retrieval-vs-generation split in the RAG pipeline obvious -- a common
thing interviewers ask you to point to in your own code.
"""

import os
from anthropic import Anthropic

_client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

SYSTEM_PROMPT = """You are a document Q&A assistant. You answer questions using ONLY the
numbered source excerpts provided below. Rules:

1. Base your answer strictly on the given sources. If the sources don't contain
   the answer, say so plainly -- do not use outside knowledge.
2. After every claim, cite the source number it came from like this: [1], [2].
3. If sources conflict, point that out rather than picking one silently.
4. Keep the answer concise and directly responsive to the question.
"""


def _build_context(hits: list[dict]) -> str:
    blocks = []
    for i, hit in enumerate(hits, start=1):
        page_info = f", page {hit['page']}" if hit.get("page") else ""
        blocks.append(f"[{i}] (from \"{hit['doc_name']}\"{page_info}):\n{hit['text']}")
    return "\n\n".join(blocks)


def answer_question(question: str, hits: list[dict]) -> str:
    if not hits:
        return "I couldn't find anything relevant in the uploaded documents to answer that."

    context = _build_context(hits)
    user_message = f"Sources:\n\n{context}\n\nQuestion: {question}"

    response = _client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )
    return "".join(block.text for block in response.content if block.type == "text")
