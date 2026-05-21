import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUndoRedo } from '../useUndoRedo.js';

describe('useUndoRedo — push', () => {
  it('push adds to undo stack', () => {
    const { result } = renderHook(() => useUndoRedo({ enabled: false }));
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.push({ state: 'a' }));
    expect(result.current.canUndo).toBe(true);
  });

  it('push clears redo stack', () => {
    const onRestore = vi.fn();
    const { result } = renderHook(() => useUndoRedo({ enabled: false, onRestore }));
    act(() => result.current.push({ state: 'a' }));
    act(() => result.current.undo({ state: 'b' }));
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.push({ state: 'c' }));
    expect(result.current.canRedo).toBe(false);
  });

  it('respects maxDepth', () => {
    const { result } = renderHook(() => useUndoRedo({ maxDepth: 3, enabled: false }));
    act(() => {
      result.current.push('a');
      result.current.push('b');
      result.current.push('c');
      result.current.push('d'); // should drop 'a'
    });
    expect(result.current.undoStack.length).toBe(3);
    expect(result.current.undoStack[0]).toBe('b');
  });
});

describe('useUndoRedo — undo / redo', () => {
  it('undo calls onRestore with last snapshot', () => {
    const onRestore = vi.fn();
    const { result } = renderHook(() => useUndoRedo({ enabled: false, onRestore }));
    act(() => result.current.push({ state: 'snap1' }));
    act(() => result.current.undo({ state: 'current' }));
    expect(onRestore).toHaveBeenCalledWith({ state: 'snap1' });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it('redo calls onRestore with redo snapshot', () => {
    const onRestore = vi.fn();
    const { result } = renderHook(() => useUndoRedo({ enabled: false, onRestore }));
    act(() => result.current.push({ state: 'snap1' }));
    act(() => result.current.undo({ state: 'current' }));
    act(() => result.current.redo({ state: 'afterUndo' }));
    // onRestore called twice — first with snap1 (undo), then with current (redo)
    expect(onRestore).toHaveBeenCalledTimes(2);
    expect(result.current.canRedo).toBe(false);
  });

  it('undo does nothing when stack is empty', () => {
    const onRestore = vi.fn();
    const { result } = renderHook(() => useUndoRedo({ enabled: false, onRestore }));
    act(() => result.current.undo({ state: 'x' }));
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('clear empties both stacks', () => {
    const { result } = renderHook(() => useUndoRedo({ enabled: false }));
    act(() => {
      result.current.push('a');
      result.current.push('b');
    });
    act(() => result.current.clear());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });
});
