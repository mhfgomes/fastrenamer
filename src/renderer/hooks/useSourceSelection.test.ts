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

it('keeps the newer drop when an older resolution arrives last', async () => {
  const h = setup();
  const a = deferred<SourceSelection[]>(), b = deferred<SourceSelection[]>();
  h.resolveSources.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  let first!: Promise<void>, second!: Promise<void>;
  act(() => { first = h.result.current.handleDrop(event); second = h.result.current.handleDrop(event); });
  await act(async () => { b.resolve([source('/b')]); await second; });
  await act(async () => { a.resolve([source('/a')]); await first; });
  expect(h.result.current.sources.map(s => s.path)).toEqual(['/b']);
});

it.each(['clearSources', 'resetSources'] as const)('invalidates pending drops and pickers on %s', async action => {
  const h = setup();
  const drop = deferred<SourceSelection[]>(), pick = deferred<SourceSelection[]>();
  h.resolveSources.mockReturnValue(drop.promise);
  h.pickSources.mockReturnValue(pick.promise);
  act(() => h.result.current.openAddSources());
  act(() => h.result.current.dialog.onConfirm());
  let dropping!: Promise<void>;
  act(() => { dropping = h.result.current.handleDrop(event); });
  act(() => h.result.current[action]());
  await act(async () => { drop.resolve([source('/drop')]); pick.resolve([source('/pick')]); await dropping; });
  expect(h.result.current.sources).toEqual([]);
  expect(h.result.current.dialog.open).toBe(false);
});

it('ignores stale errors after a newer selection intent', async () => {
  const h = setup(), old = deferred<SourceSelection[]>();
  h.resolveSources.mockReturnValue(old.promise);
  let dropping!: Promise<void>;
  act(() => { dropping = h.result.current.handleDrop(event); });
  act(() => h.result.current.openAddSources());
  h.onError.mockClear();
  await act(async () => { old.reject(new Error('stale')); await dropping; });
  expect(h.onError).not.toHaveBeenCalled();
});

it('keeps a newer drop when an older native picker finishes', async () => {
  const h = setup(), pick = deferred<SourceSelection[]>();
  h.pickSources.mockReturnValue(pick.promise);
  act(() => h.result.current.openAddSources());
  act(() => h.result.current.dialog.onConfirm());
  h.resolveSources.mockResolvedValue([source('/new')]);
  await act(async () => { await h.result.current.handleDrop(event); });
  await act(async () => { pick.resolve([source('/old')]); await pick.promise; });
  expect(h.result.current.sources.map(s => s.path)).toEqual(['/new']);
});
