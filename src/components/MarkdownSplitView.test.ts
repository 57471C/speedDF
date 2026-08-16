import { render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	activeDoc,
	initializeNewDocument,
	setMarkdownSourceAction,
} from "../pdfStore.svelte.ts";
import MarkdownSplitView from "./MarkdownSplitView.svelte";

vi.mock("../lib/markdown/thumbnail", () => ({
	captureMarkdownViewThumbnail: vi.fn(async () => null),
	findMarkdownContentRoot: vi.fn(() => null),
}));

describe("MarkdownSplitView", () => {
	beforeEach(() => {
		activeDoc.openDocuments = [];
		activeDoc.activeDocumentId = null;
		activeDoc.isSaving = false;
		initializeNewDocument("split.md", "C:/tmp/split.md");
		activeDoc.fileType = "markdown";
		activeDoc.markdownSource = "# Hello\n";
		activeDoc.rawBytes = new TextEncoder().encode("# Hello\n");
		activeDoc.markdownSplitView = true;
		activeDoc.isDirty = false;
	});

	afterEach(() => {
		activeDoc.openDocuments = [];
		activeDoc.activeDocumentId = null;
		activeDoc.isSaving = false;
	});

	it("highlights a fenced js block in the preview", async () => {
		activeDoc.markdownSource = "```js\nconst x = 1;\n```\n";
		render(MarkdownSplitView, { zoomScale: 150 });
		await waitFor(() => {
			const preview = screen.getByLabelText("Markdown document");
			expect(preview.innerHTML).toContain("hljs-keyword");
			expect(preview.innerHTML).toContain("language-javascript");
		});
	});

	it("shows source on the left and a live preview on the right", () => {
		render(MarkdownSplitView, { zoomScale: 150 });
		const editor = screen.getByLabelText("Markdown source") as HTMLTextAreaElement;
		expect(editor.value).toContain("# Hello");
		expect(screen.getByLabelText("Markdown document").innerHTML).toMatch(
			/<h1[^>]*>Hello<\/h1>/,
		);
	});

	it("wires both scroll panes for relative sync", () => {
		const { container } = render(MarkdownSplitView, { zoomScale: 150 });
		expect(screen.getByLabelText("Markdown source")).toBeTruthy();
		expect(
			container.querySelector("[data-markdown-preview-scroll]"),
		).toBeTruthy();
	});

	it("marks dirty and updates preview after a source edit", async () => {
		render(MarkdownSplitView, { zoomScale: 150 });
		expect(setMarkdownSourceAction("# Hello\n\nworld\n")).toBe(true);
		expect(activeDoc.isDirty).toBe(true);

		await waitFor(() => {
			expect(screen.getByLabelText("Markdown document").innerHTML).toMatch(
				/world/,
			);
		});
	});

	it("patches preview HTML in place without remounting the scroller", async () => {
		const { container } = render(MarkdownSplitView, { zoomScale: 150 });
		const article = container.querySelector("[data-markdown-content]");
		const scroller = container.querySelector("[data-markdown-preview-scroll]");
		const host = container.querySelector("[data-markdown-html]");
		expect(article).toBeTruthy();
		expect(scroller).toBeTruthy();
		expect(host).toBeTruthy();

		expect(setMarkdownSourceAction("# Hello\n\nworld\n")).toBe(true);

		await waitFor(() => {
			expect(article!.innerHTML).toMatch(/world/);
		});
		// Same article, host, and overflow container — not a {#key}/{@html} remount.
		expect(container.querySelector("[data-markdown-content]")).toBe(article);
		expect(container.querySelector("[data-markdown-html]")).toBe(host);
		expect(container.querySelector("[data-markdown-preview-scroll]")).toBe(
			scroller,
		);
	});
});
