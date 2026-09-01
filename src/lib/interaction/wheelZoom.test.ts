import { describe, expect, it, vi } from "vitest";
import { attachWindowWheelZoomGuard } from "./wheelZoom";

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
});
