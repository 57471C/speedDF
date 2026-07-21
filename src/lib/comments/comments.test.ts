import { describe, expect, it } from "vitest";
import {
	COMMENTS_KEYWORD_PREFIX,
	clampCommentPct,
	commentHasFlag,
	commentsForPage,
	countComments,
	decodeCommentsFromKeywords,
	encodeCommentsKeyword,
	initialsFromName,
	type PageComment,
	pageHasComments,
	sanitizeCommentText,
	signatureSetLabel,
} from "./comments";

function sampleComments(): PageComment[] {
	return [
		{
			id: "t1",
			pageNum: 1,
			author: "You",
			text: "Root note",
			createdAt: 1000,
			x: 25,
			y: 40,
			replies: [
				{
					id: "r1",
					author: "You",
					text: "Reply one",
					createdAt: 2000,
				},
			],
		},
		{
			id: "t2",
			pageNum: 3,
			author: "You",
			text: "Other page",
			createdAt: 3000,
			replies: [],
		},
	];
}

describe("comments helpers", () => {
	it("counts threads and replies", () => {
		expect(countComments(sampleComments())).toBe(3);
		expect(countComments([])).toBe(0);
		expect(countComments(undefined)).toBe(0);
	});

	it("filters by page", () => {
		const page1 = commentsForPage(sampleComments(), 1);
		expect(page1).toHaveLength(1);
		expect(page1[0].id).toBe("t1");
		expect(pageHasComments(sampleComments(), 3)).toBe(true);
		expect(pageHasComments(sampleComments(), 99)).toBe(false);
	});

	it("sanitizes comment text", () => {
		expect(sanitizeCommentText("  hello\x00world  ")).toBe("helloworld");
		expect(sanitizeCommentText("")).toBe("");
	});

	it("round-trips via Keywords encoding", () => {
		const original = sampleComments();
		const keyword = encodeCommentsKeyword(original);
		expect(keyword.startsWith(COMMENTS_KEYWORD_PREFIX)).toBe(true);
		const restored = decodeCommentsFromKeywords(keyword);
		expect(restored).not.toBeNull();
		expect(restored).toHaveLength(2);
		expect(restored?.[0].text).toBe("Root note");
		expect(restored?.[0].replies).toHaveLength(1);
		expect(restored?.[0].replies[0].text).toBe("Reply one");
		expect(restored?.[0].x).toBe(25);
		expect(restored?.[0].y).toBe(40);
		expect(restored?.[1].pageNum).toBe(3);
		expect(restored?.[1].x).toBeUndefined();
	});

	it("detects flag positions and clamps percents", () => {
		expect(commentHasFlag(sampleComments()[0])).toBe(true);
		expect(commentHasFlag(sampleComments()[1])).toBe(false);
		expect(clampCommentPct(-10)).toBe(0.5);
		expect(clampCommentPct(150)).toBe(99.5);
		expect(clampCommentPct(33)).toBe(33);
	});

	it("extracts marker from mixed Keywords string", () => {
		const token = encodeCommentsKeyword(sampleComments());
		const mixed = `draft review ${token} important`;
		const restored = decodeCommentsFromKeywords(mixed);
		expect(restored).not.toBeNull();
		expect(restored).toHaveLength(2);
	});

	it("returns null when no marker is present", () => {
		expect(decodeCommentsFromKeywords("just normal keywords")).toBeNull();
		expect(decodeCommentsFromKeywords(undefined)).toBeNull();
	});

	it("builds initials and signature labels from names", () => {
		expect(initialsFromName("Terry", "Minett")).toBe("TM");
		expect(initialsFromName("  ada  ", "lovelace")).toBe("AL");
		expect(signatureSetLabel("Terry", "Minett")).toBe("Terry Minett:");
		expect(signatureSetLabel("", "")).toBe("Untitled:");
	});
});
