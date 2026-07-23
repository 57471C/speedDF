/** Format milliseconds as HH:MM:SS or MM:SS.cs for stopwatch/timer displays. */

export function formatCountdown(totalMs: number): string {
	const ms = Math.max(0, Math.floor(totalMs));
	const totalSec = Math.floor(ms / 1000);
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	if (h > 0) {
		return `${pad(h)}:${pad(m)}:${pad(s)}`;
	}
	return `${pad(m)}:${pad(s)}`;
}

export function formatStopwatch(totalMs: number): string {
	const ms = Math.max(0, Math.floor(totalMs));
	const totalSec = Math.floor(ms / 1000);
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	const cs = Math.floor((ms % 1000) / 10);
	if (h > 0) {
		return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs)}`;
	}
	return `${pad(m)}:${pad(s)}.${pad(cs)}`;
}

function pad(n: number): string {
	return n.toString().padStart(2, "0");
}
