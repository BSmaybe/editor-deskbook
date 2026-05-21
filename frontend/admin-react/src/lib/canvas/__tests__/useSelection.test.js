import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelection } from '../useSelection.js';

describe('useSelection — selectOne / toggleId / clear', () => {
  it('selectOne replaces selection with a single id', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.selectOne('desk-1'));
    expect(result.current.selectedIds).toEqual(new Set(['desk-1']));
  });

  it('selectOne replaces a previous selection', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.selectOne('desk-1'));
    act(() => result.current.selectOne('desk-2'));
    expect(result.current.selectedIds).toEqual(new Set(['desk-2']));
  });

  it('toggleId adds an id when not present', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggleId('desk-1'));
    expect(result.current.selectedIds.has('desk-1')).toBe(true);
  });

  it('toggleId removes an id when already selected', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggleId('desk-1'));
    act(() => result.current.toggleId('desk-1'));
    expect(result.current.selectedIds.has('desk-1')).toBe(false);
  });

  it('clearSelection empties selectedIds', () => {
    const { result } = renderHook(() => useSelection());
    act(() => {
      result.current.selectOne('desk-1');
      result.current.toggleId('desk-2');
    });
    act(() => result.current.clearSelection());
    expect(result.current.selectedIds.size).toBe(0);
  });
});

describe('useSelection — handleDeskClick', () => {
  it('without shiftKey calls selectOne', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.handleDeskClick('desk-1'));
    expect(result.current.selectedIds).toEqual(new Set(['desk-1']));
  });

  it('with shiftKey toggles the id', () => {
    const { result } = renderHook(() => useSelection());
    // First select desk-1 normally
    act(() => result.current.selectOne('desk-1'));
    // Shift-click desk-2 → adds
    act(() => result.current.handleDeskClick('desk-2', { shiftKey: true }));
    expect(result.current.selectedIds.has('desk-1')).toBe(true);
    expect(result.current.selectedIds.has('desk-2')).toBe(true);
    // Shift-click desk-1 again → removes
    act(() => result.current.handleDeskClick('desk-1', { shiftKey: true }));
    expect(result.current.selectedIds.has('desk-1')).toBe(false);
  });
});

describe('useSelection — addIds / selectIds', () => {
  it('addIds merges into existing selection', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.selectOne('desk-1'));
    act(() => result.current.addIds(['desk-2', 'desk-3']));
    expect(result.current.selectedIds).toEqual(new Set(['desk-1', 'desk-2', 'desk-3']));
  });

  it('selectIds replaces selection with given array', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.selectOne('desk-1'));
    act(() => result.current.selectIds(['desk-2', 'desk-3']));
    expect(result.current.selectedIds).toEqual(new Set(['desk-2', 'desk-3']));
  });
});

describe('useSelection — finishMarquee', () => {
  const desks = [
    { id: 'desk-A', x: 10, y: 10, w: 50, h: 30 },
    { id: 'desk-B', x: 200, y: 200, w: 50, h: 30 },
  ];

  it('large marquee selects intersecting desks', () => {
    const { result } = renderHook(() => useSelection());
    // Start marquee at (0,0)
    act(() => result.current.startMarquee({ x: 0, y: 0 }));
    act(() => result.current.updateMarquee({ x: 100, y: 100 }));
    act(() => result.current.finishMarquee(desks));
    // desk-A is at (10,10)-(60,40) → inside rect (0,0)-(100,100)
    expect(result.current.selectedIds.has('desk-A')).toBe(true);
    // desk-B is at (200,200) → outside
    expect(result.current.selectedIds.has('desk-B')).toBe(false);
    // marquee cleared after finish
    expect(result.current.marquee).toBeNull();
  });

  it('tiny marquee (<4wu) treats as click-miss and calls onClickMiss', () => {
    const onClickMiss = vi.fn();
    const { result } = renderHook(() => useSelection());
    act(() => result.current.startMarquee({ x: 0, y: 0 }));
    act(() => result.current.updateMarquee({ x: 2, y: 2 })); // 2x2 < 4 threshold
    act(() => result.current.finishMarquee(desks, { onClickMiss }));
    expect(onClickMiss).toHaveBeenCalledOnce();
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('append mode adds to existing selection', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.selectOne('desk-B'));
    // marquee with append=true
    act(() => result.current.startMarquee({ x: 0, y: 0 }, { append: true }));
    act(() => result.current.updateMarquee({ x: 100, y: 100 }));
    act(() => result.current.finishMarquee(desks));
    expect(result.current.selectedIds.has('desk-A')).toBe(true);
    expect(result.current.selectedIds.has('desk-B')).toBe(true);
  });

  it('cancelMarquee clears marquee without changing selection', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.selectOne('desk-A'));
    act(() => result.current.startMarquee({ x: 0, y: 0 }));
    act(() => result.current.cancelMarquee());
    expect(result.current.marquee).toBeNull();
    expect(result.current.selectedIds).toEqual(new Set(['desk-A']));
  });
});

describe('useSelection — selectionBBox', () => {
  it('returns null when nothing selected', () => {
    const { result } = renderHook(() => useSelection());
    expect(result.current.selectionBBox([])).toBeNull();
  });

  it('returns bounding box of selected desks', () => {
    const desks = [
      { id: 'd1', x: 10, y: 20, w: 40, h: 30 },
      { id: 'd2', x: 100, y: 50, w: 60, h: 20 },
    ];
    const { result } = renderHook(() => useSelection());
    act(() => result.current.selectIds(['d1', 'd2']));
    const bbox = result.current.selectionBBox(desks);
    expect(bbox).toEqual({ x: 10, y: 20, w: 150, h: 50 });
  });
});
