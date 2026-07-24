import { describe, expect, it } from "vitest";
import {
	MAGIC_8_BALL_ANSWERS,
	pickMagic8BallAnswer,
} from "./magic8Ball";

describe("magic8Ball", () => {
	it("has the classic set of 20 answers", () => {
		expect(MAGIC_8_BALL_ANSWERS).toHaveLength(20);
		expect(MAGIC_8_BALL_ANSWERS).toContain("Yes");
		expect(MAGIC_8_BALL_ANSWERS).toContain("Ask again later");
		expect(MAGIC_8_BALL_ANSWERS).toContain("Outlook not so good");
		expect(MAGIC_8_BALL_ANSWERS).toContain("Signs point to yes");
	});

	it("pickMagic8BallAnswer returns a known answer", () => {
		const answer = pickMagic8BallAnswer(() => 0);
		expect(MAGIC_8_BALL_ANSWERS).toContain(answer);
		expect(answer).toBe(MAGIC_8_BALL_ANSWERS[0]);
	});

	it("pickMagic8BallAnswer uses the last index for high random values", () => {
		const answer = pickMagic8BallAnswer(() => 0.999);
		expect(answer).toBe(MAGIC_8_BALL_ANSWERS[MAGIC_8_BALL_ANSWERS.length - 1]);
	});
});
