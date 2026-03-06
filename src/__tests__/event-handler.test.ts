import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimelineEventHandler, type TimelineEventCallbacks } from '../event-handler';
import { TIMELINE_CONFIG } from '../constants';
import type { TimelineState, CanvasLayout } from '../types';

function createDefaultState(overrides?: Partial<TimelineState>): TimelineState {
  return {
    clips: [],
    totalDuration: 60,
    currentTime: 0,
    isPlaying: false,
    scale: 100,
    scrollX: 0,
    selectedClipIds: new Set(),
    hoverClipId: null,
    cropRange: null,
    previewFrame: null,
    ...overrides,
  };
}

const DEFAULT_LAYOUT: CanvasLayout = {
  rulerHeight: TIMELINE_CONFIG.RULER_HEIGHT,
  trackGap: 0,
  thumbnailHeight: TIMELINE_CONFIG.VIDEO_TRACK_HEIGHT + TIMELINE_CONFIG.CLIP_PADDING * 2,
};

describe('TimelineEventHandler', () => {
  let canvas: HTMLCanvasElement;
  let callbacks: TimelineEventCallbacks;
  let state: TimelineState;
  let handler: TimelineEventHandler;

  beforeEach(() => {
    // jsdom 提供完整的 DOM 环境
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 116;
    document.body.appendChild(canvas);

    // Mock getBoundingClientRect
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 116,
      width: 800,
      height: 116,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // Mock ResizeObserver
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {
          /* noop */
        }
        unobserve() {
          /* noop */
        }
        disconnect() {
          /* noop */
        }
      },
    );

    callbacks = {
      onStateChange: vi.fn(),
      onRequestRender: vi.fn(),
      onPlayheadSeek: vi.fn(),
      onUserInteraction: vi.fn(),
      onCropDragEnd: vi.fn(),
    };

    state = createDefaultState();
    handler = new TimelineEventHandler(canvas, callbacks, () => state);
    handler.updateLayout(DEFAULT_LAYOUT);
  });

  afterEach(() => {
    handler.destroy();
    document.body.removeChild(canvas);
  });

  function fireMouseEvent(target: EventTarget, type: string, opts?: Partial<MouseEvent>): MouseEvent {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: opts?.clientX ?? 0,
      clientY: opts?.clientY ?? 0,
      ...opts,
    });
    target.dispatchEvent(event);
    return event;
  }

  // --- 播放头拖拽 ---

  it('clicking on ruler area starts playhead drag', () => {
    // 点击标尺区域（y < rulerHeight = 28）
    fireMouseEvent(canvas, 'mousedown', { clientX: 100, clientY: 10 });

    // 应触发 onStateChange（更新 currentTime）
    expect(callbacks.onStateChange).toHaveBeenCalled();
    expect(callbacks.onPlayheadSeek).toHaveBeenCalled();
    expect(callbacks.onRequestRender).toHaveBeenCalled();

    // mouseup 结束拖拽
    fireMouseEvent(document, 'mouseup', { clientX: 100, clientY: 10 });
  });

  it('playhead drag updates position on mousemove', () => {
    fireMouseEvent(canvas, 'mousedown', { clientX: 100, clientY: 10 });
    (callbacks.onStateChange as ReturnType<typeof vi.fn>).mockClear();

    // 拖拽移动
    fireMouseEvent(document, 'mousemove', { clientX: 200, clientY: 10 });

    expect(callbacks.onStateChange).toHaveBeenCalled();
    expect(callbacks.onPlayheadSeek).toHaveBeenCalled();

    fireMouseEvent(document, 'mouseup', { clientX: 200, clientY: 10 });
  });

  // --- 滚动拖拽 ---

  it('clicking below ruler without crop handles starts scroll drag', () => {
    // 点击轨道区域（y > rulerHeight），无 cropRange 时为 scroll
    const trackY = TIMELINE_CONFIG.RULER_HEIGHT + TIMELINE_CONFIG.CLIP_PADDING + 10;
    fireMouseEvent(canvas, 'mousedown', { clientX: 200, clientY: trackY });

    expect(canvas.style.cursor).toBe('grabbing');

    // 拖拽滚动
    fireMouseEvent(document, 'mousemove', { clientX: 150, clientY: trackY });
    expect(callbacks.onStateChange).toHaveBeenCalled();
    expect(callbacks.onUserInteraction).toHaveBeenCalled();

    fireMouseEvent(document, 'mouseup', { clientX: 150, clientY: trackY });
  });

  // --- 裁剪手柄 ---

  it('dragging left crop handle updates cropRange', () => {
    state = createDefaultState({
      cropRange: { start: 2, end: 8 },
    });

    const trackY = TIMELINE_CONFIG.RULER_HEIGHT + TIMELINE_CONFIG.CLIP_PADDING + 5;
    const leftHandleX = 2 * 100 + TIMELINE_CONFIG.TRACK_PADDING_H; // start * scale + padding

    fireMouseEvent(canvas, 'mousedown', { clientX: leftHandleX + 2, clientY: trackY });
    expect(canvas.style.cursor).toBe('ew-resize');

    // 拖拽左手柄
    fireMouseEvent(document, 'mousemove', { clientX: leftHandleX + 50, clientY: trackY });
    expect(callbacks.onStateChange).toHaveBeenCalled();

    // 结束拖拽
    fireMouseEvent(document, 'mouseup', { clientX: leftHandleX + 50, clientY: trackY });
    expect(callbacks.onCropDragEnd).toHaveBeenCalledWith('crop-left');
  });

  it('dragging right crop handle updates cropRange', () => {
    state = createDefaultState({
      cropRange: { start: 1, end: 5 },
    });

    const trackY = TIMELINE_CONFIG.RULER_HEIGHT + TIMELINE_CONFIG.CLIP_PADDING + 5;
    const rightHandleX = 5 * 100 + TIMELINE_CONFIG.TRACK_PADDING_H; // end * scale + padding

    fireMouseEvent(canvas, 'mousedown', { clientX: rightHandleX - 2, clientY: trackY });
    expect(canvas.style.cursor).toBe('ew-resize');

    fireMouseEvent(document, 'mousemove', { clientX: rightHandleX - 50, clientY: trackY });
    expect(callbacks.onStateChange).toHaveBeenCalled();

    fireMouseEvent(document, 'mouseup', { clientX: rightHandleX - 50, clientY: trackY });
    expect(callbacks.onCropDragEnd).toHaveBeenCalledWith('crop-right');
  });

  it('dragging crop body moves the entire range', () => {
    state = createDefaultState({
      cropRange: { start: 2, end: 8 },
    });

    const trackY = TIMELINE_CONFIG.RULER_HEIGHT + TIMELINE_CONFIG.CLIP_PADDING + 5;
    // 裁剪区域中间
    const bodyX = ((2 + 8) / 2) * 100 + TIMELINE_CONFIG.TRACK_PADDING_H;

    fireMouseEvent(canvas, 'mousedown', { clientX: bodyX, clientY: trackY });
    expect(canvas.style.cursor).toBe('grab');

    fireMouseEvent(document, 'mousemove', { clientX: bodyX + 50, clientY: trackY });
    expect(callbacks.onStateChange).toHaveBeenCalled();

    fireMouseEvent(document, 'mouseup', { clientX: bodyX + 50, clientY: trackY });
    expect(callbacks.onCropDragEnd).toHaveBeenCalledWith('crop-body');
  });

  // --- 滚轮事件 ---

  it('wheel event scrolls horizontally', () => {
    const wheelEvent = new WheelEvent('wheel', {
      deltaY: 50,
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(wheelEvent);

    expect(callbacks.onStateChange).toHaveBeenCalled();
    expect(callbacks.onUserInteraction).toHaveBeenCalled();
  });

  it('ctrl+wheel zooms', () => {
    const wheelEvent = new WheelEvent('wheel', {
      deltaY: -50,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(wheelEvent);

    const call = (callbacks.onStateChange as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).toHaveProperty('scale');
    expect(call).toHaveProperty('scrollX');
  });

  it('horizontal wheel (deltaX) scrolls', () => {
    const wheelEvent = new WheelEvent('wheel', {
      deltaX: 30,
      deltaY: 0,
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(wheelEvent);

    const call = (callbacks.onStateChange as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).toHaveProperty('scrollX');
  });

  // --- 键盘事件 ---

  it('Escape key clears cropRange', () => {
    state = createDefaultState({
      cropRange: { start: 2, end: 8 },
    });

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(event);

    expect(callbacks.onStateChange).toHaveBeenCalledWith({ cropRange: null });
    expect(callbacks.onRequestRender).toHaveBeenCalled();
  });

  it('Escape does nothing when no cropRange', () => {
    state = createDefaultState({ cropRange: null });

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(event);

    expect(callbacks.onStateChange).not.toHaveBeenCalledWith({ cropRange: null });
  });

  it('Escape is ignored when focus is on input element', () => {
    state = createDefaultState({
      cropRange: { start: 2, end: 8 },
    });

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    });
    // 模拟 target 为 input
    Object.defineProperty(event, 'target', { value: input });
    document.dispatchEvent(event);

    expect(callbacks.onStateChange).not.toHaveBeenCalledWith({ cropRange: null });
    document.body.removeChild(input);
  });

  // --- Hover ---

  it('mousemove on ruler shows col-resize cursor', () => {
    fireMouseEvent(canvas, 'mousemove', { clientX: 100, clientY: 10 });
    expect(canvas.style.cursor).toBe('col-resize');
  });

  it('mousemove on track area shows default cursor', () => {
    const trackY = TIMELINE_CONFIG.RULER_HEIGHT + TIMELINE_CONFIG.CLIP_PADDING + 20;
    fireMouseEvent(canvas, 'mousemove', { clientX: 100, clientY: trackY });
    expect(canvas.style.cursor).toBe('default');
  });

  it('mouseleave resets cursor when not dragging', () => {
    canvas.style.cursor = 'col-resize';
    fireMouseEvent(canvas, 'mouseleave', { clientX: 0, clientY: 0 });
    expect(canvas.style.cursor).toBe('default');
  });

  // --- 生命周期 ---

  it('destroy removes all event listeners without errors', () => {
    handler.destroy();
    // 再次触发事件不应报错
    expect(() => {
      fireMouseEvent(canvas, 'mousedown', { clientX: 100, clientY: 10 });
    }).not.toThrow();
  });

  it('updateCropConfig updates constraints', () => {
    handler.updateCropConfig({ minDuration: 1, maxDuration: 30 });
    // 不抛异常即可，具体约束在拖拽逻辑中生效
  });

  it('updateLayout updates layout dimensions', () => {
    const newLayout: CanvasLayout = {
      rulerHeight: 40,
      trackGap: 10,
      thumbnailHeight: 100,
    };
    handler.updateLayout(newLayout);
    // 不抛异常即可
  });
});
