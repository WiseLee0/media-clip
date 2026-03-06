/**
 * media-clip-core 事件处理器
 * 构造函数注入 getState，去除全局依赖
 */

import type { DragType, CropConfig, TimelineState, CanvasLayout } from './types';
import { TIMELINE_CONFIG, DEFAULT_CROP_CONFIG } from './constants';

export interface TimelineEventCallbacks {
  onStateChange: (state: Partial<TimelineState>) => void;
  onRequestRender: () => void;
  onPlayheadSeek?: (time: number) => void;
  /** 用户操作了时间轴滚动/缩放时触发（播放中应暂停） */
  onUserInteraction?: () => void;
  /** 裁剪手柄/选区拖拽结束时触发，参数为拖拽类型 */
  onCropDragEnd?: (dragType: 'crop-left' | 'crop-right' | 'crop-body') => void;
}

export class TimelineEventHandler {
  private canvas: HTMLCanvasElement;
  private callbacks: TimelineEventCallbacks;
  private cropConfig: CropConfig = DEFAULT_CROP_CONFIG;
  private getState: () => TimelineState;

  /** 刻度尺高度（px） */
  private rulerHeight: number = TIMELINE_CONFIG.RULER_HEIGHT;
  /** 刻度尺与轨道间距（px） */
  private trackGap = 0;
  /** 缩略图轨道高度（px） */
  private thumbnailHeight: number = TIMELINE_CONFIG.VIDEO_TRACK_HEIGHT;

  private isDragging = false;
  private dragType: DragType = null;
  private dragStartX = 0;
  private dragStartScrollX = 0;
  private cropDragStartStart = 0;
  private cropDragStartEnd = 0;
  private cropBodyGrabOffset = 0;
  /** 拖拽过程中冻结的矩形快照，防止拖拽期间 canvas 位移导致坐标漂移 */
  private cachedRect: DOMRect | null = null;
  /** 通用矩形缓存，由 ResizeObserver 失效，避免 mousemove 每次触发 layout */
  private rectCache: DOMRect | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private boundMouseDown: (e: MouseEvent) => void;
  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseUp: (e: MouseEvent) => void;
  private boundWheel: (e: WheelEvent) => void;
  private boundMouseLeave: (e: MouseEvent) => void;
  private boundKeyDown: (e: KeyboardEvent) => void;

  constructor(canvas: HTMLCanvasElement, callbacks: TimelineEventCallbacks, getState: () => TimelineState) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.getState = getState;

    this.boundMouseDown = this.onMouseDown.bind(this);
    this.boundMouseMove = this.onMouseMove.bind(this);
    this.boundMouseUp = this.onMouseUp.bind(this);
    this.boundWheel = this.onWheel.bind(this);
    this.boundMouseLeave = this.onMouseLeave.bind(this);
    this.boundKeyDown = this.onKeyDown.bind(this);

