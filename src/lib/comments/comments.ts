/**
 * Per-page threaded comments — pure helpers (no store ownership).
 * Persistence marker is embedded in PDF Keywords via pdf-lib on flatten/save.
 */

export interface CommentReply {
	id: string;
	/** Short display badge (e.g. "TM" or "You"). */
	author: string;
	/** Full name for hover/title (e.g. "Terry Minett"). */
	authorFullName?: string;
	text: string;
	/** Epoch milliseconds */
	createdAt: number;
}

/** Root comment on a page; replies are nested one level deep. */
export interface PageComment {
	id: string;
	pageNum: number;
	/** Short display badge (e.g. "TM" or "You"). */
	author: string;
	/** Full name for hover/title (e.g. "Terry Minett"). */
	authorFullName?: string;
	text: string;
	/** Epoch milliseconds */
	createdAt: number;
	replies: CommentReply[];
}

/** Active comment author profile (from signature set or manual). */
export interface CommentAuthorProfile {
	/** Short badge shown on comments, e.g. "TM". */
	initials: string;
	/** Full name for hover tooltips, e.g. "Terry Minett". */
	fullName: string;
	email?: string;
}

/** Keyword token prefix written into PDF document info. */
export const COMMENTS_KEYWORD_PREFIX = "SPEEDDF_CMT1=";

const AUTHOR_STORAGE_KEY = "speeddf_comment_author";
const AUTHOR_PROFILE_STORAGE_KEY = "speeddf_comment_author_profile";

/** Build initials from first/last (e.g. Terry + Minett → "TM"). */
export function initialsFromName(firstName: string, lastName: string): string {
	const f = (firstName || "").trim();
	const l = (lastName || "").trim();
	const a = f.charAt(0);
	const b = l.charAt(0);
	const pair = `${a}${b}`.toUpperCase().replace(/[^A-Z]/g, "");
	if (pair.length > 0) return pair.slice(0, 4);
	// Single-field fallback: first letters of words
	const words = `${f} ${l}`.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "You";
	return words
		.map((w) => w.charAt(0).toUpperCase())
		.join("")
		.replace(/[^A-Z]/g, "")
		.slice(0, 4) || "You";
}

/** Saved-set label e.g. "Terry Minett:" */
export function signatureSetLabel(firstName: string, lastName: string): string {
	const full = `${(firstName || "").trim()} ${(lastName || "").trim()}`.trim();
	return full ? `${full}:` : "Untitled:";
}

export function getCommentAuthorProfile(): CommentAuthorProfile {
	try {
		const raw = localStorage.getItem(AUTHOR_PROFILE_STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<CommentAuthorProfile>;
			const initials = String(parsed.initials || "").trim().slice(0, 8);
			const fullName = String(parsed.fullName || "").trim().slice(0, 128);
			if (initials || fullName) {
				return {
					initials: initials || fullName.slice(0, 2).toUpperCase() || "You",
					fullName: fullName || initials || "You",
					email: parsed.email ? String(parsed.email).trim().slice(0, 254) : undefined,
				};
			}
		}
	} catch {
		/* ignore */
	}
	// Legacy single-string author key
	try {
		const stored = localStorage.getItem(AUTHOR_STORAGE_KEY);
		if (stored && stored.trim()) {
			const name = stored.trim().slice(0, 64);
			return { initials: name.slice(0, 8), fullName: name };
		}
	} catch {
		/* ignore */
	}
	return { initials: "You", fullName: "You" };
}

/** Short badge for new comments. */
export function getCommentAuthor(): string {
	return getCommentAuthorProfile().initials || "You";
}

/** Full name for hover tooltips on new comments. */
export function getCommentAuthorFullName(): string {
	const p = getCommentAuthorProfile();
	return p.fullName || p.initials || "You";
}

export function setCommentAuthor(name: string): void {
	const clean = name.trim().slice(0, 64) || "You";
	try {
		localStorage.setItem(AUTHOR_STORAGE_KEY, clean);
		setCommentAuthorProfile({
			initials: clean.slice(0, 8),
			fullName: clean,
		});
	} catch {
		/* ignore */
	}
}

export function setCommentAuthorProfile(profile: CommentAuthorProfile): void {
	const initials = (profile.initials || "You").trim().slice(0, 8) || "You";
	const fullName = (profile.fullName || initials).trim().slice(0, 128) || initials;
	const email = profile.email?.trim().slice(0, 254) || undefined;
	try {
		localStorage.setItem(
			AUTHOR_PROFILE_STORAGE_KEY,
			JSON.stringify({ initials, fullName, email }),
		);
		localStorage.setItem(AUTHOR_STORAGE_KEY, initials);
	} catch {
		/* ignore */
	}
}

