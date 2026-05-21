import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGrid } from '../useGrid.js';

describe('useGrid — snap', () => {
  it('snaps to nearest grid step when snap is on', () => {
    const { result } = renderHook(() => useGrid({ defaultSize: 10 }));
    expect(result.current.snap(13)).toBe(10);
    expect(result.current.snap(16)).toBe(20);
    expect(result.current.snap(10)).toBe(10);
  });

  it('passes through value when snap is off', () => {
    const { result } = renderHook(() => useGrid({ defaultSize: 10, defaultSnap: false }));
    expect(result.current.snap(13)).toBe(13);
  });

  it('bypasses snap when altSnapOff is true', () => {
    const { result } = renderHook(() => useGrid({ defaultSize: 10 }));
    expect(result.current.snap(13, { altSnapOff: true })).toBe(13);
  });

  it('uses fine step (gridSize/4) when shiftFine is true', () => {
    const { result } = renderHook(() => useGrid({ defaultSize: 20 }));
    // step = 20/4 = 5 → 13 rounds to 15
    expect(result.current.snap(13, { shiftFine: true })).toBe(15);
  });

  it('snaps both x and y via snapPoint', () => {
    const { result } = renderHook(() => useGrid({ defaultSize: 10 }));
    const snapped = result.current.snapPoint({ x: 13, y: 27 });
    expect(snapped).toEqual({ x: 10, y: 30 });
  });
});

describe('useGrid — toggles', () => {
  it('toggleSnap flips snapOn', () => {
    const { result } = renderHook(() => useGrid());
    expect(result.current.snapOn).toBe(true);
    act(() => result.current.toggleSnap());
    expect(result.current.snapOn).toBe(false);
    act(() => result.current.toggleSnap());
    expect(result.current.snapOn).toBe(true);
  });

  it('toggleVisible flips gridVisible', () => {
    const { result } = renderHook(() => useGrid());
    expect(result.current.gridVisible).toBe(true);
    act(() => result.current.toggleVisible());
    expect(result.current.gridVisible).toBe(false);
  });
});
