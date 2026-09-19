import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PreviewRequest } from '@fast-renamer/rename-engine';
import { generatePreviewForRequest } from './rename-service';

describe('generatePreviewForRequest source modes', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-renamer-sources-'));

    await fs.mkdir(path.join(tempRoot, 'Folder A', 'Sub A1'), { recursive: true });
    await fs.mkdir(path.join(tempRoot, 'Folder B', 'Nested', 'Deep'), { recursive: true });
    await fs.writeFile(path.join(tempRoot, 'top-one.tif'), 'a');
    await fs.writeFile(path.join(tempRoot, 'top-two.jpg'), 'b');
    await fs.writeFile(path.join(tempRoot, 'Folder A', 'inside-a.tif'), 'c');
    await fs.writeFile(path.join(tempRoot, 'Folder A', 'inside-a.txt'), 'd');
    await fs.writeFile(path.join(tempRoot, 'Folder A', 'Sub A1', 'nested-a.tif'), 'e');
    await fs.writeFile(path.join(tempRoot, 'Folder B', 'Nested', 'Deep', 'nested-b.tif'), 'f');
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  function baseRequest(overrides: Partial<PreviewRequest>): PreviewRequest {
    return {
      sourcePaths: [tempRoot],
      sourceMode: 'top_level_files',
      fileNamePattern: '',
      sortMode: 'natural_path',
      rules: [],
      platform: 'linux',
      ...overrides,
    };
  }

  it('filters top-level files with glob patterns', async () => {
    const preview = await generatePreviewForRequest(
      baseRequest({
        sourceMode: 'top_level_files',
        fileNamePattern: '*.tif',
      }),
    );

    expect(preview.rows.map((row) => row.originalName)).toEqual(['top-one.tif']);
  });

  it('collects files recursively with filters', async () => {
    const preview = await generatePreviewForRequest(
      baseRequest({
        sourceMode: 'files_recursive',
        fileNamePattern: '*.tif',
      }),
    );

    expect(preview.rows.map((row) => row.originalName)).toEqual([
      'inside-a.tif',
      'nested-a.tif',
      'nested-b.tif',
      'top-one.tif',
    ]);
  });

  it('collects only direct child folders for top-level folder mode', async () => {
    const preview = await generatePreviewForRequest(
      baseRequest({
        sourceMode: 'top_level_folders',
      }),
    );

    expect(preview.rows.map((row) => row.originalName)).toEqual(['Folder A', 'Folder B']);
    expect(preview.rows.every((row) => row.isDirectory)).toBe(true);
  });

  it('collects picked folders directly for folder renaming', async () => {
    const preview = await generatePreviewForRequest(
      baseRequest({
        sourcePaths: [path.join(tempRoot, 'Folder A'), path.join(tempRoot, 'Folder B')],
        sourceMode: 'picked_folders',
      }),
    );

    expect(preview.rows.map((row) => row.originalName)).toEqual(['Folder A', 'Folder B']);
    expect(preview.rows.every((row) => row.isDirectory)).toBe(true);
  });

  it('collects only nested folders for subfolder mode', async () => {
    const preview = await generatePreviewForRequest(
      baseRequest({
        sourceMode: 'subfolders',
      }),
    );

    expect(preview.rows.map((row) => row.originalName)).toEqual(['Sub A1', 'Nested', 'Deep']);
    expect(preview.rows.every((row) => row.isDirectory)).toBe(true);
  });

  it('respects custom sort modes in preview row order', async () => {
    const preview = await generatePreviewForRequest(
      baseRequest({
        sourceMode: 'files_recursive',
        sortMode: 'name_only',
      }),
    );

    expect(preview.rows.map((row) => row.originalName)).toEqual([
      'inside-a.tif',
      'inside-a.txt',
      'nested-a.tif',
      'nested-b.tif',
      'top-one.tif',
      'top-two.jpg',
    ]);
  });

  it('uses alphabetic path sorting when requested', async () => {
    await fs.writeFile(path.join(tempRoot, 'file2.txt'), 'two');
    await fs.writeFile(path.join(tempRoot, 'file10.txt'), 'ten');

    const preview = await generatePreviewForRequest(
      baseRequest({
        sourceMode: 'top_level_files',
        fileNamePattern: '*.txt',
        sortMode: 'alphabetic_path',
      }),
    );

    expect(preview.rows.map((row) => row.originalName)).toEqual(['file10.txt', 'file2.txt']);
  });
});
