// Polyfill DOMMatrix for pdfjs-dist in JSDOM
class DOMMatrix {
	a = 1;
	b = 0;
	c = 0;
	d = 1;
	e = 0;
	f = 0;
}
(globalThis as typeof globalThis & { DOMMatrix: typeof DOMMatrix }).DOMMatrix =
	DOMMatrix;

class IntersectionObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}
(
	globalThis as typeof globalThis & {
		IntersectionObserver: typeof IntersectionObserver;
	}
).IntersectionObserver = IntersectionObserver;
