/**
 * Pure text extraction for the "generate cards" input step — turns an
 * uploaded .txt/.md/.html file's contents into plain text suitable to send
 * as generation source material.
 *
 * Deliberately regex-based (no DOMParser): vitest runs in a node
 * environment, and lossy-but-readable extraction is fine here — the output
 * is source material for an LLM, not something we render. PDF is NOT
 * handled here; it's read as base64 in the component and sent to the API
 * as a native document block.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decodes the common named entities plus numeric (&#123; / &#x1F;) forms. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name: string) =>
      NAMED_ENTITIES[name] === undefined ? `&${name};` : NAMED_ENTITIES[name],
    );
}

/**
 * Strips HTML down to readable plain text: script/style/noscript content is
 * dropped entirely, block-element boundaries become newlines (so paragraphs
 * and list items don't run together), remaining tags are removed, entities
 * decoded, and whitespace collapsed.
 */
export function stripHtml(html: string): string {
  const text = html
    // Drop non-content blocks wholesale, including their inner text.
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    // HTML comments.
    .replace(/<!--[\s\S]*?-->/g, "")
    // Block boundaries → newlines so stripped text keeps its structure.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre)>/gi, "\n")
    // Everything else tag-shaped goes away.
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t]+/g, " ") // collapse runs of spaces/tabs (incl. ex-&nbsp;)
    .replace(/ ?\n ?/g, "\n") // trim spaces hugging newlines
    .replace(/\n{3,}/g, "\n\n") // collapse blank-line runs
    .trim();
}

/**
 * Dispatches by file extension, same shape as importExport's
 * parseImportByFilename: .html/.htm are stripped to plain text, anything
 * else (.txt/.md) passes through trimmed.
 */
export function extractSource(filename: string, raw: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return stripHtml(raw);
  }
  return raw.trim();
}
