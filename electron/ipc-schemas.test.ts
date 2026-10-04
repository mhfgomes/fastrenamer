import { describe, expect, it } from 'vitest';
import {
  deletePresetRequestSchema,
  executeRenameBatchRequestSchema,
  exportPresetRequestSchema,
  isAbsolutePathForPlatform,
  pathListRequestSchema,
  previewRequestSchema,
  renamePresetRequestSchema,
  savePresetRequestSchema,
} from '../src/shared/contracts';

const absolutePath = process.platform === 'win32' ? 'C:\\tmp\\a' : '/tmp/a';

describe('IPC request schemas', () => {
  it('validates path list requests', () => {
    expect(pathListRequestSchema.parse(['/tmp/a', '/tmp/b'])).toEqual(['/tmp/a', '/tmp/b']);
    expect(() => pathListRequestSchema.parse([])).toThrow();
    expect(() => pathListRequestSchema.parse([''])).toThrow();
  });

  it('rejects relative paths and NUL bytes in path lists', () => {
    expect(pathListRequestSchema.parse([absolutePath])).toEqual([absolutePath]);
    expect(() => pathListRequestSchema.parse(['relative/path'])).toThrow();
    expect(() => pathListRequestSchema.parse(['./a'])).toThrow();
    expect(() => pathListRequestSchema.parse(['../a'])).toThrow();
    expect(() => pathListRequestSchema.parse([`${absolutePath}\0evil`])).toThrow();
  });

  it('requires absolute source paths in preview requests', () => {
    const request = {
      sourcePaths: [absolutePath],
      sourceMode: 'picked_files',
      fileNamePattern: '',
      sortMode: 'alphabetic_path',
      rules: [],
      platform: 'darwin',
    };
    expect(previewRequestSchema.parse(request).sourcePaths).toEqual([absolutePath]);
    expect(() => previewRequestSchema.parse({ ...request, sourcePaths: ['a.txt'] })).toThrow();
    expect(() => previewRequestSchema.parse({ ...request, sourcePaths: [''] })).toThrow();
  });

  it('detects absolute paths per platform', () => {
    expect(isAbsolutePathForPlatform('/Users/me', 'darwin')).toBe(true);
    expect(isAbsolutePathForPlatform('C:\\Users\\me', 'darwin')).toBe(false);
    expect(isAbsolutePathForPlatform('C:\\Users\\me', 'win32')).toBe(true);
    expect(isAbsolutePathForPlatform('c:/Users/me', 'win32')).toBe(true);
    expect(isAbsolutePathForPlatform('\\\\server\\share\\file', 'win32')).toBe(true);
    expect(isAbsolutePathForPlatform('\\\\?\\C:\\long', 'win32')).toBe(true);
    expect(isAbsolutePathForPlatform('/Users/me', 'win32')).toBe(false);
    expect(isAbsolutePathForPlatform('C:relative', 'win32')).toBe(false);
    expect(isAbsolutePathForPlatform('relative', 'linux')).toBe(false);
  });

  it('validates export preset requests', () => {
    expect(exportPresetRequestSchema.parse(2)).toBe(2);
    expect(() => exportPresetRequestSchema.parse('2')).toThrow();
    expect(() => exportPresetRequestSchema.parse(-1)).toThrow();
    expect(() => exportPresetRequestSchema.parse(1.5)).toThrow();
  });

  it('validates save preset requests', () => {
    const preset = savePresetRequestSchema.parse({
      name: 'My preset',
      rules: [{ id: 'rule-1', type: 'trim_text', enabled: true, mode: 'trim' }],
    });
    expect(preset.name).toBe('My preset');

    expect(() => savePresetRequestSchema.parse({ name: '   ', rules: [] })).toThrow();
  });

  it('validates rename preset requests', () => {
    expect(renamePresetRequestSchema.parse({ id: 2, name: '  New name ' })).toEqual({ id: 2, name: 'New name' });
    expect(() => renamePresetRequestSchema.parse({ id: 2, name: '   ' })).toThrow();
    expect(() => renamePresetRequestSchema.parse({ id: 0, name: 'x' })).toThrow();
    expect(() => renamePresetRequestSchema.parse({ name: 'x' })).toThrow();
  });

  it('validates delete preset requests', () => {
    expect(deletePresetRequestSchema.parse(3)).toBe(3);
    expect(() => deletePresetRequestSchema.parse(0)).toThrow();
    expect(() => deletePresetRequestSchema.parse('1')).toThrow();
  });

  it('accepts preview requests without platform and with includeHidden', () => {
    const base = { sourcePaths: ['/tmp/a'], sourceMode: 'files_recursive', fileNamePattern: '', sortMode: 'natural_path', rules: [] };
    expect(previewRequestSchema.parse(base).includeHidden).toBeUndefined();
    expect(previewRequestSchema.parse({ ...base, platform: 'win32', includeHidden: true }).includeHidden).toBe(true);
    expect(() => previewRequestSchema.parse({ ...base, includeHidden: 'yes' })).toThrow();
  });

  it('requires the approved planId on execute', () => {
    const base = { sourcePaths: ['/tmp/a'], sourceMode: 'picked_files', fileNamePattern: '', sortMode: 'natural_path', rules: [] };
    expect(() => executeRenameBatchRequestSchema.parse(base)).toThrow();
    expect(() => executeRenameBatchRequestSchema.parse({ ...base, planId: 'abc' })).toThrow();
    expect(executeRenameBatchRequestSchema.parse({ ...base, planId: 'a'.repeat(64) }).planId).toBe('a'.repeat(64));
  });
});
