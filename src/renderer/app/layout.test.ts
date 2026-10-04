import { describe, expect, it } from 'vitest';
import { clampLeftWidthRatio, readStoredLeftWidthRatio } from './layout';
import { DEFAULT_LEFT_WIDTH_RATIO, MAX_LEFT_WIDTH_RATIO, MIN_LEFT_PANEL_WIDTH_PX } from './defaults';

describe('clampLeftWidthRatio', () => {
  it('caps the rules panel at MAX_LEFT_WIDTH_RATIO on wide containers', () => {
    expect(clampLeftWidthRatio(0.9, 2000)).toBe(MAX_LEFT_WIDTH_RATIO);
  });

  it('keeps the minimum pixel width', () => {
    expect(clampLeftWidthRatio(0.05, 2000)).toBeCloseTo(MIN_LEFT_PANEL_WIDTH_PX / 2000);
  });

  it('lets the minimum win on narrow containers', () => {
    expect(clampLeftWidthRatio(0.9, 600)).toBeCloseTo(MIN_LEFT_PANEL_WIDTH_PX / 600);
  });

  it('passes through values inside the range', () => {
    expect(clampLeftWidthRatio(0.3, 2000)).toBe(0.3);
  });
});

describe('readStoredLeftWidthRatio', () => {
  it('uses the default ratio on first launch', () => {
    expect(readStoredLeftWidthRatio(null, 2000)).toBe(DEFAULT_LEFT_WIDTH_RATIO);
    expect(readStoredLeftWidthRatio('', 2000)).toBe(DEFAULT_LEFT_WIDTH_RATIO);
    expect(readStoredLeftWidthRatio('nope', 2000)).toBe(DEFAULT_LEFT_WIDTH_RATIO);
  });

  it('migrates legacy pixel widths', () => {
    expect(readStoredLeftWidthRatio('600', 2000)).toBeCloseTo(0.3);
  });

  it('reads stored ratios', () => {
    expect(readStoredLeftWidthRatio('0.35', 2000)).toBe(0.35);
  });
});