export function createCommentId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function sanitizeCommentText(text: string): string {
	return (text || "")
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
		.trim()
		.slice(0, 4000);
}

export function countComments(comments: PageComment[] | undefined | null): number {
	const list = comments || [];
	return list.reduce((acc, c) => acc + 1 + (c.replies?.length || 0), 0);
}

export function commentsForPage(
	comments: PageComment[] | undefined | null,
	pageNum: number,
): PageComment[] {
	return (comments || [])
		.filter((c) => c.pageNum === pageNum)
		.sort((a, b) => a.createdAt - b.createdAt);
}

export function pageHasComments(
	comments: PageComment[] | undefined | null,
	pageNum: number,
): boolean {
	return (comments || []).some((c) => c.pageNum === pageNum);
}

/** Encode comments for PDF Keywords (pdf-lib setKeywords). */
export function encodeCommentsKeyword(comments: PageComment[]): string {
	const payload = JSON.stringify(comments || []);
	// URI encoding stays ASCII-safe inside Keywords
	return COMMENTS_KEYWORD_PREFIX + encodeURIComponent(payload);
}

/**
 * Extract comments from a Keywords string (pdf-lib getKeywords or pdf.js info.Keywords).
 * Returns null if no speedDF marker is present.
 */
export function decodeCommentsFromKeywords(
	keywords: string | string[] | undefined | null,
): PageComment[] | null {
	if (keywords == null) return null;
	const raw = Array.isArray(keywords) ? keywords.join(" ") : String(keywords);
	if (!raw.includes(COMMENTS_KEYWORD_PREFIX)) return null;

	// Token may be space-separated among other keywords
	const parts = raw.split(/[\s;]+/);
	const token = parts.find((p) => p.startsWith(COMMENTS_KEYWORD_PREFIX));
	if (!token) {
		// Fallback: substring after first prefix occurrence
		const idx = raw.indexOf(COMMENTS_KEYWORD_PREFIX);
		if (idx < 0) return null;
		const rest = raw.slice(idx + COMMENTS_KEYWORD_PREFIX.length).split(/[\s;]/)[0];
		return parseCommentsPayload(rest);
	}
	return parseCommentsPayload(token.slice(COMMENTS_KEYWORD_PREFIX.length));
}

function parseCommentsPayload(encoded: string): PageComment[] | null {
	try {
		const json = decodeURIComponent(encoded);
		const data = JSON.parse(json);
		if (!Array.isArray(data)) return null;
		return data
			.map(normalizeComment)
			.filter((c): c is PageComment => c != null);
	} catch {
		return null;
	}
}

function normalizeComment(raw: unknown): PageComment | null {
	if (!raw || typeof raw !== "object") return null;
	const c = raw as Record<string, unknown>;
	const pageNum = Number(c.pageNum);
	const text = sanitizeCommentText(String(c.text ?? ""));
	if (!Number.isFinite(pageNum) || pageNum < 1 || !text) return null;
	const repliesRaw = Array.isArray(c.replies) ? c.replies : [];
	const replies: CommentReply[] = [];
	for (const r of repliesRaw) {
		if (!r || typeof r !== "object") continue;
		const rep = r as Record<string, unknown>;
		const rText = sanitizeCommentText(String(rep.text ?? ""));
		if (!rText) continue;
		const reply: CommentReply = {
			id: String(rep.id || createCommentId()),
			author: String(rep.author || "You").slice(0, 64),
			text: rText,
			createdAt: Number(rep.createdAt) || Date.now(),
		};
		if (rep.authorFullName) {
			reply.authorFullName = String(rep.authorFullName).slice(0, 128);
		}
		replies.push(reply);
	}

	const comment: PageComment = {
		id: String(c.id || createCommentId()),
		pageNum,
		author: String(c.author || "You").slice(0, 64),
		text,
		createdAt: Number(c.createdAt) || Date.now(),
		replies,
	};
	if (c.authorFullName) {
		comment.authorFullName = String(c.authorFullName).slice(0, 128);
	}
	return comment;
}

export function formatCommentTime(epochMs: number): string {
	try {
		const d = new Date(epochMs);
		if (Number.isNaN(d.getTime())) return "";
		return d.toLocaleString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return "";
	}
}
