/**
 * Classic Magic 8 Ball answers (20 total).
 * Positive · Non-committal · Negative — original Mattel set.
 */

export const MAGIC_8_BALL_ANSWERS = [
	// Affirmative
	"It is certain",
	"It is decidedly so",
	"Without a doubt",
	"Yes definitely",
	"You may rely on it",
	"As I see it, yes",
	"Most likely",
	"Outlook good",
	"Yes",
	"Signs point to yes",
	// Non-committal
	"Reply hazy, try again",
	"Ask again later",
	"Better not tell you now",
	"Cannot predict now",
	"Concentrate and ask again",
	// Negative
	"Don't count on it",
	"My reply is no",
	"My sources say no",
	"Outlook not so good",
	"Very doubtful",
] as const;

export type Magic8BallAnswer = (typeof MAGIC_8_BALL_ANSWERS)[number];

/** Pick a random classic answer (uniform). */
export function pickMagic8BallAnswer(
	random: () => number = Math.random,
): Magic8BallAnswer {
	const i = Math.floor(random() * MAGIC_8_BALL_ANSWERS.length);
	const idx = Math.min(MAGIC_8_BALL_ANSWERS.length - 1, Math.max(0, i));
	return MAGIC_8_BALL_ANSWERS[idx];
}

/** How long the shake runs before the answer is revealed (ms). */
export const MAGIC_8_BALL_SHAKE_MS = 900;

/** Answer fade/wipe-in duration (ms) — keep in sync with CSS. */
export const MAGIC_8_BALL_REVEAL_MS = 450;
