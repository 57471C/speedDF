import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getLastSaveDir,
	joinDirectory,
	LAST_SAVE_DIR_KEY,
	parentDirectory,
	rememberSaveAsDirectory,
	resolveSaveAsDefaultPath,
	setLastSaveDir,
} from "./lastSaveDir";

describe("lastSaveDir", () => {
	afterEach(() => {
		setLastSaveDir(null);
		localStorage.removeItem(LAST_SAVE_DIR_KEY);
	});

	it("round-trips the directory through memory and localStorage", () => {
		setLastSaveDir("D:\\drawings");
		expect(getLastSaveDir()).toBe("D:\\drawings");
		expect(localStorage.getItem(LAST_SAVE_DIR_KEY)).toBe("D:\\drawings");
		setLastSaveDir("  ");
		expect(getLastSaveDir()).toBeNull();
		expect(localStorage.getItem(LAST_SAVE_DIR_KEY)).toBeNull();
	});

	it("loads a stored directory on first read", async () => {
		localStorage.setItem(LAST_SAVE_DIR_KEY, "E:\\inbox");
		vi.resetModules();
		const mod = await import("./lastSaveDir");
		expect(mod.getLastSaveDir()).toBe("E:\\inbox");
		mod.setLastSaveDir(null);
	});

	it("takes the parent of a file path", () => {
		expect(parentDirectory("C:\\docs\\report.pdf")).toBe("C:\\docs");
		expect(parentDirectory("C:\\notes.pdf")).toBe("C:\\");
		expect(parentDirectory("\\\\server\\share\\a.pdf")).toBe(
			"\\\\server\\share",
		);
		expect(parentDirectory("C:/docs/a.pdf")).toBe("C:/docs");
		expect(parentDirectory("notes.pdf")).toBeNull();
		expect(parentDirectory("")).toBeNull();
	});

	it("joins a directory and a file name", () => {
		expect(joinDirectory("C:\\docs", "report_revised.pdf")).toBe(
			"C:\\docs\\report_revised.pdf",
		);
		expect(joinDirectory("C:\\", "notes_revised.pdf")).toBe(
			"C:\\notes_revised.pdf",
		);
		expect(joinDirectory("\\\\server\\share", "a_revised.pdf")).toBe(
			"\\\\server\\share\\a_revised.pdf",
		);
		expect(joinDirectory("C:/docs", "b.pdf")).toBe("C:/docs/b.pdf");
	});

	it("uses the open file's folder when that directory exists", async () => {
		setLastSaveDir("D:\\other");
		const seen: string[] = [];
		const result = await resolveSaveAsDefaultPath(
			"C:\\docs\\report.pdf",
			"report_revised.pdf",
			async (dir) => {
				seen.push(dir);
				return dir === "C:\\docs";
			},
		);
		expect(seen).toEqual(["C:\\docs"]);
		expect(result).toBe("C:\\docs\\report_revised.pdf");
	});

	it("falls back to the file name when the open file's folder is missing", async () => {
		setLastSaveDir("D:\\other");
		const seen: string[] = [];
		const result = await resolveSaveAsDefaultPath(
			"C:\\missing\\report.pdf",
			"report_revised.pdf",
			async (dir) => {
				seen.push(dir);
				return false;
			},
		);
		expect(seen).toEqual(["C:\\missing"]);
		expect(result).toBe("report_revised.pdf");
	});

	it("uses lastSaveDir for an unsaved document when that folder exists", async () => {
		setLastSaveDir("D:\\out");
		const result = await resolveSaveAsDefaultPath(
			null,
			"Untitled.pdf",
			async (dir) => dir === "D:\\out",
		);
		expect(result).toBe("D:\\out\\Untitled.pdf");
	});

	it("uses the file name when there is no directory to try", async () => {
		const result = await resolveSaveAsDefaultPath(
			"   ",
			"Untitled.pdf",
			async () => {
				throw new Error("should not probe");
			},
		);
		expect(result).toBe("Untitled.pdf");
	});

	it("uses the file name when the directory probe fails", async () => {
		setLastSaveDir("D:\\out");
		const result = await resolveSaveAsDefaultPath(
			null,
			"Untitled.pdf",
			async () => {
				throw new Error("ipc");
			},
		);
		expect(result).toBe("Untitled.pdf");
	});

	it("stores the folder of a successful Save As", () => {
		rememberSaveAsDirectory("D:\\out\\Untitled_revised.pdf");
		expect(getLastSaveDir()).toBe("D:\\out");
		expect(localStorage.getItem(LAST_SAVE_DIR_KEY)).toBe("D:\\out");
	});
});
