import * as pdfjsLib from "pdfjs-dist";

async function runBenchmark() {
  const data = new Uint8Array(100);
  const pdfDocument = {
    getOutline: async () => {
      const outline = [];
      for (let i = 0; i < 1000; i++) {
        outline.push({ title: `Bookmark ${i}`, dest: `dest_${i}` });
      }
      return outline;
    },
    getDestination: async (destObj) => {
      await new Promise(r => setTimeout(r, 1)); // simulate some async work
      return [destObj, "XYZ", null, null, null];
    },
    getPageIndex: async (destObj) => {
      await new Promise(r => setTimeout(r, 1)); // simulate some async work
      return parseInt(destObj.split("_")[1]);
    }
  };

  const outline = await pdfDocument.getOutline();

  const startSequential = performance.now();
  const loadedBookmarksSeq = [];
  for (const item of outline) {
    let pageNum = 1;
    if (item.dest) {
      let destObj: any = item.dest;
      if (typeof destObj === "string") {
        destObj = await pdfDocument.getDestination(destObj);
      }
      if (Array.isArray(destObj) && destObj[0]) {
        const pageIndex = await pdfDocument.getPageIndex(destObj[0]);
        pageNum = pageIndex + 1;
      }
    }
    loadedBookmarksSeq.push({ pageNum, name: item.title || "" });
  }
  const endSequential = performance.now();
  console.log(`Sequential time: ${endSequential - startSequential}ms`);

  const startParallel = performance.now();
  const loadedBookmarksPar = await Promise.all(
    outline.map(async (item) => {
      let pageNum = 1;
      if (item.dest) {
        let destObj: any = item.dest;
        if (typeof destObj === "string") {
          destObj = await pdfDocument.getDestination(destObj);
        }
        if (Array.isArray(destObj) && destObj[0]) {
          const pageIndex = await pdfDocument.getPageIndex(destObj[0]);
          pageNum = pageIndex + 1;
        }
      }
      return { pageNum, name: item.title || "" };
    })
  );
  const endParallel = performance.now();
  console.log(`Parallel time: ${endParallel - startParallel}ms`);
}

runBenchmark();
