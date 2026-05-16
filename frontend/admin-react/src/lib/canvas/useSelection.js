/**
 * useSelection — selection state with single, shift-click, and marquee support.
 *
 * Selection is a Set of string IDs. Callers pass the full object list so
 * bounding-box and marquee intersection can be computed here.
 *
 * Marquee logic mirrors editor.js finishMarqueeSelection():
 * - if the drag rect is smaller than MARQUEE_MIN_WORLD_UNITS, treat as click
 * - otherwise collect all desks whose rects intersect the marquee rect
 */

import { useCallback, useMemo, useState } from 'react';

/** Minimum world-unit drag size before treating as a marquee vs. a click. */
const MARQUEE_MIN_WORLD = 4;

export function useSelection() {
  /** @type {[Set<string>, Function]} */
  const [selectedIds, setSelectedIds] = useState(new Set());

  /**
   * Marquee state while dragging.
   * null when no marquee active.
   * { start: {x,y}, current: {x,y}, append: boolean }
   */
  const [marquee, setMarquee] = useState(null);

  /* ── single / multi select ── */

  /** Replace selection with a single ID. */
  const selectOne = useCallback((id) => {
    setSelectedIds(new Set([id]));
  }, []);

  /** Toggle an ID in/out of the current selection (Shift+click behaviour). */
  const toggleId = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Add multiple IDs to the selection. */
  const addIds = useCallback((ids) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  /** Replace selection with an explicit set of IDs. */
  const selectIds = useCallback((ids) => {
    setSelectedIds(new Set(ids));
  }, []);

  /** Clear all selections. */
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  /**
   * Handle a click on a desk with optional Shift modifier.
   * Returns the new selection without mutating — callers use this to decide
   * whether to also start a drag.
   */
  const handleDeskClick = useCallback((id, { shiftKey = false } = {}) => {
    if (shiftKey) {
      toggleId(id);
    } else {
      selectOne(id);
    }
  }, [selectOne, toggleId]);

  /* ── marquee ── */

  /** Start a marquee drag at SVG-coord point {x,y}. */
  const startMarquee = useCallback((startPt, { append = false } = {}) => {
    setMarquee({ start: { ...startPt }, current: { ...startPt }, append });
  }, []);

  /** Update the rubber-band rectangle during drag. */
  const updateMarquee = useCallback((currentPt) => {
    setMarquee((prev) => prev ? { ...prev, current: { ...currentPt } } : null);
  }, []);

  /**
   * Finish the marquee and update selection.
   *
   * @param {Array<{id:string, x:number, y:number, w:number, h:number}>} desks
   *   All desks with their geometry — used for rect intersection.
   * @param {Function} [onClickMiss]
   *   Called if the marquee was actually a click on empty space.
   * @returns {{ isClick: boolean }}
   */
  const finishMarquee = useCallback((desks, { onClickMiss } = {}) => {
    setMarquee((prev) => {
      if (!prev) return null;
      const { start, current, append } = prev;

      const x1 = Math.min(start.x, current.x);
      const y1 = Math.min(start.y, current.y);
      const x2 = Math.max(start.x, current.x);
      const y2 = Math.max(start.y, current.y);

      const isClick = (x2 - x1) < MARQUEE_MIN_WORLD && (y2 - y1) < MARQUEE_MIN_WORLD;

      if (isClick) {
        if (!append) {
          setSelectedIds(new Set());
        }
        onClickMiss?.();
      } else {
        // Collect desks that intersect the marquee rectangle
        const hit = (desks || [])
          .filter((d) => !(d.x > x2 || d.x + (d.w || 0) < x1 || d.y > y2 || d.y + (d.h || 0) < y1))
          .map((d) => d.id);

        if (append) {
          setSelectedIds((old) => {
            const next = new Set(old);
            for (const id of hit) next.add(id);
            return next;
          });
        } else {
          setSelectedIds(new Set(hit));
        }
      }

      return null; // clear marquee
    });
  }, []);

  /** Cancel the marquee without changing selection. */
  const cancelMarquee = useCallback(() => {
    setMarquee(null);
  }, []);

  /* ── bounding box ── */

  /**
   * Compute the axis-aligned bounding box of the currently selected desks.
   *
   * @param {Array<{id:string, x:number, y:number, w:number, h:number}>} desks
   * @returns {{ x:number, y:number, w:number, h:number } | null}
   */
  const selectionBBox = useCallback((desks) => {
    if (!selectedIds.size) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const d of desks) {
      if (!selectedIds.has(d.id)) continue;
      const x = d.x || 0, y = d.y || 0;
      const w = d.w || 100, h = d.h || 60;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [selectedIds]);

  /* ── derived ── */

  /** Normalised marquee rect for rendering (always x1≤x2, y1≤y2). */
  const marqueeRect = useMemo(() => {
    if (!marquee) return null;
    return {
      x: Math.min(marquee.start.x, marquee.current.x),
      y: Math.min(marquee.start.y, marquee.current.y),
      w: Math.abs(marquee.current.x - marquee.start.x),
      h: Math.abs(marquee.current.y - marquee.start.y),
    };
  }, [marquee]);

  return {
    selectedIds,
    setSelectedIds,
    selectOne,
    toggleId,
    addIds,
    selectIds,
    clearSelection,
    handleDeskClick,
    marquee,
    marqueeRect,
    startMarquee,
    updateMarquee,
    finishMarquee,
    cancelMarquee,
    selectionBBox,
  };
}
