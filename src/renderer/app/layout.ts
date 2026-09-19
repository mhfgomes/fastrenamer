import { MIN_LEFT_PANEL_WIDTH_PX, MIN_PREVIEW_PANEL_WIDTH_PX, MAX_LEFT_WIDTH_RATIO } from './defaults';

export function clampLeftWidthRatio(value: number, containerWidth: number) {
  const safeWidth = Math.max(containerWidth, 1);
  const minRatio = Math.min(1, MIN_LEFT_PANEL_WIDTH_PX / safeWidth);
  const previewSafeWidth = Math.max(safeWidth - MIN_PREVIEW_PANEL_WIDTH_PX, 0);
  const dynamicMaxRatio = Math.min(1, previewSafeWidth / safeWidth);
  const maxRatio = Math.max(minRatio, Math.max(MAX_LEFT_WIDTH_RATIO, dynamicMaxRatio));
  return Math.min(maxRatio, Math.max(minRatio, value));
}
