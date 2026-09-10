import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface VirtualRange {
  start: number;
  end: number;
}

interface HorizontalWindowMetrics {
  itemSize: number;
  gap: number;
  viewportSize: number;
}

interface GridWindowMetrics {
  itemSize: number;
  gap: number;
  columns: number;
  viewportSize: number;
  contentOffset: number;
}

const EMPTY_RANGE: VirtualRange = { start: 0, end: 0 };

export function getVirtualSpacerSize(hiddenItems: number, itemSize: number, gap: number): number {
  if (hiddenItems <= 0 || itemSize <= 0) return 0;
  return hiddenItems * itemSize + Math.max(0, hiddenItems - 1) * gap;
}

export function calculateHorizontalWindow(
  length: number,
  scrollOffset: number,
  metrics: HorizontalWindowMetrics,
  minimumItems: number,
  overscanItems: number,
): VirtualRange {
  if (length <= 0) return EMPTY_RANGE;
  const stride = metrics.itemSize + metrics.gap;
  if (stride <= 0 || metrics.viewportSize <= 0) {
    return { start: 0, end: Math.min(length, minimumItems) };
  }

  const firstVisible = Math.max(0, Math.floor(scrollOffset / stride));
  const visibleItems = Math.max(1, Math.ceil(metrics.viewportSize / stride));
  const start = Math.max(0, firstVisible - overscanItems);
  const end = Math.min(
    length,
    Math.max(firstVisible + visibleItems + overscanItems, start + minimumItems),
  );
  return { start, end };
}

export function calculateGridWindow(
  length: number,
  scrollOffset: number,
  metrics: GridWindowMetrics,
  minimumItems: number,
  overscanRows: number,
): VirtualRange {
  if (length <= 0) return EMPTY_RANGE;
  const columns = Math.max(1, metrics.columns);
  const stride = metrics.itemSize + metrics.gap;
  if (stride <= 0 || metrics.viewportSize <= 0) {
    return { start: 0, end: Math.min(length, minimumItems) };
  }

  const offsetInsideGrid = Math.max(0, scrollOffset - metrics.contentOffset);
  const firstVisibleRow = Math.max(0, Math.floor(offsetInsideGrid / stride));
  const visibleRows = Math.max(1, Math.ceil(metrics.viewportSize / stride));
  const startRow = Math.max(0, firstVisibleRow - overscanRows);
  const endRow = Math.min(
    Math.ceil(length / columns),
    Math.max(
      firstVisibleRow + visibleRows + overscanRows,
      startRow + Math.ceil(minimumItems / columns),
    ),
  );

  return {
    start: Math.min(length, startRow * columns),
    end: Math.min(length, endRow * columns),
  };
}

function sameRange(left: VirtualRange, right: VirtualRange): boolean {
  return left.start === right.start && left.end === right.end;
}

function parsePixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function countGridColumns(gridTemplateColumns: string): number {
  const tracks = gridTemplateColumns.trim().split(/\s+/).filter(Boolean);
  return Math.max(1, tracks.length);
}

export function useHorizontalVirtualWindow(
  length: number,
  minimumItems: number,
  overscanItems: number = 3,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemMeasureRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<HorizontalWindowMetrics | null>(null);
  const frameRef = useRef<number | null>(null);
  const [, setMetricsVersion] = useState(0);
  const [range, setRange] = useState<VirtualRange>(() => ({
    start: 0,
    end: Math.min(length, minimumItems),
  }));

  const refreshRange = useCallback(() => {
    const container = containerRef.current;
    const metrics = metricsRef.current;
    if (!container || !metrics) return;
    const next = calculateHorizontalWindow(
      length,
      container.scrollLeft,
      { ...metrics, viewportSize: container.clientWidth },
      minimumItems,
      overscanItems,
    );
    setRange(current => sameRange(current, next) ? current : next);
  }, [length, minimumItems, overscanItems]);

  const scheduleRefresh = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      refreshRange();
    });
  }, [refreshRange]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const item = itemMeasureRef.current;
    if (!container || !item) return;

    const measure = () => {
      const style = getComputedStyle(container);
      const nextMetrics = {
        itemSize: item.getBoundingClientRect().width,
        gap: parsePixelValue(style.columnGap || style.gap),
        viewportSize: container.clientWidth,
      };
      const currentMetrics = metricsRef.current;
      metricsRef.current = nextMetrics;
      if (!currentMetrics || currentMetrics.itemSize !== nextMetrics.itemSize || currentMetrics.gap !== nextMetrics.gap || currentMetrics.viewportSize !== nextMetrics.viewportSize) {
        setMetricsVersion(version => version + 1);
      }
      refreshRange();
    };

    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(container);
    observer?.observe(item);
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [range.start, refreshRange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('scroll', scheduleRefresh, { passive: true });
    scheduleRefresh();
    return () => container.removeEventListener('scroll', scheduleRefresh);
  }, [scheduleRefresh]);

  useEffect(() => {
    setRange(current => {
      const start = Math.min(current.start, Math.max(0, length - 1));
      const end = Math.min(length, Math.max(start, current.end));
      const next = length === 0 ? EMPTY_RANGE : { start, end: Math.max(end, Math.min(length, start + minimumItems)) };
      return sameRange(current, next) ? current : next;
    });
    scheduleRefresh();
  }, [length, minimumItems, scheduleRefresh]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const itemSize = metricsRef.current?.itemSize || 0;
  const gap = metricsRef.current?.gap || 0;
  return {
    containerRef,
    itemMeasureRef,
    range,
    leadingSpacerSize: getVirtualSpacerSize(range.start, itemSize, gap),
    trailingSpacerSize: getVirtualSpacerSize(length - range.end, itemSize, gap),
  };
}