    this.bindEvents();
  }

  updateCropConfig(config: CropConfig): void {
    this.cropConfig = config;
  }

  /** 同步 Canvas 布局尺寸，resize 后需调用 */
  updateLayout(layout: CanvasLayout): void {
    this.rulerHeight = layout.rulerHeight;
    this.trackGap = layout.trackGap;
    this.thumbnailHeight = layout.thumbnailHeight;
  }

  private bindEvents(): void {
    this.canvas.addEventListener('mousedown', this.boundMouseDown);
    this.canvas.addEventListener('mousemove', this.boundMouseMove);
    this.canvas.addEventListener('mouseup', this.boundMouseUp);
    this.canvas.addEventListener('wheel', this.boundWheel, { passive: false });
    this.canvas.addEventListener('mouseleave', this.boundMouseLeave);
    document.addEventListener('mouseup', this.boundMouseUp);
    document.addEventListener('mousemove', this.boundMouseMove);
    document.addEventListener('keydown', this.boundKeyDown);

    // canvas 尺寸/位置变化时使矩形缓存失效，确保下次 mousemove 重新计算
    this.resizeObserver = new ResizeObserver(() => {
      this.rectCache = null;
      this.cachedRect = null;
    });
    this.resizeObserver.observe(this.canvas);
  }

  private unbindEvents(): void {
    this.canvas.removeEventListener('mousedown', this.boundMouseDown);
    this.canvas.removeEventListener('mousemove', this.boundMouseMove);
    this.canvas.removeEventListener('mouseup', this.boundMouseUp);
    this.canvas.removeEventListener('wheel', this.boundWheel);
    this.canvas.removeEventListener('mouseleave', this.boundMouseLeave);
    document.removeEventListener('mouseup', this.boundMouseUp);
    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('keydown', this.boundKeyDown);

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  /**
   * 获取 canvas 的 DOMRect，优先复用缓存以避免强制 layout。
   * 缓存由 ResizeObserver 在 canvas 尺寸/位置变化时自动失效。
   */
  private getCanvasRect(): DOMRect {
    if (!this.rectCache) {
      this.rectCache = this.canvas.getBoundingClientRect();
    }
    return this.rectCache;
  }

  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || (target as HTMLElement)?.isContentEditable) return;

    if (e.key === 'Escape' && this.getState().cropRange) {
      e.preventDefault();
      this.callbacks.onStateChange({ cropRange: null });
      this.callbacks.onRequestRender();
    }
  }

  private onMouseDown(e: MouseEvent): void {
    // 冻结当前矩形作为拖拽基准，防止拖拽期间 canvas 位移导致坐标漂移
    this.cachedRect = this.getCanvasRect();
    const rect = this.cachedRect;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const state = this.getState();
    this.dragStartX = x;
    this.dragStartScrollX = state.scrollX;

    if (y < this.rulerHeight) {
      if (this.getState().clips.length === 0) return;
      this.isDragging = true;
      this.dragType = 'playhead';
      this.updatePlayheadPosition(x);
      this.canvas.style.cursor = 'col-resize';
      return;
    }

    const cropHit = this.hitTestCropHandle(x, y);
    if (cropHit) {
      this.isDragging = true;
      this.dragType = cropHit;
      const cr = state.cropRange!;
      this.cropDragStartStart = cr.start;
      this.cropDragStartEnd = cr.end;

      if (cropHit === 'crop-body') {
        const time = (x - TIMELINE_CONFIG.TRACK_PADDING_H + state.scrollX) / state.scale;
        this.cropBodyGrabOffset = time - cr.start;
      }

      this.canvas.style.cursor = cropHit === 'crop-body' ? 'grab' : 'ew-resize';
      this.callbacks.onUserInteraction?.();
      return;
    }

    this.isDragging = true;
    this.dragType = 'scroll';
    this.canvas.style.cursor = 'grabbing';
  }

  private onMouseMove(e: MouseEvent): void {
    const rect = this.isDragging && this.cachedRect ? this.cachedRect : this.getCanvasRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.isDragging) {
      this.handleDrag(x, y);
      return;
    }

    this.updateHoverState(x, y);
  }

  private handleDrag(x: number, _y: number): void {
    const { scale, scrollX, totalDuration } = this.getState();
    const { minDuration, maxDuration } = this.cropConfig;

    switch (this.dragType) {
      case 'playhead':
        this.updatePlayheadPosition(x);
        break;

      case 'crop-left': {
        const time = (x - TIMELINE_CONFIG.TRACK_PADDING_H + scrollX) / scale;
        const end = this.cropDragStartEnd;
        const minStart = Math.max(0, end - maxDuration);
        const maxStart = end - minDuration;
        const clamped = Math.max(minStart, Math.min(time, maxStart));
        this.callbacks.onStateChange({
          cropRange: { start: clamped, end },
        });
        this.callbacks.onRequestRender();
        break;
      }

      case 'crop-right': {
        const time = (x - TIMELINE_CONFIG.TRACK_PADDING_H + scrollX) / scale;
        const start = this.cropDragStartStart;
        const minEnd = start + minDuration;
        const maxEnd = Math.min(totalDuration, start + maxDuration);
        const clamped = Math.max(minEnd, Math.min(time, maxEnd));
        this.callbacks.onStateChange({
          cropRange: { start, end: clamped },
        });
        this.callbacks.onRequestRender();
        break;
      }

      case 'crop-body': {
        const time = (x - TIMELINE_CONFIG.TRACK_PADDING_H + scrollX) / scale;
        const duration = this.cropDragStartEnd - this.cropDragStartStart;
        let newStart = time - this.cropBodyGrabOffset;
        newStart = Math.max(0, Math.min(newStart, totalDuration - duration));
        this.callbacks.onStateChange({
          cropRange: { start: newStart, end: newStart + duration },
        });
        this.callbacks.onRequestRender();
        break;
      }

      case 'scroll': {
        const deltaX = this.dragStartX - x;
        const newScrollX = Math.max(0, this.dragStartScrollX + deltaX);
        this.callbacks.onStateChange({ scrollX: newScrollX });
        this.callbacks.onUserInteraction?.();
        this.callbacks.onRequestRender();
        break;
      }
    }
  }

  private onMouseUp(): void {
    if (this.isDragging) {
      const finishedDragType = this.dragType;
      this.isDragging = false;
      this.dragType = null;
      this.cachedRect = null;
      this.canvas.style.cursor = 'default';

      // 裁剪拖拽结束时通知引擎，用于播放头吸附
      if (
        finishedDragType === 'crop-left' ||
        finishedDragType === 'crop-right' ||
        finishedDragType === 'crop-body'
      ) {
        this.callbacks.onCropDragEnd?.(finishedDragType);
      }

      this.callbacks.onRequestRender();
    }
  }

  private onMouseLeave(): void {
    if (!this.isDragging) {
      this.canvas.style.cursor = 'default';
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();

    const { scale, scrollX } = this.getState();
    const { MIN_SCALE, MAX_SCALE, ZOOM_FACTOR } = TIMELINE_CONFIG;

    if (e.ctrlKey || e.metaKey) {
      const delta = e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * delta));
      const leftTime = scrollX / scale;
      const newScrollX = Math.max(0, leftTime * newScale);

      this.callbacks.onStateChange({ scale: newScale, scrollX: newScrollX });
      this.callbacks.onUserInteraction?.();
      this.callbacks.onRequestRender();
      return;
    }

    if (e.deltaX !== 0) {
      const newScrollX = Math.max(0, scrollX + e.deltaX);
      this.callbacks.onStateChange({ scrollX: newScrollX });
      this.callbacks.onUserInteraction?.();
      this.callbacks.onRequestRender();
      return;
    }

    const newScrollX = Math.max(0, scrollX + e.deltaY);
    this.callbacks.onStateChange({ scrollX: newScrollX });
    this.callbacks.onUserInteraction?.();
    this.callbacks.onRequestRender();
  }

  private updateHoverState(x: number, y: number): void {
    if (y < this.rulerHeight) {
      this.canvas.style.cursor = this.getState().clips.length > 0 ? 'col-resize' : 'default';
      return;
    }

    const cropHit = this.hitTestCropHandle(x, y);
    if (cropHit === 'crop-left' || cropHit === 'crop-right') {
      this.canvas.style.cursor = 'ew-resize';
      return;
    }
    if (cropHit === 'crop-body') {
      this.canvas.style.cursor = 'grab';
      return;
    }

    this.canvas.style.cursor = 'default';
  }

  private updatePlayheadPosition(x: number): void {
    const { scale, scrollX, totalDuration } = this.getState();
    const time = (x - TIMELINE_CONFIG.TRACK_PADDING_H + scrollX) / scale;
    const clampedTime = Math.max(0, Math.min(time, totalDuration));
    this.callbacks.onStateChange({ currentTime: clampedTime });
    this.callbacks.onPlayheadSeek?.(clampedTime);
    this.callbacks.onRequestRender();
  }

  private hitTestCropHandle(x: number, y: number): 'crop-left' | 'crop-right' | 'crop-body' | null {
    const state = this.getState();
    const { cropRange } = state;
    if (!cropRange) return null;

    const { CLIP_PADDING, CROP_HANDLE_WIDTH, TRACK_PADDING_H } = TIMELINE_CONFIG;
    const { scale, scrollX } = state;

    const trackY = this.rulerHeight + this.trackGap + CLIP_PADDING;
    const trackH = this.thumbnailHeight - CLIP_PADDING * 2;

    if (y < trackY || y > trackY + trackH) return null;

    const contentLeft = TRACK_PADDING_H;
    const contentRight = this.getCanvasRect().width - TRACK_PADDING_H;
    if (x < contentLeft || x > contentRight) return null;

    const cropLeftX = cropRange.start * scale - scrollX + TRACK_PADDING_H;
    const cropRightX = cropRange.end * scale - scrollX + TRACK_PADDING_H;

    /** 手柄边缘额外扩展的拖拽容差（px） */
    const HIT_EXTEND = 2;

    // 左手柄视觉矩形：[cropLeftX, cropLeftX + CROP_HANDLE_WIDTH]
    if (x >= cropLeftX - HIT_EXTEND && x <= cropLeftX + CROP_HANDLE_WIDTH + HIT_EXTEND) {
      return 'crop-left';
    }

    // 右手柄视觉矩形：[cropRightX - CROP_HANDLE_WIDTH, cropRightX]
    if (x >= cropRightX - CROP_HANDLE_WIDTH - HIT_EXTEND && x <= cropRightX + HIT_EXTEND) {
      return 'crop-right';
    }

    // 选区主体：左手柄右边缘到右手柄左边缘之间
    if (x > cropLeftX + CROP_HANDLE_WIDTH && x < cropRightX - CROP_HANDLE_WIDTH) {
      return 'crop-body';
    }

    return null;
  }

  destroy(): void {
    this.unbindEvents();
  }
}
