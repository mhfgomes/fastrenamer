// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PreviewResult, PreviewRow } from '@fastrenamer/rename-engine/types';
import { PreviewPanel } from './PreviewPanel';

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
// Exercise all rendered cells without depending on jsdom's absent viewport layout.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      index, key: index, start: index * 61, end: (index + 1) * 61,
    })),
    getTotalSize: () => count * 61,
    measureElement: () => {},
  }),
}));
afterEach(cleanup);
function row(sourcePath: string, nextPath: string): PreviewRow {
  return {
    id: sourcePath, sourcePath, nextPath, originalName: 'photo.jpg', proposedName: 'image.jpg',
    directoryPath: sourcePath.slice(0, sourcePath.lastIndexOf('/')),
    finalDirectoryPath: nextPath.slice(0, nextPath.lastIndexOf('/')),
    pathContext: '', isDirectory: false, changed: true, status: 'ok', reasons: [],
  };
}
it('distinguishes recursive duplicate basenames and exposes the final renamed parent path', () => {
  const preview: PreviewResult = {
    rows: [row('/photos/A/photo.jpg', '/photos/Renamed A/image.jpg'), row('/photos/B/photo.jpg', '/photos/B/image.jpg')],
    summary: { total: 2, changed: 2, ok: 2, conflict: 0, invalid: 0, unchanged: 0, blocked: false },
  };
  render(createElement(PreviewPanel, { preview, statusFilters: ['ok'], onToggleFilter: () => {} }));
  for (const item of preview.rows) {
    const original = screen.getByTitle(item.sourcePath);
    const proposed = screen.getByTitle(item.nextPath);
    expect(within(original).getByText(item.sourcePath)).toBeTruthy();
    expect(within(proposed).getByText(item.nextPath)).toBeTruthy();
    expect(original.closest('tr')).toBe(proposed.closest('tr'));
  }
});
