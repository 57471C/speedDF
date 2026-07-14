import { PDFDocument, StandardFonts } from "pdf-lib";

async function runBenchmark() {
  const destDoc = await PDFDocument.create();

  const startUncached = performance.now();
  for (let i = 0; i < 1000; i++) {
    await destDoc.embedStandardFont(StandardFonts.Helvetica);
  }
  const endUncached = performance.now();
  console.log(`Uncached time: ${endUncached - startUncached}ms`);

  const destDoc2 = await PDFDocument.create();
  const fontCache = new Map();
  const startCached = performance.now();
  for (let i = 0; i < 1000; i++) {
    const fontKey = StandardFonts.Helvetica;
    let font = fontCache.get(fontKey);
    if (!font) {
      font = await destDoc2.embedStandardFont(fontKey);
      fontCache.set(fontKey, font);
    }
  }
  const endCached = performance.now();
  console.log(`Cached time: ${endCached - startCached}ms`);
}

runBenchmark();
