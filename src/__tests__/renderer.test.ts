import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimelineRenderer } from '../renderer';
import { ThumbnailStore } from '../media/thumbnail-store';
import { WaveformService } from '../media/waveform-service';
import { TIMELINE_CONFIG, DARK_THEME_COLORS } from '../constants';
import type { TimelineState, CanvasLayout } from '../types';

// Mock mediabunny (WaveformService 间接依赖)
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [],
  BlobSource: vi.fn(),
  CanvasSink: vi.fn(),
  Input: vi.fn(),
}));

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

function createMockCtx(): CanvasRenderingContext2D {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeRect: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    ellipse: vi.fn(),
    clip: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
  } as unknown as CanvasRenderingContext2D;
}

function createMockCanvas(ctx: CanvasRenderingContext2D): HTMLCanvasElement {
  return {
    getContext: vi.fn(() => ctx),
    width: 0,
    height: 0,
    style: { width: '', height: '' },
  } as unknown as HTMLCanvasElement;
}

const DEFAULT_LAYOUT: CanvasLayout = {
  rulerHeight: TIMELINE_CONFIG.RULER_HEIGHT,
  trackGap: 0,
  thumbnailHeight: TIMELINE_CONFIG.VIDEO_TRACK_HEIGHT + TIMELINE_CONFIG.CLIP_PADDING * 2,
};

