import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { LEFT_WIDTH_STORAGE_KEY } from '../app/defaults';
import {
  clampLeftWidthRatio,
  getKeyboardResizeRatio,
  getLeftWidthRatioBounds,
  readStoredLeftWidthRatio,
} from '../app/layout';

const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * Splitter between the rules and preview panels. While dragging, the left panel width is written
 * straight to the DOM (once per animation frame) so React does not re-render either panel; the
 * ratio is committed to state and persisted on mouseup. The splitter is also a focusable
 * `role="separator"`: Arrow keys (Shift for larger steps), Home and End resize and persist.
 */
export function usePanelResize() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  const [leftWidthRatio, setLeftWidthRatio] = useState(() =>
    readStoredLeftWidthRatio(
      localStorage.getItem(LEFT_WIDTH_STORAGE_KEY),
      Math.max(window.innerWidth - 16, 1),
    ),
  );
  const drag = useRef<{ startX: number; startRatio: number; containerWidth: number; ratio: number } | null>(null);
  const frame = useRef<number | null>(null);

  const getContainerWidth = () => containerRef.current?.getBoundingClientRect().width ?? window.innerWidth;
  const [containerWidth, setContainerWidth] = useState(() => Math.max(window.innerWidth - 16, 1));

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onMediaChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    mq.addEventListener('change', onMediaChange);

    function onMouseMove(event: MouseEvent) {
      const current = drag.current;
      if (!current || current.containerWidth <= 0) return;
      current.ratio = clampLeftWidthRatio(
        current.startRatio + (event.clientX - current.startX) / current.containerWidth,
        current.containerWidth,
      );
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (drag.current && leftPanelRef.current) {
          leftPanelRef.current.style.width = `${drag.current.ratio * 100}%`;
        }
      });
    }

    function onMouseUp() {
      const current = drag.current;
      if (!current) return;
      drag.current = null;
      document.body.style.removeProperty('cursor');
      setLeftWidthRatio(current.ratio);
      localStorage.setItem(LEFT_WIDTH_STORAGE_KEY, String(current.ratio));
    }

    function onWindowResize() {
      const width = getContainerWidth();
      setContainerWidth(width);
      setLeftWidthRatio((current) => clampLeftWidthRatio(current, width));
    }
    setContainerWidth(getContainerWidth());

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('resize', onWindowResize);
    return () => {
      mq.removeEventListener('change', onMediaChange);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('resize', onWindowResize);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  const onSplitterMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      drag.current = {
        startX: event.clientX,
        startRatio: leftWidthRatio,
        containerWidth: getContainerWidth(),
        ratio: leftWidthRatio,
      };
      document.body.style.cursor = 'col-resize';
    },
    [leftWidthRatio],
  );

  const onSplitterKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      const width = getContainerWidth();
      const next = getKeyboardResizeRatio(event.key, event.shiftKey, leftWidthRatio, width);
      if (next === null) return;
      event.preventDefault();
      setContainerWidth(width);
      setLeftWidthRatio(next);
      localStorage.setItem(LEFT_WIDTH_STORAGE_KEY, String(next));
    },
    [leftWidthRatio],
  );

  const { minRatio, maxRatio } = getLeftWidthRatioBounds(containerWidth);
  /** ARIA values for the splitter, as whole percentages of the container width. */
  const splitterAria = {
    'aria-valuenow': Math.round(leftWidthRatio * 100),
    'aria-valuemin': Math.round(minRatio * 100),
    'aria-valuemax': Math.round(maxRatio * 100),
  };

  return {
    containerRef,
    leftPanelRef,
    isDesktop,
    leftWidthRatio,
    splitterAria,
    onSplitterMouseDown,
    onSplitterKeyDown,
  };
}
