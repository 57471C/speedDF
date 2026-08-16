/**
 * Markdown source encode/decode for disk I/O.
 * Canonical document text lives on DocumentWorkspace.markdownSource;
 * these helpers only convert to/from UTF-8 bytes for Save / reopen.
 */

/** Preview re-parse delay after source edits (ms). Editor + dirty stay live. */
export const MARKDOWN_PREVIEW_DEBOUNCE_MS = 160;

/** UTF-8 bytes for writing a `.md` / `.markdown` file. */
export function encodeMarkdownSource(source: string): Uint8Array {
	return new TextEncoder().encode(source ?? "");
}

/** Decode file bytes as UTF-8 markdown source. */
export function decodeMarkdownBytes(bytes: Uint8Array): string {
	return new TextDecoder("utf-8").decode(bytes);
}
