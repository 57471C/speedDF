/** Lightweight four-function calculator engine (Windows-style sequential ops). */

export type CalcOp = "+" | "-" | "*" | "/";

export interface CalculatorState {
	/** Current display string (main line) */
	display: string;
	/**
	 * Dim secondary line (Windows 11 style) — e.g. "12 +" or "12 + 3 =".
	 * Empty when idle / after clear.
	 */
	expression: string;
	/** Accumulated value waiting for the next operand */
	accumulator: number | null;
	/** Pending operator */
	pendingOp: CalcOp | null;
	/** True after = so the next digit starts a fresh entry */
	justEvaluated: boolean;
	/** True while the user is typing the current operand */
	entering: boolean;
	/** Last error message (e.g. divide by zero), or null */
	error: string | null;
}

export function createCalculatorState(): CalculatorState {
	return {
		display: "0",
		expression: "",
		accumulator: null,
		pendingOp: null,
		justEvaluated: false,
		entering: false,
		error: null,
	};
}

function applyOp(a: number, op: CalcOp, b: number): number | "Error" {
	switch (op) {
		case "+":
			return a + b;
		case "-":
			return a - b;
		case "*":
			return a * b;
		case "/":
			if (b === 0) return "Error";
			return a / b;
	}
}

function formatNumber(n: number): string {
	if (!Number.isFinite(n)) return "Error";
	// Avoid floating noise while keeping reasonable precision
	const rounded = Math.round(n * 1e12) / 1e12;
	const s = String(rounded);
	// Cap display length like a small calculator
	if (s.length > 14) {
		return rounded.toPrecision(10).replace(/\.?0+e/, "e");
	}
	return s;
}

function parseDisplay(display: string): number {
	const n = Number(display);
	return Number.isFinite(n) ? n : 0;
}

/** Glyph for the secondary expression line (Windows calculator style). */
export function opGlyph(op: CalcOp): string {
	switch (op) {
		case "+":
			return "+";
		case "-":
			return "−";
		case "*":
			return "×";
		case "/":
			return "÷";
	}
}

function pendingExpression(acc: number, op: CalcOp): string {
	return `${formatNumber(acc)} ${opGlyph(op)}`;
}

export function inputDigit(state: CalculatorState, digit: string): CalculatorState {
	if (state.error) return clearAll();
	if (state.justEvaluated || !state.entering) {
		return {
			...state,
			// Fresh entry after = clears the memory line (Windows behaviour)
			expression: state.justEvaluated ? "" : state.expression,
			display: digit === "." ? "0." : digit,
			justEvaluated: false,
			entering: true,
			error: null,
		};
	}
	if (digit === "." && state.display.includes(".")) return state;
	if (state.display === "0" && digit !== ".") {
		return { ...state, display: digit };
	}
	if (state.display.length >= 14) return state;
	return { ...state, display: state.display + digit };
}

export function inputOperator(state: CalculatorState, op: CalcOp): CalculatorState {
	if (state.error) return clearAll();
	const current = parseDisplay(state.display);

	if (state.accumulator !== null && state.pendingOp && state.entering) {
		const result = applyOp(state.accumulator, state.pendingOp, current);
		if (result === "Error") {
			return {
				...createCalculatorState(),
				display: "Error",
				error: "Divide by zero",
			};
		}
		return {
			display: formatNumber(result),
			expression: pendingExpression(result, op),
			accumulator: result,
			pendingOp: op,
			justEvaluated: false,
			entering: false,
			error: null,
		};
	}

	const acc = state.accumulator !== null && state.pendingOp && !state.entering
		? state.accumulator
		: current;

	return {
		...state,
		display: formatNumber(acc),
		expression: pendingExpression(acc, op),
		accumulator: acc,
		pendingOp: op,
		justEvaluated: false,
		entering: false,
		error: null,
	};
}

export function inputEquals(state: CalculatorState): CalculatorState {
	if (state.error) return clearAll();
	if (state.pendingOp === null || state.accumulator === null) {
		return { ...state, justEvaluated: true, entering: false };
	}
	const current = parseDisplay(state.display);
	const result = applyOp(state.accumulator, state.pendingOp, current);
	if (result === "Error") {
		return {
			...createCalculatorState(),
			display: "Error",
			error: "Divide by zero",
		};
	}
	const expr = `${formatNumber(state.accumulator)} ${opGlyph(state.pendingOp)} ${formatNumber(current)} =`;
	return {
		display: formatNumber(result),
		expression: expr,
		accumulator: null,
		pendingOp: null,
		justEvaluated: true,
		entering: false,
		error: null,
	};
}

export function clearAll(): CalculatorState {
	return createCalculatorState();
}

export function clearEntry(state: CalculatorState): CalculatorState {
	if (state.error) return clearAll();
	// CE clears only the current entry; keep the dim expression memory
	return { ...state, display: "0", entering: false, error: null };
}

export function backspace(state: CalculatorState): CalculatorState {
	if (state.error) return clearAll();
	if (state.justEvaluated || !state.entering) return state;
	if (state.display.length <= 1 || (state.display.length === 2 && state.display.startsWith("-"))) {
		return { ...state, display: "0", entering: false };
	}
	return { ...state, display: state.display.slice(0, -1) };
}

export function toggleSign(state: CalculatorState): CalculatorState {
	if (state.error) return clearAll();
	const n = parseDisplay(state.display);
	if (n === 0) return state;
	return {
		...state,
		display: formatNumber(-n),
		entering: true,
		justEvaluated: false,
	};
}

export function percent(state: CalculatorState): CalculatorState {
	if (state.error) return clearAll();
	const n = parseDisplay(state.display) / 100;
	return {
		...state,
		display: formatNumber(n),
		entering: true,
		justEvaluated: false,
	};
}

/** Paste a number (or expression start) into the calculator display. */
export function pasteValue(state: CalculatorState, text: string): CalculatorState {
	const cleaned = text.trim().replace(/,/g, "").replace(/[^\d.\-eE+]/g, "");
	if (!cleaned) return state;
	const n = Number(cleaned);
	if (!Number.isFinite(n)) return state;
	return {
		...state,
		expression: state.justEvaluated ? "" : state.expression,
		display: formatNumber(n),
		entering: true,
		justEvaluated: false,
		error: null,
	};
}
