import React from "react";

/*
 * Minimal markdown renderer for assistant answers -- no dependencies.
 * Supports: headings (# / ## / ###), bullet & numbered lists, paragraphs,
 * and inline **bold**, *italic*, `code`, plus [n] citation chips that jump
 * to the matching source card (only when n is a real source index).
 */

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|\[\d+\])/g;

function renderInline(text, keyBase, hasSource, onCite) {
  const tokens = text.split(INLINE_RE);
  return tokens.map((tok, i) => {
    const key = `${keyBase}-t${i}`;
    if (/^\*\*[^*]+\*\*$/.test(tok)) {
      return <strong key={key}>{tok.slice(2, -2)}</strong>;
    }
    if (/^`[^`]+`$/.test(tok)) {
      return <code key={key}>{tok.slice(1, -1)}</code>;
    }
    if (/^\*[^*\n]+\*$/.test(tok)) {
      return <em key={key}>{tok.slice(1, -1)}</em>;
    }
    const cite = tok.match(/^\[(\d+)\]$/);
    if (cite && hasSource(cite[1])) {
      return (
        <button
          key={key}
          type="button"
          className="footnote"
          onClick={() => onCite(cite[1])}
          title={`Jump to source ${cite[1]}`}
        >
          {cite[1]}
        </button>
      );
    }
    return <React.Fragment key={key}>{tok}</React.Fragment>;
  });
}

const LIST_ITEM_RE = /^\s*(?:[-*]|\d+[.)])\s+(.*)$/;
const HEADING_RE = /^\s*(#{1,3})\s+(.*)$/;

export function renderMarkdown(content, { sources, msgId, onCite }) {
  const sourceIndexes = new Set((sources || []).map((s) => String(s.index)));
  const hasSource = (n) => sourceIndexes.has(String(n));

  // Normalize: collapse 3+ newlines, then split into blocks on blank lines.
  const blocks = content.replace(/\n{3,}/g, "\n\n").split(/\n\s*\n/);
  const out = [];

  blocks.forEach((block, bi) => {
    const rawLines = block.split("\n");
    const lines = rawLines.map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) return;
    const keyBase = `${msgId}-b${bi}`;

    // Heading block (single line starting with #)
    const heading = lines.length === 1 && lines[0].match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      const Tag = level === 1 ? "h3" : level === 2 ? "h4" : "h5";
      out.push(
        <Tag key={keyBase} className="md-heading">
          {renderInline(heading[2], keyBase, hasSource, onCite)}
        </Tag>
      );
      return;
    }

    // List block (every line is a list item)
    const items = lines.map((l) => l.match(LIST_ITEM_RE));
    if (items.every(Boolean)) {
      const ordered = /^\s*\d/.test(lines[0]);
      const ListTag = ordered ? "ol" : "ul";
      out.push(
        <ListTag key={keyBase} className="md-list">
          {items.map((m, li) => (
            <li key={`${keyBase}-li${li}`}>
              {renderInline(m[1], `${keyBase}-li${li}`, hasSource, onCite)}
            </li>
          ))}
        </ListTag>
      );
      return;
    }

    // Plain paragraph (join soft line breaks with spaces)
    out.push(
      <p key={keyBase} className="md-para">
        {renderInline(lines.join(" "), keyBase, hasSource, onCite)}
      </p>
    );
  });

  return out;
}

/** Plain-text version of an answer for the clipboard (no md markers, no citations). */
export function plainText(content) {
  return content
    .replace(/\[\d+\]/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
