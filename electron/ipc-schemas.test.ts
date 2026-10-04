import { describe, expect, it } from 'vitest';
import {
  deletePresetRequestSchema,
  executeRenameBatchRequestSchema,
  previewRequestSchema,
  pathListRequestSchema,
  renamePresetRequestSchema,
  savePresetRequestSchema,
} from '../src/shared/contracts';

describe('IPC request schemas', () => {
  it('validates path list requests', () => {
    expect(pathListRequestSchema.parse(['/tmp/a', '/tmp/b'])).toEqual(['/tmp/a', '/tmp/b']);
    expect(() => pathListRequestSchema.parse([])).toThrow();
    expect(() => pathListRequestSchema.parse([''])).toThrow();
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
