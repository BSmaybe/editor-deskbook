/**
 * pdfBackground — renders a PDF page to a PNG data URL using PDF.js.
 *
 * Dynamically imports pdfjs-dist so it is not bundled upfront (~2 MB).
 * The worker URL is resolved via Vite's ?url import so no extra config is needed.
 */

// Vite resolves ?url at build time — gives us the correct asset path.
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let _pdfjsLib = null;

async function getPdfjsLib() {
  if (_pdfjsLib) return _pdfjsLib;
  const lib = await import('pdfjs-dist');
  lib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
  _pdfjsLib = lib;
  return lib;
}

/**
 * Load a PDF file (File object) and return:
 *   { dataUrl: string, totalPages: number, pdfData: Uint8Array }
 *
 * Renders the given page at 2× scale for crispness.
 */
export async function loadPdfPage(file, pageNum = 1, scale = 2) {
  const lib = await getPdfjsLib();
  const arrayBuffer = await file.arrayBuffer();
  const pdfData = new Uint8Array(arrayBuffer);
  const pdf = await lib.getDocument({ data: pdfData }).promise;
  const dataUrl = await renderPage(lib, pdf, pageNum, scale);
  return { dataUrl, totalPages: pdf.numPages, pdfData };
}

/**
 * Re-render a page from already-loaded raw PDF bytes.
 */
export async function renderPdfPage(pdfData, pageNum = 1, scale = 2) {
  const lib = await getPdfjsLib();
  const pdf = await lib.getDocument({ data: pdfData.slice() }).promise;
  return renderPage(lib, pdf, pageNum, scale);
}

async function renderPage(_lib, pdf, pageNum, scale) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/png');
}
