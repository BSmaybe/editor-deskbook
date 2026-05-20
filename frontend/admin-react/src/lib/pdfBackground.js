/**
 * pdfBackground — renders a PDF page to a PNG data URL using PDF.js.
 *
 * The worker URL is resolved via Vite's ?url import so no extra config is needed.
 */

import * as pdfjsLib from 'pdfjs-dist';

// Vite resolves ?url at build time — gives us the correct asset path.
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

/**
 * Load a PDF file (File object) and return:
 *   { dataUrl: string, totalPages: number, pdfData: Uint8Array }
 *
 * Renders the given page at 2× scale for crispness.
 */
export async function loadPdfPage(file, pageNum = 1, scale = 2) {
  const arrayBuffer = await file.arrayBuffer();
  const pdfData = new Uint8Array(arrayBuffer);
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  const dataUrl = await renderPage(pdf, pageNum, scale);
  return { dataUrl, totalPages: pdf.numPages, pdfData };
}

/**
 * Re-render a page from already-loaded raw PDF bytes.
 */
export async function renderPdfPage(pdfData, pageNum = 1, scale = 2) {
  const pdf = await pdfjsLib.getDocument({ data: pdfData.slice() }).promise;
  return renderPage(pdf, pageNum, scale);
}

async function renderPage(pdf, pageNum, scale) {
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
