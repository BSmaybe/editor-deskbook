/**
 * useViewport — manages SVG viewBox state with pan/zoom.
 *
 * The canonical approach (matching editor.js) is to drive the SVG's viewBox
 * attribute directly rather than CSS transform. This ensures that
 * svg.getScreenCTM() is always accurate and pointer coordinates returned by
 * screenToSvg() are correct regardless of any CSS applied to the container.
 *
 * Pan:  middle-click drag  OR  Space + left-click drag
 * Zoom: mouse-wheel, centered on cursor
 */

import { useCallback, useRef, useState } from 'react';

const MIN_ZOOM = 0.05;  // viewBox cannot grow more than 20× the content
const MAX_ZOOM = 20;    // viewBox cannot shrink more than 20× the content

/**
 * @param {object} opts
 * @param {number} opts.contentW  — logical canvas width  (default 1200)
 * @param {number} opts.contentH  — logical canvas height (default 800)
 */
export function useViewport({ contentW = 1200, contentH = 800 } = {}) {
  // viewBox in SVG-user-unit space
  const [vb, setVb] = useState({ x: 0, y: 0, w: contentW, h: contentH });

  // Current zoom level relative to 1:1 (content px = screen px).
  // Derived from the viewBox when needed — stored separately so the toolbar
  // can display it without recalculating from the SVG element size.
  const [zoom, setZoom] = useState(1);

  // Ref to the <svg> element — callers assign via `svgRef`.
  const svgRef = useRef(null);

  // Internal pan state for pointer-based panning
  const panRef = useRef(null); // { startSvgPt, startVb }

  /* ── helpers ── */

  /**
   * Convert a mouse/pointer event to SVG user-unit coordinates.
   * Uses getScreenCTM() exactly as editor.js svgPt() does.
   */
  const screenToSvg = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const p = pt.matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    }
    // Fallback
    const r = svg.getBoundingClientRect();
    return {
      x: vb.x + ((e.clientX - r.left) / r.width) * vb.w,
      y: vb.y + ((e.clientY - r.top) / r.height) * vb.h,
    };
  }, [vb]);

  /**
   * Convert an SVG user-unit point back to screen pixels.
   */
  const svgToScreen = useCallback(({ x, y }) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const pt = svg.createSVGPoint();
      pt.x = x;
      pt.y = y;
      const p = pt.matrixTransform(ctm);
      return { x: p.x, y: p.y };
    }
    const r = svg.getBoundingClientRect();
    return {
      x: r.left + ((x - vb.x) / vb.w) * r.width,
      y: r.top + ((y - vb.y) / vb.h) * r.height,
    };
  }, [vb]);

  /**
   * How many SVG user-units correspond to `px` screen pixels at current zoom.
   * Mirrors editor.js worldUnitsForScreenPx().
   */
  const worldUnitsForPx = useCallback((px) => {
    const svg = svgRef.current;
    if (!svg || !Number.isFinite(px) || px <= 0) return px;
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const sx = Math.hypot(ctm.a, ctm.b);
      const sy = Math.hypot(ctm.c, ctm.d);
      const scale = (sx + sy) / 2;
      if (scale > 0) return px / scale;
    }
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return px;
    return px * (vb.w / rect.width);
  }, [vb]);

  /* ── internal setVb with zoom sync ── */
  const _applyVb = useCallback((nextVb) => {
    setVb(nextVb);
    // Zoom = ratio of content logical width to viewBox width
    setZoom(contentW / Math.max(1, nextVb.w));
  }, [contentW]);

  /* ── zoom ── */

  /**
   * Zoom by a multiplicative factor, keeping `cx, cy` (SVG coords) fixed.
   * factor > 1 = zoom in (viewBox shrinks), factor < 1 = zoom out.
   */
  const zoomBy = useCallback((factor, cx, cy) => {
    setVb((prev) => {
      const pcx = cx ?? prev.x + prev.w / 2;
      const pcy = cy ?? prev.y + prev.h / 2;
      const nw = prev.w * factor;
      const nh = prev.h * factor;
      // Clamp relative to content size
      const minW = contentW / MAX_ZOOM;
      const maxW = contentW / MIN_ZOOM;
      if (nw < minW || nw > maxW) return prev;
      const nx = pcx - (pcx - prev.x) * (nw / prev.w);
      const ny = pcy - (pcy - prev.y) * (nh / prev.h);
      const next = { x: nx, y: ny, w: nw, h: nh };
      // Keep zoom state in sync
      setZoom(contentW / Math.max(1, nw));
      return next;
    });
  }, [contentW]);

  /**
   * Wheel event handler. Attach to the SVG element with `{ passive: false }`.
   */
  const onWheel = useCallback((e) => {
    e.preventDefault();

    // Pinch-zoom on trackpad sends ctrlKey + deltaY
    if (e.ctrlKey) {
      const pt = screenToSvg(e);
      const rawDelta = Number.isFinite(e.deltaY) ? e.deltaY : 0;
      const delta = Math.max(-120, Math.min(120, rawDelta));
      const factor = Math.exp(delta * 0.00075);
      zoomBy(factor, pt.x, pt.y);
      return;
    }

    const dx = Number.isFinite(e.deltaX) ? e.deltaX : 0;
    const dy = Number.isFinite(e.deltaY) ? e.deltaY : 0;

    // Two-finger swipe or Shift+wheel → pan
    if (Math.abs(dx) > 0 || e.shiftKey) {
      setVb((prev) => {
        const scale = prev.w / (svgRef.current?.clientWidth || 1);
        return {
          ...prev,
          x: prev.x + (e.shiftKey ? dy : dx) * scale,
          y: prev.y + (e.shiftKey ? 0 : dy) * scale,
        };
      });
      return;
    }

    // Plain scroll wheel → zoom
    const pt = screenToSvg(e);
    const delta = Math.max(-120, Math.min(120, dy));
    const factor = Math.exp(delta * 0.00115);
    zoomBy(factor, pt.x, pt.y);
  }, [screenToSvg, zoomBy]);

  /* ── pan ── */

  /**
   * Begin a pan gesture. Call on middle-click-down or Space+left-click-down.
   * Returns true if the event was consumed.
   */
  const startPan = useCallback((e) => {
    const svgPt = screenToSvg(e);
    setVb((prev) => {
      panRef.current = { startSvgPt: svgPt, startVb: { ...prev } };
      return prev;
    });
    return true;
  }, [screenToSvg]);

  /**
   * Update pan on pointer move. Call when a pan is active.
   */
  const updatePan = useCallback((e) => {
    if (!panRef.current) return;
    const { startSvgPt, startVb } = panRef.current;
    // We want the SVG point under the cursor to stay fixed.
    // The pointer is at screen position e.clientX/Y, which in SVG coords
    // should equal startSvgPt. Delta in SVG coords:
    const svg = svgRef.current;
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    // Map to SVG space using the ORIGINAL CTM captured at pan start
    // (equivalent to editor.js: dx = pt.x - panStart.svgPt.x)
    // Since CTM changes as viewBox changes, we recompute in world space:
    const dx = startSvgPt.x - pt.matrixTransform(ctm.inverse()).x;
    const dy = startSvgPt.y - pt.matrixTransform(ctm.inverse()).y;
    setVb({ ...startVb, x: startVb.x + dx, y: startVb.y + dy });
  }, []);

  /**
   * End a pan gesture.
   */
  const endPan = useCallback(() => {
    panRef.current = null;
  }, []);

  /* ── zoom to fit ── */

  /**
   * Fit a bounding rect { x, y, w, h } into the viewport with padding.
   * If no rect given, fits the full content.
   */
  const zoomToFit = useCallback((rect, padding = 40) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const vw = r.width || contentW;
    const vh = r.height || contentH;

    const tx = rect ? rect.x : 0;
    const ty = rect ? rect.y : 0;
    const tw = rect ? rect.w : contentW;
    const th = rect ? rect.h : contentH;

    if (!tw || !th) return;

    const viewportRatio = vw / vh;
    const targetRatio = tw / th;
    let viewW = tw + padding * 2;
    let viewH = th + padding * 2;
    if (targetRatio > viewportRatio) {
      viewH = viewW / viewportRatio;
    } else {
      viewW = viewH * viewportRatio;
    }

    const cx = tx + tw / 2;
    const cy = ty + th / 2;
    const next = { x: cx - viewW / 2, y: cy - viewH / 2, w: viewW, h: viewH };
    _applyVb(next);
  }, [contentW, contentH, _applyVb]);

  /**
   * Reset to 1:1 zoom, centered on content.
   */
  const zoomTo100 = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const vw = r.width || contentW;
    const vh = r.height || contentH;
    // At 1:1, viewBox dimensions equal the viewport pixel dimensions
    const next = {
      x: contentW / 2 - vw / 2,
      y: contentH / 2 - vh / 2,
      w: vw,
      h: vh,
    };
    _applyVb(next);
  }, [contentW, contentH, _applyVb]);

  const panTo = useCallback((x, y) => {
    _applyVb({ x: x - vb.w / 2, y: y - vb.h / 2, w: vb.w, h: vb.h });
  }, [vb, _applyVb]);

  /* ── viewBox string for the SVG attribute ── */
  const viewBoxAttr = `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;

  return {
    vb,
    zoom,
    viewBoxAttr,
    svgRef,
    screenToSvg,
    svgToScreen,
    worldUnitsForPx,
    zoomBy,
    zoomToFit,
    zoomTo100,
    onWheel,
    panTo,
    startPan,
    updatePan,
    endPan,
  };
}
