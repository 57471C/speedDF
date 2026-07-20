import { describe, expect, it } from "vitest";
import {
	clearFormMemory,
	emptyFormMemory,
	formFieldMemoryKey,
	isRemembered,
	rememberValue,
	removeValue,
	suggestionsFor,
	totalMemoryCount,
} from "./formMemory";

describe("formMemory", () => {
	it("remembers values globally and under field keys (MRU)", () => {
		let data = emptyFormMemory();
		data = rememberValue(data, "Alice", ["form:field:Name", "form:text"]);
		data = rememberValue(data, "Bob", ["form:field:Name", "form:text"]);
		expect(data.global[0]).toBe("Bob");
		expect(data.global).toContain("Alice");
		expect(data.byKey["form:field:Name"]?.[0]).toBe("Bob");
		expect(data.byKey["form:text"]).toEqual(["Bob", "Alice"]);
	});

	it("trims and rejects empty / oversized values", () => {
		let data = emptyFormMemory();
		data = rememberValue(data, "   ", ["form:text"]);
		expect(data.global).toHaveLength(0);
		data = rememberValue(data, "  Hello  ", ["form:text"]);
		expect(data.global).toEqual(["Hello"]);
		data = rememberValue(data, "x".repeat(501), ["form:text"]);
		expect(data.global).toEqual(["Hello"]);
	});

	it("suggestions require 2+ chars and match starts-with (case-insensitive)", () => {
		let data = emptyFormMemory();
		data = rememberValue(data, "Global Only", []);
		data = rememberValue(data, "Jane Doe", ["form:field:Name"]);
		data = rememberValue(data, "John Smith", ["form:field:Name"]);
		data = rememberValue(data, "Anecdotes", ["form:field:Name"]);

		// Too short — no aggressive popdown
		expect(suggestionsFor(data, ["form:field:Name"], "")).toEqual([]);
		expect(suggestionsFor(data, ["form:field:Name"], "j")).toEqual([]);

		// starts-with, not substring mid-word
		const filtered = suggestionsFor(
			data,
			["form:field:Name", "form:text"],
			"ja",
		);
		expect(filtered).toEqual(["Jane Doe"]);
		expect(
			suggestionsFor(data, ["form:field:Name"], "ne"),
		).toEqual([]); // "Jane" contains "ne" but does not start with it

		const jo = suggestionsFor(data, ["form:field:Name"], "jo");
		expect(jo[0]).toBe("John Smith");
		expect(jo).not.toContain("Global Only");
	});

	it("removes individual values from a key and globally when orphaned", () => {
		let data = emptyFormMemory();
		data = rememberValue(data, "Temp", ["form:field:Ref"]);
		data = removeValue(data, "Temp", "form:field:Ref");
		expect(data.byKey["form:field:Ref"]).toBeUndefined();
		expect(data.global).not.toContain("Temp");
	});

	it("clearAll empties memory", () => {
		let data = emptyFormMemory();
		data = rememberValue(data, "X", ["form:text"]);
		expect(totalMemoryCount(data)).toBe(1);
		data = clearFormMemory();
		expect(totalMemoryCount(data)).toBe(0);
		expect(data.global).toEqual([]);
	});

	it("isRemembered and field key helper", () => {
		let data = emptyFormMemory();
		const key = formFieldMemoryKey(" Address ");
		expect(key).toBe("form:field:Address");
		data = rememberValue(data, "1 Main St", [key]);
		expect(isRemembered(data, "1 Main St", [key])).toBe(true);
		expect(isRemembered(data, "other", [key])).toBe(false);
	});
});
