/**
 * Persistent page-thumbnail store (IndexedDB).
 * Keyed by absolute file path + content fingerprint so re-opens are instant
 * and save/annotation changes invalidate correctly.
 */

const DB_NAME = "speeddf_page_thumbs_v1";
const DB_VERSION = 1;
const STORE = "docs";

export type PersistedDocThumbs = {
	/** Absolute path (or stable id). */
	path: string;
	/** Fingerprint of file bytes — mismatch drops cache. */
	contentKey: string;
	/** pageIndex (0-based) → JPEG data URL */
	pages: Record<string, string>;
	updatedAt: number;
};

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === "undefined") {
			reject(new Error("IndexedDB unavailable"));
			return;
		}
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onerror = () => reject(req.error || new Error("IDB open failed"));
		req.onsuccess = () => resolve(req.result);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: "path" });
			}
		};
	});
}

/**
 * Cheap content fingerprint (length + sampled bytes).
 * Avoids hashing the full 25MB+ buffer on every open.
 */
export function contentKeyForBytes(bytes: Uint8Array): string {
	const len = bytes.byteLength;
	let h = len >>> 0;
	if (len === 0) return "0:0";
	const samples = 32;
	for (let s = 0; s < samples; s++) {
		const i = Math.min(len - 1, Math.floor((s * (len - 1)) / (samples - 1 || 1)));
		h = (Math.imul(h ^ bytes[i], 16777619) >>> 0);
	}
	// Include a couple of tail bytes for append-style edits
	h = (h ^ bytes[len - 1]) >>> 0;
	if (len > 1) h = (h ^ bytes[len - 2]) >>> 0;
	return `${len}:${h.toString(16)}`;
}

export async function loadPersistedThumbnails(
	filePath: string | null | undefined,
	contentKey: string,
): Promise<Record<number, string> | null> {
	if (!filePath || !contentKey) return null;
	try {
		const db = await openDb();
		const row = await new Promise<PersistedDocThumbs | undefined>(
			(resolve, reject) => {
				const tx = db.transaction(STORE, "readonly");
				const req = tx.objectStore(STORE).get(filePath);
				req.onsuccess = () =>
					resolve(req.result as PersistedDocThumbs | undefined);
				req.onerror = () => reject(req.error);
			},
		);
		db.close();
		if (!row || row.contentKey !== contentKey || !row.pages) return null;
		const out: Record<number, string> = {};
		for (const [k, v] of Object.entries(row.pages)) {
			const idx = Number(k);
			if (Number.isFinite(idx) && typeof v === "string" && v.startsWith("data:")) {
				out[idx] = v;
			}
		}
		return Object.keys(out).length > 0 ? out : null;
	} catch (err) {
		console.warn("Thumbnail IDB load failed:", err);
		return null;
	}
}

export async function persistThumbnailPage(
	filePath: string | null | undefined,
	contentKey: string,
	pageIndex: number,
	dataUrl: string,
): Promise<void> {
	if (!filePath || !contentKey || pageIndex < 0 || !dataUrl) return;
	try {
		const db = await openDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE, "readwrite");
			const store = tx.objectStore(STORE);
			const getReq = store.get(filePath);
			getReq.onsuccess = () => {
				const prev = (getReq.result as PersistedDocThumbs | undefined) || {
					path: filePath,
					contentKey,
					pages: {},
					updatedAt: Date.now(),
				};
				// Content changed — reset page map
				const pages =
					prev.contentKey === contentKey ? { ...prev.pages } : {};
				pages[String(pageIndex)] = dataUrl;
				const next: PersistedDocThumbs = {
					path: filePath,
					contentKey,
					pages,
					updatedAt: Date.now(),
				};
				const putReq = store.put(next);
				putReq.onsuccess = () => resolve();
				putReq.onerror = () => reject(putReq.error);
			};
			getReq.onerror = () => reject(getReq.error);
		});
		db.close();
	} catch (err) {
		// Quota / private mode — non-fatal
		console.warn("Thumbnail IDB write failed:", err);
	}
}

export async function clearPersistedThumbnails(
	filePath: string | null | undefined,
): Promise<void> {
	if (!filePath) return;
	try {
		const db = await openDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE, "readwrite");
			const req = tx.objectStore(STORE).delete(filePath);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});
		db.close();
	} catch {
		/* ignore */
	}
}

/** All document paths currently stored in the IDB thumb cache. */
export async function listPersistedThumbnailPaths(): Promise<string[]> {
	try {
		const db = await openDb();
		const paths = await new Promise<string[]>((resolve, reject) => {
			const tx = db.transaction(STORE, "readonly");
			const req = tx.objectStore(STORE).getAllKeys();
			req.onsuccess = () => {
				const keys = (req.result || []) as IDBValidKey[];
				resolve(
					keys
						.map((k) => (typeof k === "string" ? k : String(k)))
						.filter(Boolean),
				);
			};
			req.onerror = () => reject(req.error);
		});
		db.close();
		return paths;
	} catch {
		return [];
	}
}

/**
 * Delete IDB thumb entries whose path is not in `keepPaths`.
 * Non-blocking safe: failures are swallowed.
 * @returns number of rows removed
 */
export async function pruneOrphanedPersistedThumbnails(
	keepPaths: string[],
): Promise<number> {
	const keep = new Set(
		keepPaths.filter(Boolean).map((p) => p.toLowerCase()),
	);
	try {
		const existing = await listPersistedThumbnailPaths();
		const orphans = existing.filter((p) => !keep.has(p.toLowerCase()));
		if (orphans.length === 0) return 0;
		const db = await openDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE, "readwrite");
			const store = tx.objectStore(STORE);
			for (const path of orphans) {
				store.delete(path);
			}
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		db.close();
		return orphans.length;
	} catch (err) {
		console.warn("Orphan thumbnail prune failed:", err);
		return 0;
	}
}

/** Layout skeleton key used by Recent Documents warm open. */
export function layoutMetaStorageKey(filePath: string): string {
	try {
		return `speeddf_meta_${btoa(filePath)}`;
	} catch {
		return `speeddf_meta_${filePath}`;
	}
}

/** Remove localStorage layout skeleton for a path (if present). */
export function clearLayoutMetaCache(filePath: string | null | undefined): void {
	if (!filePath) return;
	try {
		localStorage.removeItem(layoutMetaStorageKey(filePath));
	} catch {
		/* ignore */
	}
}
