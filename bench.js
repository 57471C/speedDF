const processBatch = async (outline, pdfDocument) => {
  const loadedBookmarks = [];
  for (const item of outline) {
    let pageNum = 1;
    if (item.dest) {
      let destObj = item.dest;
      if (typeof destObj === 'string') {
        destObj = await pdfDocument.getDestination(destObj);
      }
      if (Array.isArray(destObj) && destObj[0]) {
        const pageIndex = await pdfDocument.getPageIndex(destObj[0]);
        pageNum = pageIndex + 1;
      }
    }
    loadedBookmarks.push({ pageNum, name: item.title || "" });
  }
  return loadedBookmarks;
}

const processBatchOptimized = async (outline, pdfDocument) => {
  const loadedBookmarks = [];
  const BATCH_SIZE = 50;
  for (let i = 0; i < outline.length; i += BATCH_SIZE) {
    const batch = outline.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (item) => {
      let pageNum = 1;
      if (item.dest) {
        let destObj = item.dest;
        if (typeof destObj === 'string') {
          destObj = await pdfDocument.getDestination(destObj);
        }
        if (Array.isArray(destObj) && destObj[0]) {
          const pageIndex = await pdfDocument.getPageIndex(destObj[0]);
          pageNum = pageIndex + 1;
        }
      }
      return { pageNum, name: item.title || "" };
    }));
    loadedBookmarks.push(...results);
  }
  return loadedBookmarks;
}

const mockPdfDoc = {
  getDestination: async (id) => {
    await new Promise(r => setTimeout(r, 1));
    return [id, 'XYZ'];
  },
  getPageIndex: async (ref) => {
    await new Promise(r => setTimeout(r, 1));
    return 5;
  }
};

const outline = Array.from({length: 200}, (_, i) => ({
  title: `Bookmark ${i}`,
  dest: `dest_${i}`
}));

(async () => {
  console.time('Sequential');
  await processBatch(outline, mockPdfDoc);
  console.timeEnd('Sequential');

  console.time('Optimized');
  await processBatchOptimized(outline, mockPdfDoc);
  console.timeEnd('Optimized');
})();
