import { describe, expect, it } from "vitest";
import {
	backspace,
	clearAll,
	clearEntry,
	createCalculatorState,
	inputDigit,
	inputEquals,
	inputOperator,
	pasteValue,
} from "./calculator";

describe("calculator", () => {
	it("adds two numbers", () => {
		let s = createCalculatorState();
		s = inputDigit(s, "1");
		s = inputDigit(s, "2");
		s = inputOperator(s, "+");
		s = inputDigit(s, "3");
		s = inputEquals(s);
		expect(s.display).toBe("15");
	});

	it("tracks a dim expression line like Windows 11", () => {
		let s = createCalculatorState();
		s = inputDigit(s, "1");
		s = inputDigit(s, "2");
		s = inputOperator(s, "+");
		expect(s.expression).toBe("12 +");
		expect(s.display).toBe("12");
		s = inputDigit(s, "3");
		expect(s.expression).toBe("12 +");
		expect(s.display).toBe("3");
		s = inputEquals(s);
		expect(s.display).toBe("15");
		expect(s.expression).toBe("12 + 3 =");
		// Next digit starts fresh — memory line clears
		s = inputDigit(s, "7");
		expect(s.display).toBe("7");
		expect(s.expression).toBe("");
	});

	it("keeps expression on CE but clears on C", () => {
		let s = createCalculatorState();
		s = inputDigit(s, "9");
		s = inputOperator(s, "*");
		s = inputDigit(s, "2");
		s = clearEntry(s);
		expect(s.display).toBe("0");
		expect(s.expression).toBe("9 ×");
		s = clearAll();
		expect(s.expression).toBe("");
	});

	it("handles multiply and divide", () => {
		let s = createCalculatorState();
		s = inputDigit(s, "8");
		s = inputOperator(s, "*");
		s = inputDigit(s, "5");
		s = inputEquals(s);
		expect(s.display).toBe("40");
		s = inputOperator(s, "/");
		s = inputDigit(s, "4");
		s = inputEquals(s);
		expect(s.display).toBe("10");
	});

	it("guards divide by zero", () => {
		let s = createCalculatorState();
		s = inputDigit(s, "5");
		s = inputOperator(s, "/");
		s = inputDigit(s, "0");
		s = inputEquals(s);
		expect(s.display).toBe("Error");
		expect(s.error).toBeTruthy();
	});

	it("pastes numeric clipboard text", () => {
		let s = createCalculatorState();
		s = pasteValue(s, "  42.5  ");
		expect(s.display).toBe("42.5");
	});

	it("backspaces and clears", () => {
		let s = createCalculatorState();
		s = inputDigit(s, "9");
		s = inputDigit(s, "8");
		s = backspace(s);
		expect(s.display).toBe("9");
		s = clearAll();
		expect(s.display).toBe("0");
	});
});