export function useGridVirtualWindow(
  length: number,
  scrollRootRef: RefObject<HTMLDivElement | null>,
  minimumItems: number,
  overscanRows: number = 3,
) {
  const gridRef = useRef<HTMLDivElement>(null);
  const itemMeasureRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<GridWindowMetrics | null>(null);
  const frameRef = useRef<number | null>(null);
  const [, setMetricsVersion] = useState(0);
  const [range, setRange] = useState<VirtualRange>(() => ({
    start: 0,
    end: Math.min(length, minimumItems),
  }));

  const refreshRange = useCallback(() => {
    const root = scrollRootRef.current;
    const metrics = metricsRef.current;
    if (!root || !metrics) return;
    const next = calculateGridWindow(
      length,
      root.scrollTop,
      { ...metrics, viewportSize: root.clientHeight },
      minimumItems,
      overscanRows,
    );
    setRange(current => sameRange(current, next) ? current : next);
  }, [length, minimumItems, overscanRows, scrollRootRef]);

  const measure = useCallback(() => {
    const root = scrollRootRef.current;
    const grid = gridRef.current;
    const item = itemMeasureRef.current;
    if (!root || !grid || !item) return;
    const rootRect = root.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const nextMetrics = {
      itemSize: item.getBoundingClientRect().height,
      gap: parsePixelValue(style.rowGap || style.gap),
      columns: countGridColumns(style.gridTemplateColumns),
      viewportSize: root.clientHeight,
      contentOffset: root.scrollTop + gridRect.top - rootRect.top,
    };
    const currentMetrics = metricsRef.current;
    metricsRef.current = nextMetrics;
    if (!currentMetrics || currentMetrics.itemSize !== nextMetrics.itemSize || currentMetrics.gap !== nextMetrics.gap || currentMetrics.columns !== nextMetrics.columns || currentMetrics.viewportSize !== nextMetrics.viewportSize || currentMetrics.contentOffset !== nextMetrics.contentOffset) {
      setMetricsVersion(version => version + 1);
    }
    refreshRange();
  }, [refreshRange, scrollRootRef]);

  const scheduleRefresh = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      refreshRange();
    });
  }, [refreshRange]);

  useLayoutEffect(() => {
    const root = scrollRootRef.current;
    const grid = gridRef.current;
    const item = itemMeasureRef.current;
    if (!root || !grid || !item) return;
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(root);
    observer?.observe(grid);
    observer?.observe(item);
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, range.start]);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    root.addEventListener('scroll', scheduleRefresh, { passive: true });
    scheduleRefresh();
    return () => root.removeEventListener('scroll', scheduleRefresh);
  }, [scheduleRefresh, scrollRootRef]);

  useEffect(() => {
    setRange(current => {
      const start = Math.min(current.start, Math.max(0, length - 1));
      const end = Math.min(length, Math.max(start, current.end));
      const next = length === 0 ? EMPTY_RANGE : { start, end: Math.max(end, Math.min(length, start + minimumItems)) };
      return sameRange(current, next) ? current : next;
    });
    scheduleRefresh();
  }, [length, minimumItems, scheduleRefresh]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const metrics = metricsRef.current;
  const columns = metrics?.columns || 1;
  const hiddenRowsBefore = Math.floor(range.start / columns);
  const totalRows = Math.ceil(length / columns);
  const renderedEndRow = Math.ceil(range.end / columns);
  return {
    gridRef,
    itemMeasureRef,
    range,
    leadingSpacerSize: getVirtualSpacerSize(hiddenRowsBefore, metrics?.itemSize || 0, metrics?.gap || 0),
    trailingSpacerSize: getVirtualSpacerSize(totalRows - renderedEndRow, metrics?.itemSize || 0, metrics?.gap || 0),
  };
}
