import { describe, expect, it } from "vitest";
import {
	backspace,
	clearAll,
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
