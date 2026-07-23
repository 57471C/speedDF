import { describe, expect, it } from "vitest";
import { formatCountdown, formatStopwatch } from "./formatTime";

describe("formatTime", () => {
	it("formats countdown as MM:SS", () => {
		expect(formatCountdown(0)).toBe("00:00");
		expect(formatCountdown(65_000)).toBe("01:05");
		expect(formatCountdown(3_661_000)).toBe("01:01:01");
	});

	it("formats stopwatch with centiseconds", () => {
		expect(formatStopwatch(0)).toBe("00:00.00");
		expect(formatStopwatch(1_234)).toBe("00:01.23");
		expect(formatStopwatch(61_050)).toBe("01:01.05");
	});
});
