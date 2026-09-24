/**
 * Markdown → HTML projection (frontend-only).
 * Source text stays canonical; this is a pure view transform.
 * Fenced code uses the shared highlight.js pipeline.
 * Each block tag carries data-md-line (1-based source line) for split scroll.
 */
import { Marked, Renderer, type Tokens } from "marked";
import { renderFencedBlock, unescapeHtml } from "./highlight";

type LineToken = {
	type: string;
	raw?: string;
	mdLine?: number;
	tokens?: LineToken[];
	items?: LineToken[];
};

function newlineCount(raw: string | undefined): number {
	if (!raw) return 0;
	let n = 0;
	for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === 10) n++;
	return n;
}

/**
 * Number block tokens from `raw` newline spans.
 * Marked often keeps the trailing newline on the following space token, so a
 * block with zero newlines still occupies its start line and the space token
 * advances past it.
 */
function assignSourceLines(tokens: LineToken[], startLine: number): number {
	let line = startLine;
	for (const token of tokens) {
		if (token.type === "space") {
			line += newlineCount(token.raw);
			continue;
		}
		token.mdLine = line;
		if (token.type === "list" && token.items) {
			let itemLine = line;
			for (const item of token.items) {
				item.mdLine = itemLine;
				if (item.tokens?.length) assignSourceLines(item.tokens, itemLine);
				itemLine += newlineCount(item.raw);
			}
		} else if (token.type === "blockquote" && token.tokens?.length) {
			assignSourceLines(token.tokens, line);
		}
		line += newlineCount(token.raw);
	}
	return line;
}

function stampBlockHtml(html: string, line: number | undefined): string {
	if (!html || line == null || !Number.isFinite(line) || line < 1) return html;
	const n = Math.floor(line);
	return html.replace(
		/^(\s*)<([A-Za-z][\w:-]*)/,
		`$1<$2 data-md-line="${n}"`,
	);
}

function lineOf(token: object): number | undefined {
	const line = (token as { mdLine?: number }).mdLine;
	return typeof line === "number" ? line : undefined;
}

const highlightMark = {
	name: "highlightMark",
	level: "inline" as const,
	start(src: string) {
		return src.indexOf("==");
	},
	tokenizer(src: string) {
		const match = /^==([^=\n]+)==/.exec(src);
		if (!match) return;
		return {
			type: "highlightMark",
			raw: match[0],
			text: match[1],
		};
	},
	renderer(token: { text: string }) {
		return `<mark>${token.text}</mark>`;
	},
};

const marked = new Marked({
	gfm: true,
	breaks: false,
	hooks: {
		processAllTokens(tokens) {
			assignSourceLines(tokens as LineToken[], 1);
			return tokens;
		},
	},
	renderer: {
		code(token: Tokens.Code) {
			const raw = token.escaped ? unescapeHtml(token.text) : token.text;
			return stampBlockHtml(renderFencedBlock(raw, token.lang), lineOf(token));
		},
		heading(this: Renderer, token: Tokens.Heading) {
			return stampBlockHtml(
				Renderer.prototype.heading.call(this, token),
				lineOf(token),
			);
		},
		paragraph(this: Renderer, token: Tokens.Paragraph) {
			return stampBlockHtml(
				Renderer.prototype.paragraph.call(this, token),
				lineOf(token),
			);
		},
		blockquote(this: Renderer, token: Tokens.Blockquote) {
			return stampBlockHtml(
				Renderer.prototype.blockquote.call(this, token),
				lineOf(token),
			);
		},
		list(this: Renderer, token: Tokens.List) {
			return stampBlockHtml(
				Renderer.prototype.list.call(this, token),
				lineOf(token),
			);
		},
		listitem(this: Renderer, token: Tokens.ListItem) {
			return stampBlockHtml(
				Renderer.prototype.listitem.call(this, token),
				lineOf(token),
			);
		},
		table(this: Renderer, token: Tokens.Table) {
			return stampBlockHtml(
				Renderer.prototype.table.call(this, token),
				lineOf(token),
			);
		},
		hr(this: Renderer, token: Tokens.Hr) {
			return stampBlockHtml(Renderer.prototype.hr.call(this, token), lineOf(token));
		},
		html(this: Renderer, token: Tokens.HTML | Tokens.Tag) {
			return stampBlockHtml(
				Renderer.prototype.html.call(this, token),
				lineOf(token),
			);
		},
	},
});

marked.use({ extensions: [highlightMark] });

/**
 * Parse markdown source into raw HTML (not XSS-safe — always sanitize before inject).
 */
export function parseMarkdownToHtml(source: string): string {
	if (!source) return "";
	const result = marked.parse(source, { async: false });
	return typeof result === "string" ? result : "";
}
