import { describe, expect, it } from 'vitest';
import {
  deletePresetRequestSchema,
  pathListRequestSchema,
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

  it('validates delete preset requests', () => {
    expect(deletePresetRequestSchema.parse(3)).toBe(3);
    expect(() => deletePresetRequestSchema.parse(0)).toThrow();
    expect(() => deletePresetRequestSchema.parse('1')).toThrow();
  });
});
