// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TopBar, type TopBarProps } from './TopBar';
import { getPresetTheme } from '../themes';
import { getSortModeMeta } from '../app/source-meta';

afterEach(cleanup);
const t: TopBarProps['t'] = key => key;
function props(): TopBarProps {
  return {
    platform: 'darwin', theme: getPresetTheme('dark')!, themes: [],
    windowState: { isMaximized: false }, sourceCount: 0, selectedLabel: '0',
    sortMode: 'natural_path', sortModeMeta: getSortModeMeta(t),
    preview: { rows: [], summary: { total: 0, changed: 0, ok: 0, invalid: 0, conflict: 0, unchanged: 0, blocked: false } },
    previewLoading: false, mutation: 'idle', renameDisabled: true, error: null,
    previewError: null, skippedDirectories: 0, undoDisabled: true, t,
    onOpenAddSources: vi.fn(), onClearSources: vi.fn(), onRefresh: vi.fn(),
    onExecute: vi.fn(), onUndo: vi.fn(), onOpenPresets: vi.fn(), onOpenHistory: vi.fn(),
    onOpenSettings: vi.fn(), onSelectTheme: vi.fn(), onChangeSortMode: vi.fn(),
    onMinimizeWindow: vi.fn(), onToggleMaximizeWindow: vi.fn(), onCloseWindow: vi.fn(),
  };
}
it('updates a persistent alert for independent action and preview errors', () => {
  const initial = props();
  const view = render(createElement(TopBar, initial));
  const alert = screen.getByRole('alert');
  expect(alert.textContent).toBe('');
  view.rerender(createElement(TopBar, { ...initial, error: 'Rename failed', previewError: 'Preview failed' }));
  expect(screen.getByRole('alert')).toBe(alert);
  expect(alert.textContent).toContain('Rename failed');
  expect(alert.textContent).toContain('Preview failed');
  expect(alert.getAttribute('aria-atomic')).toBe('true');
  view.rerender(createElement(TopBar, { ...initial, previewError: 'Preview failed' }));
  expect(alert.textContent).not.toContain('Rename failed');
  expect(alert.textContent).toContain('Preview failed');
  view.rerender(createElement(TopBar, initial));
  expect(alert.textContent).toBe('');
});
it('announces preview, rename and undo progress politely without remounting the region', () => {
  const initial = props();
  const view = render(createElement(TopBar, initial));
  const status = screen.getByRole('status');
  expect(status.getAttribute('aria-live')).toBe('polite');
  expect(status.getAttribute('aria-atomic')).toBe('true');
  expect(status.textContent).toBe('');
  for (const [mutation, previewLoading, message] of [
    ['idle', true, 'topbar.busy.preview'],
    ['execute', true, 'topbar.busy.execute'],
    ['undo', false, 'topbar.busy.undo'],
  ] as const) {
    view.rerender(createElement(TopBar, { ...initial, mutation, previewLoading }));
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toContain(message);
  }
  view.rerender(createElement(TopBar, initial));
  expect(status.textContent).toBe('');
});
