/**
 * useUndoRedo — generic state-snapshot undo/redo stack.
 *
 * Keeps two stacks (undo / redo). Callers call `push(snapshot)` before any
 * mutation; `undo()` restores the previous snapshot; `redo()` re-applies a
 * previously undone snapshot.
 *
 * Keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z) are wired via useEffect and
 * are active whenever `enabled` is true (default). Pass `enabled={false}`
 * when a text input has focus and you don't want the canvas to steal the
 * shortcut.
 *
 * @template T
 * @param {object} opts
 * @param {number}   opts.maxDepth  — max undo stack depth (default 30)
 * @param {boolean}  opts.enabled   — activate keyboard shortcuts (default true)
 * @param {Function} opts.onRestore — called with snapshot when undo/redo fires
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export function useUndoRedo({ maxDepth = 30, enabled = true, onRestore } = {}) {
  const [undoStack, setUndoStack] = useState(/** @type {T[]} */ ([]));
  const [redoStack, setRedoStack] = useState(/** @type {T[]} */ ([]));

  // Keep onRestore stable in event handler without re-registering
  const onRestoreRef = useRef(onRestore);
  useEffect(() => { onRestoreRef.current = onRestore; }, [onRestore]);

  /**
   * Push the current state snapshot onto the undo stack.
   * Clears the redo stack (any undo + new action kills redo history).
   *
   * @param {T} snapshot
   */
  const push = useCallback((snapshot) => {
    setUndoStack((prev) => {
      const next = [...prev, snapshot];
      return next.length > maxDepth ? next.slice(next.length - maxDepth) : next;
    });
    setRedoStack([]);
  }, [maxDepth]);

  /**
   * Undo: pop from undoStack, push current onto redoStack, restore snapshot.
   * Callers must provide `current` — the state to save on the redo stack.
   *
   * @param {T} current — the current state (to be pushed to redo)
   */
  const undo = useCallback((current) => {
    setUndoStack((uStack) => {
      if (!uStack.length) return uStack;
      const snapshot = uStack[uStack.length - 1];
      const nextUndo = uStack.slice(0, -1);
      setRedoStack((rStack) => [...rStack, current]);
      onRestoreRef.current?.(snapshot);
      return nextUndo;
    });
  }, []);

  /**
   * Redo: pop from redoStack, push current onto undoStack, restore snapshot.
   *
   * @param {T} current — the current state (to be pushed back onto undo)
   */
  const redo = useCallback((current) => {
    setRedoStack((rStack) => {
      if (!rStack.length) return rStack;
      const snapshot = rStack[rStack.length - 1];
      const nextRedo = rStack.slice(0, -1);
      setUndoStack((uStack) => [...uStack, current]);
      onRestoreRef.current?.(snapshot);
      return nextRedo;
    });
  }, []);

  /** Clear both stacks (e.g. after loading a new document). */
  const clear = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  /** Keyboard shortcut wiring — Ctrl+Z / Ctrl+Shift+Z */
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      // Don't steal shortcuts from text inputs
      const tag = e.target?.tagName?.toLowerCase?.();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        // Keyboard-driven undo: callers registered onRestore; we trigger it.
        // We don't have `current` here, so we use a sentinel — callers who
        // need redo support should call undo(current) imperatively instead.
        setUndoStack((uStack) => {
          if (!uStack.length) return uStack;
          const snapshot = uStack[uStack.length - 1];
          onRestoreRef.current?.(snapshot);
          return uStack.slice(0, -1);
        });
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        setRedoStack((rStack) => {
          if (!rStack.length) return rStack;
          const snapshot = rStack[rStack.length - 1];
          onRestoreRef.current?.(snapshot);
          return rStack.slice(0, -1);
        });
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);

  return {
    undoStack,
    redoStack,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    push,
    undo,
    redo,
    clear,
  };
}
