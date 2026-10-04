import {
  DEFAULT_LEFT_WIDTH_RATIO,
  MAX_LEFT_WIDTH_RATIO,
  MIN_LEFT_PANEL_WIDTH_PX,
  MIN_PREVIEW_PANEL_WIDTH_PX,
} from './defaults';

/**
 * Clamps the rules-panel width ratio. The panel never gets narrower than MIN_LEFT_PANEL_WIDTH_PX and
 * never wider than MAX_LEFT_WIDTH_RATIO of the container (or than what leaves the preview
 * MIN_PREVIEW_PANEL_WIDTH_PX). When the container is too small for both minimums, the rules panel
 * minimum wins.
 */
export function clampLeftWidthRatio(value: number, containerWidth: number) {
  const safeWidth = Math.max(containerWidth, 1);
  const minRatio = Math.min(1, MIN_LEFT_PANEL_WIDTH_PX / safeWidth);
  const previewSafeWidth = Math.max(safeWidth - MIN_PREVIEW_PANEL_WIDTH_PX, 0);
  const dynamicMaxRatio = Math.min(1, previewSafeWidth / safeWidth);
  const maxRatio = Math.max(minRatio, Math.min(MAX_LEFT_WIDTH_RATIO, dynamicMaxRatio));
  const safeValue = Number.isFinite(value) ? value : DEFAULT_LEFT_WIDTH_RATIO;
  return Math.min(maxRatio, Math.max(minRatio, safeValue));
}

/**
 * Reads the persisted ratio. Missing/garbage values fall back to the default ratio; values > 1 are
 * legacy fixed-pixel widths and are converted to a ratio.
 */
export function readStoredLeftWidthRatio(stored: string | null, containerWidth: number) {
  const parsed = stored === null || stored.trim() === '' ? Number.NaN : Number(stored);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return clampLeftWidthRatio(DEFAULT_LEFT_WIDTH_RATIO, containerWidth);
  }
  if (parsed > 1) {
    return clampLeftWidthRatio(parsed / Math.max(containerWidth, 1), containerWidth);
  }
  return clampLeftWidthRatio(parsed, containerWidth);
}
