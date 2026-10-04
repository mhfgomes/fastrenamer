import { describe, expect, it } from 'vitest';
import { parseIntegerInput } from './RulesPanel';

describe('parseIntegerInput', () => {
  it('accepts whole numbers', () => {
    expect(parseIntegerInput('12')).toBe(12);
    expect(parseIntegerInput(' -3 ')).toBe(-3);
    expect(parseIntegerInput('0', 0)).toBe(0);
  });

  it('rejects empty, decimal and out-of-range text', () => {
    expect(parseIntegerInput('')).toBeNull();
    expect(parseIntegerInput('1.5')).toBeNull();
    expect(parseIntegerInput('1e3')).toBeNull();
    expect(parseIntegerInput('-1', 0)).toBeNull();
    expect(parseIntegerInput('0', 1)).toBeNull();
  });
});
