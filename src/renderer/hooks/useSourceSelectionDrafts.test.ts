// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import type { DragEvent } from 'react';
import type { SourceSelection } from '@fastrenamer/rename-engine/types';
import { afterEach, expect, it, vi } from 'vitest';
import { useSourceSelection } from './useSourceSelection';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const source = (path: string): SourceSelection => ({ path, parentPath: '/', name: path, isDirectory: false });
const event = { preventDefault() {}, dataTransfer: { types: ['Files'], files: [] } } as unknown as DragEvent<HTMLElement>;
function setup() {
  const resolveSources = vi.fn();
  const pickSources = vi.fn();
  Object.assign(window, { advancedRenamer: { resolveSources, pickSources, getDroppedPaths: () => ['/a'] } });
  const onError = vi.fn();
  const hook = renderHook(() => useSourceSelection({ t: key => key, isLocked: () => false, onError }));
  return { ...hook, resolveSources, pickSources, onError };
}
afterEach(() => { cleanup(); localStorage.clear(); });

async function seed(h: ReturnType<typeof setup>) {
  h.resolveSources.mockResolvedValue([source('/a'), source('/b')]);
  await act(async () => { await h.result.current.handleDrop(event); });
  act(() => h.result.current.openAddSources());
  act(() => h.result.current.dialog.onRemoveSource('/a'));
}
it('discards draft removals when Cancel or Escape closes the dialog', async () => {
  const h = setup();
  await seed(h);
  expect(h.result.current.dialog.items.map(s => s.path)).toEqual(['/b']);
  expect(h.result.current.sources).toHaveLength(2);
  act(() => h.result.current.dialog.onOpenChange(false));
  act(() => h.result.current.openAddSources());
  expect(h.result.current.dialog.items.map(s => s.path)).toEqual(['/a', '/b']);
});
it('applies draft removals and settings only on explicit confirmation', async () => {
  const h = setup();
  await seed(h);
  act(() => h.result.current.dialog.onDraftSortModeChange('name_only'));
  act(() => h.result.current.dialog.onApply());
  expect(h.result.current.sources.map(s => s.path)).toEqual(['/b']);
  expect(h.result.current.sortMode).toBe('name_only');
  expect(h.result.current.dialog.open).toBe(false);
  expect(h.pickSources).not.toHaveBeenCalled();
});
it('allows confirming removal of every existing source', async () => {
  const h = setup();
  await seed(h);
  act(() => h.result.current.dialog.onRemoveSource('/b'));
  act(() => h.result.current.dialog.onApply());
  expect(h.result.current.sources).toEqual([]);
});
it('preserves committed sources and settings when the native picker is cancelled', async () => {
  const h = setup();
  await seed(h);
  h.pickSources.mockResolvedValue([]);
  act(() => h.result.current.dialog.onDraftSortModeChange('name_only'));
  await act(async () => { h.result.current.dialog.onConfirm(); });
  expect(h.result.current.sources.map(s => s.path)).toEqual(['/a', '/b']);
  expect(h.result.current.sortMode).toBe('natural_path');
});
it('commits a successful native replacement', async () => {
  const h = setup();
  await seed(h);
  h.pickSources.mockResolvedValue([source('/new')]);
  await act(async () => { h.result.current.dialog.onConfirm(); });
  expect(h.result.current.sources.map(s => s.path)).toEqual(['/new']);
});
