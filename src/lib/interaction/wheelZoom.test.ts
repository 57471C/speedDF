import { describe, expect, it, vi } from "vitest";
import {
	CTRL_WHEEL_GESTURE_MS,
	WORKSPACE_ZOOMING_CLASS,
	attachWindowWheelZoomGuard,
	createCtrlWheelOverflowLock,
	lockWebviewPageZoom,
} from "./wheelZoom";

describe("attachWindowWheelZoomGuard", () => {
	it("prevents default when ctrlKey is true", () => {
		const target = new EventTarget();
		const detach = attachWindowWheelZoomGuard(target);

		const event = new Event("wheel", { cancelable: true }) as any;
		event.ctrlKey = true;
		event.metaKey = false;
		const preventDefaultSpy = vi.spyOn(event, "preventDefault");

		target.dispatchEvent(event);

		expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);

		detach();
	});

	it("prevents default when metaKey (Cmd) is true", () => {
		const target = new EventTarget();
		const detach = attachWindowWheelZoomGuard(target);

		const event = new Event("wheel", { cancelable: true }) as any;
		event.ctrlKey = false;
		event.metaKey = true;
		const preventDefaultSpy = vi.spyOn(event, "preventDefault");

		target.dispatchEvent(event);

		expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);

		detach();
	});

	it("does not prevent default on plain wheel without Ctrl or Cmd", () => {
		const target = new EventTarget();
		const detach = attachWindowWheelZoomGuard(target);

		const event = new Event("wheel", { cancelable: true }) as any;
		event.ctrlKey = false;
		event.metaKey = false;
		const preventDefaultSpy = vi.spyOn(event, "preventDefault");

		target.dispatchEvent(event);

		expect(preventDefaultSpy).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);

		detach();
	});

	it("stops intercepting after detach is called", () => {
		const target = new EventTarget();
		const detach = attachWindowWheelZoomGuard(target);
		detach();

		const event = new Event("wheel", { cancelable: true }) as any;
		event.ctrlKey = true;
		event.metaKey = false;
		const preventDefaultSpy = vi.spyOn(event, "preventDefault");

		target.dispatchEvent(event);

		expect(preventDefaultSpy).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});

	it("safely handles null target", () => {
		expect(() => {
			const detach = attachWindowWheelZoomGuard(null);
			detach();
		}).not.toThrow();
	});

	it("prevents Safari pinch-magnify gesture events", () => {
		const target = new EventTarget();
		const detach = attachWindowWheelZoomGuard(target);

		for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
			const event = new Event(type, { cancelable: true });
			const preventDefaultSpy = vi.spyOn(event, "preventDefault");
			target.dispatchEvent(event);
			expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
			expect(event.defaultPrevented).toBe(true);
		}

		detach();
	});
});

describe("createCtrlWheelOverflowLock", () => {
	it("hides overflow and restores after the gesture idle timeout", () => {
		vi.useFakeTimers();
		const node = document.createElement("div");
		node.style.overflow = "auto";
		node.style.touchAction = "manipulation";

		const lock = createCtrlWheelOverflowLock(node, CTRL_WHEEL_GESTURE_MS);
		lock.hold();

		expect(node.style.overflow).toBe("hidden");
		expect(node.style.overflowAnchor).toBe("none");
		expect(node.style.touchAction).toBe("none");
		expect(node.classList.contains(WORKSPACE_ZOOMING_CLASS)).toBe(true);

		vi.advanceTimersByTime(CTRL_WHEEL_GESTURE_MS - 1);
		expect(node.style.overflow).toBe("hidden");

		vi.advanceTimersByTime(1);
		expect(node.style.overflow).toBe("auto");
		expect(node.style.touchAction).toBe("manipulation");
		expect(node.classList.contains(WORKSPACE_ZOOMING_CLASS)).toBe(false);

		lock.dispose();
		vi.useRealTimers();
	});

	it("resets the restore timer on repeated hold", () => {
		vi.useFakeTimers();
		const node = document.createElement("div");
		node.style.overflow = "auto";

		const lock = createCtrlWheelOverflowLock(node, 200);
		lock.hold();
		vi.advanceTimersByTime(150);
		lock.hold();
		vi.advanceTimersByTime(150);
		expect(node.style.overflow).toBe("hidden");
		vi.advanceTimersByTime(50);
		expect(node.style.overflow).toBe("auto");

		lock.dispose();
		vi.useRealTimers();
	});

	it("does not overwrite saved overflow on nested hold", () => {
		vi.useFakeTimers();
		const node = document.createElement("div");
		node.style.overflow = "auto";

		const lock = createCtrlWheelOverflowLock(node, 200);
		lock.hold();
		expect(node.style.overflow).toBe("hidden");
		lock.hold();
		vi.advanceTimersByTime(200);
		expect(node.style.overflow).toBe("auto");

		lock.dispose();
		vi.useRealTimers();
	});

	it("dispose restores immediately and cancels the timer", () => {
		vi.useFakeTimers();
		const node = document.createElement("div");
		node.style.overflow = "scroll";

		const lock = createCtrlWheelOverflowLock(node, 200);
		lock.hold();
		lock.dispose();
		expect(node.style.overflow).toBe("scroll");
		expect(node.classList.contains(WORKSPACE_ZOOMING_CLASS)).toBe(false);

		vi.advanceTimersByTime(200);
		expect(node.style.overflow).toBe("scroll");

		vi.useRealTimers();
	});
});

describe("lockWebviewPageZoom", () => {
	it("calls setZoom(1)", async () => {
		const setZoom = vi.fn().mockResolvedValue(undefined);
		await lockWebviewPageZoom(setZoom);
		expect(setZoom).toHaveBeenCalledTimes(1);
		expect(setZoom).toHaveBeenCalledWith(1);
	});

	it("swallows setZoom failures", async () => {
		const setZoom = vi.fn().mockRejectedValue(new Error("no webview"));
		await expect(lockWebviewPageZoom(setZoom)).resolves.toBeUndefined();
	});
});
