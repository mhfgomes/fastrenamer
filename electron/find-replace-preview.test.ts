import { expect, it } from 'vitest';
import { planPreview } from './preview-planner';

it('expands replacement tokens after filtering, sorting and earlier rules, using the approved clock', () => {
  const input = {
    items: ['photo2.jpg', 'photo1.jpg', 'photo0.txt'].map(name => ({
      sourcePath: `/pictures/${name}`, name, parentPath: '/pictures', isDirectory: false,
    })),
    rules: [
      { id: 'prefix', type: 'prefix_suffix' as const, enabled: true, prefix: 'pre_', suffix: '' },
      {
        id: 'replace', type: 'find_replace' as const, enabled: true, find: '^pre_photo(\\d+)$',
        replace: '$1_{seq_num:001}_{seq_letter}_{seq_letter_rev}_{original_stem}_{current_stem}_{parent}_{date}_{time}',
        matchCase: true, useRegex: true, replaceAll: true,
      },
    ],
    platform: 'linux' as const, sortMode: 'natural_path' as const,
    fileNamePattern: '*.jpg', now: new Date(2026, 9, 29, 11, 18, 35).getTime(),
  };
  const preview = planPreview(input);
  expect(preview.summary.blocked).toBe(false);
  expect(preview.rows.map(row => row.proposedName)).toEqual([
    '1_001_A_B_photo1_pre_photo1_pictures_2026-10-29_111835.jpg',
    '2_002_B_A_photo2_pre_photo2_pictures_2026-10-29_111835.jpg',
  ]);
  expect(planPreview(input)).toEqual(preview);
});
