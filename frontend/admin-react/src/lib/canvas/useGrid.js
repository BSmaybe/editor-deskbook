/**
 * useGrid — snap-to-grid state and helpers.
 *
 * Snap logic mirrors editor.js snapV(): when snap is on, round to nearest
 * multiple of gridSize. When Alt is held (altSnapOff), bypass snap.
 * When Shift is held (shiftFine), snap to gridSize/4 for fine placement.
 */

import { useCallback, useState } from 'react';

/**
 * @param {object} opts
 * @param {number}  opts.defaultSize    — default grid cell size in SVG user-units (default 10)
 * @param {boolean} opts.defaultVisible — grid visible by default (default true)
 * @param {boolean} opts.defaultSnap    — snap enabled by default (default true)
 */
export function useGrid({
  defaultSize = 10,
  defaultVisible = true,
  defaultSnap = true,
} = {}) {
  const [gridSize, setGridSize] = useState(defaultSize);
  const [gridVisible, setGridVisible] = useState(defaultVisible);
  const [snapOn, setSnapOn] = useState(defaultSnap);

  /**
   * Snap a single value to the grid.
   *
   * @param {number}  v          — raw value in SVG user-units
   * @param {object}  [opts]
   * @param {boolean} [opts.altSnapOff]  — if true, bypass snap (Alt key)
   * @param {boolean} [opts.shiftFine]   — if true, snap to gridSize/4 (Shift key)
   * @returns {number} snapped value
   */
  const snap = useCallback(
    (v, { altSnapOff = false, shiftFine = false } = {}) => {
      if (altSnapOff || !snapOn) return v;
      const step = Math.max(0.1, shiftFine ? gridSize / 4 : gridSize);
      return Math.round(v / step) * step;
    },
    [snapOn, gridSize],
  );

  /**
   * Snap both components of a point { x, y }.
   */
  const snapPoint = useCallback(
    ({ x, y }, opts = {}) => ({ x: snap(x, opts), y: snap(y, opts) }),
    [snap],
  );

  const toggleSnap = useCallback(() => setSnapOn((v) => !v), []);
  const toggleVisible = useCallback(() => setGridVisible((v) => !v), []);

  return {
    gridSize,
    setGridSize,
    gridVisible,
    setGridVisible,
    snapOn,
    setSnapOn,
    toggleSnap,
    toggleVisible,
    snap,
    snapPoint,
  };
}
