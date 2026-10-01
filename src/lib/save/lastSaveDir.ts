/**
 * Last Save As directory.
 *
 * Remembered in memory and localStorage. Save As uses it only when the open
 * document has no path. A directory is used as the dialog seed only after
 * Rust confirms it exists and is a directory; a missing or timed-out
 * network path falls back to a file name so the OS picker can choose.
 */

import { invoke } from "@tauri-apps/api/core";

export const LAST_SAVE_DIR_KEY = "speeddf_last_save_dir";

/** `undefined` means "not loaded yet". */
let memory: string | null | undefined;

function readStoredDir(): string | null {
	try {
		if (typeof localStorage === "undefined") return null;
		const raw = localStorage.getItem(LAST_SAVE_DIR_KEY);
		const trimmed = raw?.trim() ?? "";
		return trimmed || null;
	} catch {
		return null;
	}
}

function writeStoredDir(dir: string | null): void {
	try {
		if (typeof localStorage === "undefined") return;
		if (dir) localStorage.setItem(LAST_SAVE_DIR_KEY, dir);
		else localStorage.removeItem(LAST_SAVE_DIR_KEY);
	} catch {
		/* quota / private mode */
	}
}

export function getLastSaveDir(): string | null {
	if (memory === undefined) memory = readStoredDir();
	return memory;
}

export function setLastSaveDir(dir: string | null): void {
	const trimmed = dir?.trim() ?? "";
	memory = trimmed || null;
	writeStoredDir(memory);
}

/**
 * Parent directory of a file path.
 * Returns null when the path has no directory component.
 */
export function parentDirectory(filePath: string): string | null {
	const trimmed = filePath.trim().replace(/[\\/]+$/, "");
	if (!trimmed) return null;
	const idx = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
	if (idx < 0) return null;
	if (idx === 0) return trimmed.slice(0, 1);
	// "C:\file.pdf" -> "C:\"
	if (idx === 2 && trimmed[1] === ":") return `${trimmed.slice(0, 2)}\\`;
	return trimmed.slice(0, idx);
}

/** Join a directory and a file name, preserving the directory's separator. */
export function joinDirectory(dir: string, fileName: string): string {
	const name = fileName.replace(/^[\\/]+/, "");
	const sep = dir.includes("\\") ? "\\" : "/";
	const base = dir.replace(/[\\/]+$/, "");
	if (/^[A-Za-z]:$/.test(base)) return `${base}\\${name}`;
	if (!base) {
		if (dir.startsWith("\\") || dir.startsWith("/")) return `${dir[0]}${name}`;
		return name;
	}
	return `${base}${sep}${name}`;
}

/**
 * Folder to seed, before the existence check.
 * An open file owns the choice: a missing parent does not fall through to
 * the last Save As folder.
 */
export function saveAsDirectoryCandidate(
	filePath: string | null | undefined,
	lastSaveDir: string | null,
): string | null {
	const path = filePath?.trim() ?? "";
	if (path) return parentDirectory(path);
	const last = lastSaveDir?.trim() ?? "";
	return last || null;
}

async function probeDirectory(dir: string): Promise<boolean> {
	try {
		const ok = await invoke<boolean>("directory_exists", { path: dir });
		return ok === true;
	} catch {
		return false;
	}
}

/**
 * `defaultPath` for the Tauri save dialog.
 * Full path when the chosen directory exists; otherwise the file name only.
 */
export async function resolveSaveAsDefaultPath(
	filePath: string | null | undefined,
	suggestedName: string,
	directoryExists: (dir: string) => Promise<boolean> = probeDirectory,
): Promise<string> {
	const dir = saveAsDirectoryCandidate(filePath, getLastSaveDir());
	if (!dir) return suggestedName;
	let exists = false;
	try {
		exists = (await directoryExists(dir)) === true;
	} catch {
		exists = false;
	}
	if (!exists) return suggestedName;
	return joinDirectory(dir, suggestedName);
}

/** Remember the folder of a path that Save As just wrote. */
export function rememberSaveAsDirectory(savedPath: string): void {
	const dir = parentDirectory(savedPath);
	if (!dir) return;
	setLastSaveDir(dir);
}