describe('TimelineRenderer', () => {
  let ctx: CanvasRenderingContext2D;
  let canvas: HTMLCanvasElement;
  let thumbnailStore: ThumbnailStore;
  let waveformService: WaveformService;
  let state: TimelineState;

  beforeEach(() => {
    ctx = createMockCtx();
    canvas = createMockCanvas(ctx);
    thumbnailStore = new ThumbnailStore();
    waveformService = new WaveformService();
    state = createDefaultState();

    // Mock OffscreenCanvas (jsdom 不支持)
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        width: number;
        height: number;
        constructor(w: number, h: number) {
          this.width = w;
          this.height = h;
        }
        getContext() {
          return createMockCtx();
        }
      },
    );

    // Mock devicePixelRatio
    vi.stubGlobal('devicePixelRatio', 1);
  });

  function createRenderer(getState?: () => TimelineState) {
    return new TimelineRenderer(canvas, getState ?? (() => state), thumbnailStore, waveformService);
  }

  it('throws when canvas context is unavailable', () => {
    const badCanvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => new TimelineRenderer(badCanvas, () => state, thumbnailStore)).toThrow(
      '无法获取 Canvas 2D 上下文',
    );
  });

  it('resize sets canvas dimensions and creates ruler layer', () => {
    const renderer = createRenderer();
    renderer.resize(800, DEFAULT_LAYOUT);

    expect(canvas.width).toBe(800);
    expect(canvas.style.width).toBe('800px');
  });

  it('markNeedsRender schedules a RAF and renders', () => {
    const rafCb: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafCb.push(cb);
      return rafCb.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const renderer = createRenderer();
    renderer.resize(800, DEFAULT_LAYOUT);
    renderer.markNeedsRender();

    expect(rafCb).toHaveLength(1);

    // 执行 RAF 回调
    rafCb[0]();
    // render 被调用：setTransform + clearRect（clear）
    expect(ctx.setTransform).toHaveBeenCalled();
    expect(ctx.clearRect).toHaveBeenCalled();
  });

  it('markNeedsRender coalesces multiple calls into one RAF', () => {
    const rafCb: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafCb.push(cb);
      return rafCb.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const renderer = createRenderer();
    renderer.resize(800, DEFAULT_LAYOUT);

    renderer.markNeedsRender();
    renderer.markNeedsRender();
    renderer.markNeedsRender();

    // 只注册一次 RAF
    expect(rafCb).toHaveLength(1);
  });

  it('does not render after destroy', () => {
    const rafCb: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafCb.push(cb);
      return rafCb.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const renderer = createRenderer();
    renderer.resize(800, DEFAULT_LAYOUT);
    renderer.markNeedsRender();

    renderer.destroy();

    // 执行 RAF 回调，不应触发 render
    const setTransformBefore = (ctx.setTransform as ReturnType<typeof vi.fn>).mock.calls.length;
    rafCb[0]();
    // destroy(true) 本身会调用一次 setTransform + clearRect
    // 但 RAF 回调中因 destroyed=true 不会再调用 render
    const setTransformAfter = (ctx.setTransform as ReturnType<typeof vi.fn>).mock.calls.length;
    // destroy 自身调用了一次 setTransform，RAF 回调不应再增加
    expect(setTransformAfter - setTransformBefore).toBe(0);
  });

  it('destroy cancels pending RAF', () => {
    const mockCancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', () => 42);
    vi.stubGlobal('cancelAnimationFrame', mockCancel);

    const renderer = createRenderer();
    renderer.resize(800, DEFAULT_LAYOUT);
    renderer.markNeedsRender();
    renderer.destroy();

    expect(mockCancel).toHaveBeenCalledWith(42);
  });

  it('destroy clears canvas by default', () => {
    const renderer = createRenderer();
    renderer.resize(800, DEFAULT_LAYOUT);
    renderer.destroy(true);

    expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
    expect(ctx.clearRect).toHaveBeenCalled();
  });

  it('destroy(false) skips canvas clearing', () => {
    const renderer = createRenderer();
    renderer.resize(800, DEFAULT_LAYOUT);

    (ctx.setTransform as ReturnType<typeof vi.fn>).mockClear();
    (ctx.clearRect as ReturnType<typeof vi.fn>).mockClear();

    renderer.destroy(false);

    expect(ctx.setTransform).not.toHaveBeenCalled();
    expect(ctx.clearRect).not.toHaveBeenCalled();
  });

  it('destroy releases rulerLayer and rulerCtx', () => {
    const renderer = createRenderer();
    renderer.resize(800, DEFAULT_LAYOUT);
    renderer.destroy();

    // 通过再次 markNeedsRender 验证不会因 rulerLayer 空指针报错
    // destroy 后 markNeedsRender 应该无操作（destroyed = true）
    expect(() => renderer.markNeedsRender()).not.toThrow();
  });

  it('setColors updates theme and invalidates ruler cache', () => {
    const rafCb: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafCb.push(cb);
      return rafCb.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const renderer = createRenderer();
    renderer.resize(800, DEFAULT_LAYOUT);

    renderer.setColors(DARK_THEME_COLORS);

    // setColors 应触发 markNeedsRender
    expect(rafCb.length).toBeGreaterThanOrEqual(1);
  });

  it('getWidth returns the current width', () => {
    const renderer = createRenderer();
    expect(renderer.getWidth()).toBe(0);

    renderer.resize(600, DEFAULT_LAYOUT);
    expect(renderer.getWidth()).toBe(600);
  });

  it('renders clips with video thumbnails', () => {
    const rafCb: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafCb.push(cb);
      return rafCb.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    state = createDefaultState({
      clips: [
        {
          id: 'clip-1',
          assetId: 'asset-1',
          startTime: 0,
          duration: 10,
          sourceOffset: 0,
          sourceDuration: 10,
          thumbnails: [],
          width: 1920,
          height: 1080,
        },
      ],
    });

    const renderer = createRenderer();
    renderer.resize(800, DEFAULT_LAYOUT);
    renderer.markNeedsRender();
    rafCb[0]();

    // 应调用 fillRect 来绘制 placeholder（因为没有缩略图数据）
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('renders crop overlay when cropRange is set', () => {
    const rafCb: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafCb.push(cb);
      return rafCb.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    state = createDefaultState({
      cropRange: { start: 2, end: 8 },
      clips: [
        {
          id: 'clip-1',
          assetId: 'asset-1',
          startTime: 0,
          duration: 10,
          sourceOffset: 0,
          sourceDuration: 10,
          thumbnails: [],
          width: 1920,
          height: 1080,
        },
      ],
    });

    const renderer = createRenderer();
    renderer.resize(800, DEFAULT_LAYOUT);
    renderer.markNeedsRender();
    rafCb[0]();

    // crop overlay 使用 roundRect 绘制手柄
    expect(ctx.roundRect).toHaveBeenCalled();
  });

  it('renders playhead when currentTime is visible', () => {
    const rafCb: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafCb.push(cb);
      return rafCb.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    state = createDefaultState({ currentTime: 5 });

    const renderer = createRenderer();
    renderer.resize(800, DEFAULT_LAYOUT);
    renderer.markNeedsRender();
    rafCb[0]();

    // 播放头使用 bezierCurveTo 绘制指针头
    expect(ctx.bezierCurveTo).toHaveBeenCalled();
  });

  it('uses drawBackground hook when provided', () => {
    const rafCb: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafCb.push(cb);
      return rafCb.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const drawBackground = vi.fn();
    const renderer = new TimelineRenderer(canvas, () => state, thumbnailStore, waveformService, {
      hooks: { drawBackground },
    });
    renderer.resize(800, DEFAULT_LAYOUT);
    renderer.markNeedsRender();
    rafCb[0]();

    expect(drawBackground).toHaveBeenCalledWith(ctx, 800, expect.any(Number));
  });

  it('resize only sets canvas size when dimensions change', () => {
    const renderer = createRenderer();

    // 第一次 resize
    renderer.resize(800, DEFAULT_LAYOUT);
    const expectedH = DEFAULT_LAYOUT.rulerHeight + DEFAULT_LAYOUT.trackGap + DEFAULT_LAYOUT.thumbnailHeight;
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(expectedH);

    // 相同尺寸不应重新设置（通过验证值没有变化即可）
    renderer.resize(800, DEFAULT_LAYOUT);
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(expectedH);
  });
});
