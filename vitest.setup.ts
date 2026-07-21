import { beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';

// Polyfill DOMMatrix for pdfjs-dist in JSDOM
class DOMMatrix {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  constructor() {}
}
global.DOMMatrix = DOMMatrix as any;
class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.IntersectionObserver = IntersectionObserver as any;
