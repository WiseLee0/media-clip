/**
 * media-clip-core Canvas 渲染器
 * 构造函数注入 getState 和 thumbnailStore
 */

import type { TimelineState, VideoClip, TimelineRenderHooks, ClipRect, CanvasLayout } from './types';
import { TIMELINE_CONFIG, LIGHT_THEME_COLORS, TIME_INTERVALS, type TimelineColorScheme } from './constants';
import { formatTimeShort } from './utils/time';
import type { ThumbnailStore } from './media/thumbnail-store';
import type { WaveformService } from './media/waveform-service';

export class TimelineRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number;
  private width = 0;
  private height = 0;
  private needsRender = false;
  private destroyed = false;
  private rafId: number | null = null;
  private colors: TimelineColorScheme;

  /** 刻度尺高度（px） */
  private rulerHeight: number = TIMELINE_CONFIG.RULER_HEIGHT;
  /** 刻度尺与缩略图轨道之间的间距（px） */
  private trackGap = 0;

  /** 获取渲染区域宽度（px） */
  getWidth(): number {
    return this.width;
  }

  private rulerLayer: OffscreenCanvas | null = null;
  private rulerCtx: OffscreenCanvasRenderingContext2D | null = null;
  private rulerCacheKey = '';

  private getState: () => TimelineState;
  private thumbnailStore: ThumbnailStore;
  private waveformService: WaveformService | null;
  private hooks: TimelineRenderHooks;

  constructor(
    canvas: HTMLCanvasElement,
    getState: () => TimelineState,
    thumbnailStore: ThumbnailStore,
    waveformService?: WaveformService,
    options?: { hooks?: TimelineRenderHooks; colors?: TimelineColorScheme },
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 Canvas 2D 上下文');
    this.ctx = ctx;
    this.dpr = window.devicePixelRatio || 1;
    this.getState = getState;
    this.thumbnailStore = thumbnailStore;
    this.waveformService = waveformService ?? null;
    this.hooks = options?.hooks ?? {};
    this.colors = options?.colors ?? LIGHT_THEME_COLORS;
  }

  /** 动态更新颜色方案（主题切换时调用），更新后自动触发重绘 */
  setColors(colors: TimelineColorScheme): void {
    this.colors = colors;
    this.rulerCacheKey = ''; // 清除刻度尺缓存，强制重绘
    this.markNeedsRender();
  }

  markNeedsRender(): void {
    this.needsRender = true;
    if (this.rafId === null && !this.destroyed) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        if (this.destroyed) return;
        if (this.needsRender) {
          this.render(this.getState());
        }
      });
    }
  }

  resize(width: number, layout: CanvasLayout): void {
    this.rulerHeight = layout.rulerHeight;
    this.trackGap = layout.trackGap;

    const height = layout.rulerHeight + layout.trackGap + layout.thumbnailHeight;
    this.width = width;
    this.height = height;

    // 仅在尺寸实际变化时设置 canvas 尺寸（设置 canvas.width/height 会隐式清空画布内容）
    const newCanvasW = width * this.dpr;
    const newCanvasH = height * this.dpr;
    if (this.canvas.width !== newCanvasW || this.canvas.height !== newCanvasH) {
      this.canvas.width = newCanvasW;
      this.canvas.height = newCanvasH;
    }
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    this.rulerLayer = new OffscreenCanvas(newCanvasW, layout.rulerHeight * this.dpr);
    this.rulerCtx = this.rulerLayer.getContext('2d');
    this.rulerCacheKey = '';
  }

  private render(state: TimelineState): void {
    this.needsRender = false;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.clear();
    this.drawBackground();
    this.drawRulerCached(state);
    this.drawTrack(state);
    this.drawCropOverlay(state);
    this.drawPlayhead(state);
  }

  private clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  private drawBackground(): void {
    if (this.hooks.drawBackground) {
      this.hooks.drawBackground(this.ctx, this.width, this.height);
      return;
    }
    this.ctx.fillStyle = this.colors.BACKGROUND;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawRulerCached(state: TimelineState): void {
    if (!this.rulerLayer || !this.rulerCtx) return;

    const cacheKey = `${state.scale}:${state.scrollX}:${state.totalDuration}:${this.width}`;
    if (this.rulerCacheKey !== cacheKey) {
      this.drawRulerToLayer(state);
      this.rulerCacheKey = cacheKey;
    }

    this.ctx.drawImage(this.rulerLayer, 0, 0, this.width, this.rulerHeight);
  }

  private drawRulerToLayer(state: TimelineState): void {
    const ctx = this.rulerCtx!;
    const rulerH = this.rulerHeight;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, rulerH);

    const { RULER_LINE, RULER_TEXT } = this.colors;
    const { TRACK_PADDING_H } = TIMELINE_CONFIG;
    const { scale, scrollX } = state;

    /** 内容区域左右边界 */
    const contentLeft = TRACK_PADDING_H;
    const contentRight = this.width - TRACK_PADDING_H;

    const { interval, subDivisions } = this.calculateInterval(scale);
    const startTime = Math.floor(scrollX / scale / interval) * interval;
    const endTime = Math.ceil((scrollX + this.width) / scale / interval) * interval;

    /** 刻度尺内容垂直居中基线 */
    const centerY = rulerH / 2;
    ctx.font = '11px Inter, sans-serif';
    ctx.textBaseline = 'middle';

    // 裁剪到内容区域，防止刻度溢出左右 padding
    ctx.save();
    ctx.beginPath();
    ctx.rect(contentLeft, 0, contentRight - contentLeft, rulerH);
    ctx.clip();

    for (let time = startTime; time <= endTime; time += interval) {
      const x = time * scale - scrollX + TRACK_PADDING_H;

      // 大刻度：仅绘制文字标签，靠近左/右边界时切换对齐方式防止被裁剪
      if (x >= contentLeft - 8 && x <= contentRight + 8) {
        ctx.fillStyle = RULER_TEXT;
        const label = formatTimeShort(time);
        if (x < contentLeft + 4) {
          ctx.textAlign = 'left';
          ctx.fillText(label, contentLeft, centerY);
        } else if (x > contentRight - 4) {
          ctx.textAlign = 'right';
          ctx.fillText(label, contentRight, centerY);
        } else {
          ctx.textAlign = 'center';
          ctx.fillText(label, x, centerY);
        }
      }

      // 小刻度：绘制 1×2 竖向椭圆，垂直居中
      // 即使大刻度在可视区域外，其小刻度仍可能可见，因此独立判断
      const lastSubX = x + (interval / subDivisions) * (subDivisions - 1) * scale;
      if (x > contentRight || lastSubX < contentLeft) continue;

      ctx.fillStyle = RULER_LINE;
      for (let i = 1; i < subDivisions; i++) {
        const subX = x + (interval / subDivisions) * i * scale;
        if (subX > contentRight) break;
        if (subX < contentLeft) continue;
        ctx.beginPath();
        ctx.ellipse(subX, centerY, 0.5, 1, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private drawTrack(state: TimelineState): void {
    const trackY = this.rulerHeight + this.trackGap;
    const trackHeight = this.height - trackY;
    const { TRACK_PADDING_H } = TIMELINE_CONFIG;
    const ctx = this.ctx;

    ctx.save();
    ctx.beginPath();
    // 裁剪到左右 padding 内的内容区域
    ctx.rect(TRACK_PADDING_H, trackY, this.width - TRACK_PADDING_H * 2, trackHeight);
    ctx.clip();

    this.drawClips(state, trackY);

    ctx.restore();
  }

  private drawClips(state: TimelineState, trackY: number): void {
    const { CLIP_BORDER_RADIUS, CLIP_PADDING, TRACK_PADDING_H } = TIMELINE_CONFIG;
    const trackHeight = this.height - this.rulerHeight - this.trackGap;
    const { scale, scrollX, clips } = state;

    /** 内容区域右边界 */
    const contentRight = this.width - TRACK_PADDING_H;

    clips.forEach((clip) => {
      const x = clip.startTime * scale - scrollX + TRACK_PADDING_H;
      const sourceX = (clip.startTime - clip.sourceOffset) * scale - scrollX + TRACK_PADDING_H;
      const clipWidth = clip.duration * scale;
      const y = trackY + CLIP_PADDING;
      const clipHeight = trackHeight - CLIP_PADDING * 2;

      if (x + clipWidth < TRACK_PADDING_H || x > contentRight) return;

      const visibleX = Math.max(x, TRACK_PADDING_H);
      const visibleWidth = Math.min(x + clipWidth, contentRight) - visibleX;
      if (visibleWidth <= 0) return;

      const rect: ClipRect = { x, y, width: clipWidth, height: clipHeight, sourceX };

      this.ctx.save();
      this.drawRoundRect(x, y, clipWidth, clipHeight, CLIP_BORDER_RADIUS);
      this.ctx.fillStyle = this.colors.VIDEO_CLIP;
      this.ctx.fill();

      // drawClipContent 钩子返回 true 时跳过内置实现
      const handled = this.hooks.drawClipContent?.(this.ctx, clip, rect);
      if (!handled) {
        if (clip.type === 'audio') {
          this.drawAudioWaveform(clip, x, y, clipWidth, clipHeight);
        } else {
          this.drawVideoThumbnails(clip, x, y, clipWidth, clipHeight, sourceX);
        }
      }

      // 叠加层钩子：无论 drawClipContent 是否被覆盖，始终调用
      this.hooks.drawClipOverlay?.(this.ctx, clip, rect);

      this.ctx.restore();
    });
  }

  private drawVideoThumbnails(
    clip: VideoClip,
    x: number,
    y: number,
    width: number,
    height: number,
    sourceX: number,
  ): void {
    const hasThumbs = this.thumbnailStore.has(clip.assetId);

    if (!hasThumbs) {
      const ctx = this.ctx;
      ctx.save();
      const radius = TIMELINE_CONFIG.CLIP_BORDER_RADIUS;
      this.drawRoundRect(x, y, width, height, radius);
      ctx.clip();
      ctx.fillStyle = this.colors.THUMBNAIL_PLACEHOLDER;
      ctx.fillRect(x, y, width, height);
      ctx.restore();
      return;
    }

    const aspect = clip.width && clip.height ? clip.width / clip.height : 16 / 9;
    const thumbH = Math.max(8, Math.floor(height));
    const thumbW = Math.max(12, Math.floor(thumbH * aspect));

    const ctx = this.ctx;
    ctx.save();
    const radius = TIMELINE_CONFIG.CLIP_BORDER_RADIUS;
    this.drawRoundRect(x, y, width, height, radius);
    ctx.clip();

    const maxTiles = Math.ceil(width / thumbW) + 1;

    // 缺帧占位填充色统一设置一次，避免在循环中反复赋值
    ctx.fillStyle = this.colors.THUMBNAIL_PLACEHOLDER;

    for (let i = 0; i < maxTiles; i++) {
      const tileX = sourceX + i * thumbW;
      if (tileX > x + width) break;

      const tileTime = ((tileX - sourceX + thumbW / 2) / width) * clip.duration;
      const thumb = this.thumbnailStore.getFrameAtTime(clip.assetId, tileTime);

      if (thumb) {
        try {
          ctx.drawImage(thumb, tileX, y, thumbW, height);
        } catch {
          ctx.fillRect(tileX, y, thumbW, height);
        }
      } else {
        ctx.fillRect(tileX, y, thumbW, height);
      }
    }

    // 所有分隔线合并为单次 stroke，减少 Canvas 状态切换和绘制调用次数
    ctx.strokeStyle = this.colors.THUMBNAIL_SEPARATOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < maxTiles; i++) {
      const tileX = sourceX + i * thumbW;
      if (tileX > x + width) break;
      ctx.moveTo(tileX + thumbW, y);
      ctx.lineTo(tileX + thumbW, y + height);
    }
    ctx.stroke();

    ctx.restore();
  }

  private drawAudioWaveform(clip: VideoClip, x: number, y: number, width: number, height: number): void {
    const ctx = this.ctx;
    const radius = TIMELINE_CONFIG.CLIP_BORDER_RADIUS;

    ctx.save();
    this.drawRoundRect(x, y, width, height, radius);
    ctx.clip();

    const peaks = this.waveformService?.getPeaks(clip.assetId);
    if (!peaks) {
      ctx.restore();
      return;
    }

    const peakCount = peaks.peaks.length / 2;
    const peaksPerSecond = peakCount / peaks.duration;

    // 固定 bar 宽度，动态计算 bar 数量（剪映方案）
    const barWidth = TIMELINE_CONFIG.WAVEFORM_BAR_WIDTH;
    const barGap = TIMELINE_CONFIG.WAVEFORM_BAR_GAP;
    const barStep = barWidth + barGap;
    const barCount = Math.floor(width / barStep);

    if (barCount <= 0) {
      ctx.restore();
      return;
    }

    // 每个 bar 覆盖的时间段
    const secondsPerBar = clip.duration / barCount;
    const centerY = y + height / 2;
    const amplitude = height / 2;

    ctx.fillStyle = this.colors.AUDIO_WAVEFORM;
    ctx.beginPath();

    for (let i = 0; i < barCount; i++) {
      // 当前 bar 对应的时间范围
      const timeStart = clip.sourceOffset + i * secondsPerBar;
      const timeEnd = timeStart + secondsPerBar;

      // 映射到 peaks 数组索引
      const peakStart = Math.floor(timeStart * peaksPerSecond);
      const peakEnd = Math.min(Math.ceil(timeEnd * peaksPerSecond), peakCount);

      // 在该范围内取极值（重采样）
      let minVal = 0;
      let maxVal = 0;
      for (let j = peakStart; j < peakEnd; j++) {
        minVal = Math.min(minVal, peaks.peaks[j * 2]);
        maxVal = Math.max(maxVal, peaks.peaks[j * 2 + 1]);
      }

      const barX = x + i * barStep;
      const barTop = centerY - maxVal * amplitude;
      const barBottom = centerY - minVal * amplitude;
      const barH = Math.max(1, barBottom - barTop);

      ctx.rect(barX, barTop, barWidth, barH);
    }

    ctx.fill();
    ctx.restore();
  }

  private drawCropOverlay(state: TimelineState): void {
    const { cropRange } = state;
    if (!cropRange) return;

    const { CLIP_PADDING, CROP_HANDLE_WIDTH, TRACK_PADDING_H } = TIMELINE_CONFIG;
    const { CROP_MASK, CROP_BORDER, CROP_HANDLE, CROP_HANDLE_INNER } = this.colors;
    const { scale, scrollX } = state;
    const ctx = this.ctx;

    const trackY = this.rulerHeight + this.trackGap + CLIP_PADDING;
    const trackH = this.height - this.rulerHeight - this.trackGap - CLIP_PADDING * 2;

    const cropLeftX = cropRange.start * scale - scrollX + TRACK_PADDING_H;
    const cropRightX = cropRange.end * scale - scrollX + TRACK_PADDING_H;

    /** 手柄内部指示条：宽 2px，高 12px，顶部两角圆角 */
    const INDICATOR_W = 2;
    const INDICATOR_H = 12;

    ctx.save();

    // 左右蒙版：延伸到手柄内侧边缘，手柄下方也被遮罩覆盖
    const maskLeftEnd = cropLeftX + CROP_HANDLE_WIDTH;
    const maskRightStart = cropRightX - CROP_HANDLE_WIDTH;
    if (maskLeftEnd > 0) {
      ctx.fillStyle = CROP_MASK;
      ctx.fillRect(0, trackY, maskLeftEnd, trackH);
    }
    if (maskRightStart < this.width) {
      ctx.fillStyle = CROP_MASK;
      ctx.fillRect(maskRightStart, trackY, this.width - maskRightStart, trackH);
    }

    // 绘制左右手柄
    // roundRect 圆角顺序：左上、右上、右下、左下
    // 左手柄外侧（左边）圆角，内侧（右边）直角；右手柄相反
    const drawHandle = (handleX: number, isLeft: boolean): void => {
      // 左手柄从刻度位置开始向右延伸，右手柄从刻度位置向左延伸
      const hx = isLeft ? handleX : handleX - CROP_HANDLE_WIDTH;
      const radii: [number, number, number, number] = isLeft ? [6, 0, 0, 6] : [0, 6, 6, 0];

      ctx.fillStyle = CROP_HANDLE;
      ctx.beginPath();
      ctx.roundRect(hx, trackY, CROP_HANDLE_WIDTH, trackH, radii);
      ctx.fill();

      // 内部指示条：2×12，居中于手柄矩形内，垂直居中
      const indicatorX = hx + (CROP_HANDLE_WIDTH - INDICATOR_W) / 2;
      const indicatorY = trackY + (trackH - INDICATOR_H) / 2;
      ctx.fillStyle = CROP_HANDLE_INNER;
      ctx.beginPath();
      ctx.roundRect(indicatorX, indicatorY, INDICATOR_W, INDICATOR_H, [1, 1, 1, 1]);
      ctx.fill();
    };

    const contentLeft = TRACK_PADDING_H;
    const contentRight = this.width - TRACK_PADDING_H;
    ctx.save();
    ctx.beginPath();
    ctx.rect(contentLeft, trackY, contentRight - contentLeft, trackH);
    ctx.clip();

    /** 上下边框线线宽 */
    const BORDER_W = 2;

    // 上下边框线：绘制在左右手柄之间，用 fillRect 替代 stroke 避免抗锯齿缝隙
    ctx.fillStyle = CROP_BORDER;
    const borderLeft = cropLeftX + CROP_HANDLE_WIDTH;
    const borderRight = cropRightX - CROP_HANDLE_WIDTH;
    ctx.fillRect(borderLeft, trackY, borderRight - borderLeft, BORDER_W);
    ctx.fillRect(borderLeft, trackY + trackH - BORDER_W, borderRight - borderLeft, BORDER_W);

    drawHandle(cropLeftX, true);
    drawHandle(cropRightX, false);

    ctx.restore();

    ctx.restore();
  }

  private drawPlayhead(state: TimelineState): void {
    if (state.clips.length === 0) return;

    const { TRACK_PADDING_H, CLIP_PADDING } = TIMELINE_CONFIG;
    const { PLAYHEAD, PLAYHEAD_FILL, PLAYHEAD_STROKE } = this.colors;
    const { currentTime, scale, scrollX } = state;

    const x = currentTime * scale - scrollX + TRACK_PADDING_H;
    if (x < TRACK_PADDING_H || x > this.width - TRACK_PADDING_H) return;

    const ctx = this.ctx;
    const trackBottom = this.height - CLIP_PADDING;

    ctx.strokeStyle = PLAYHEAD;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 15);
    ctx.lineTo(x, trackBottom);
    ctx.stroke();

    // 指针头：按 SVG 路径原始坐标，中心 svgX=6，映射到 canvas 中心 x（偏移 svgX-6）
    ctx.beginPath();
    ctx.moveTo(x - 2, 0.75);
    ctx.lineTo(x + 2, 0.75);
    ctx.bezierCurveTo(x + 3.821, 0.75, x + 5.25, 2.167, x + 5.25, 3.858);
    ctx.lineTo(x + 5.25, 11.507);
    ctx.bezierCurveTo(x + 5.25, 11.889, x + 5.051, 12.258, x + 4.702, 12.481);
    ctx.lineTo(x + 0.702, 15.046);
    ctx.bezierCurveTo(x + 0.278, 15.318, x - 0.278, 15.318, x - 0.702, 15.046);
    ctx.lineTo(x - 4.702, 12.481);
    ctx.bezierCurveTo(x - 5.051, 12.258, x - 5.25, 11.889, x - 5.25, 11.507);
    ctx.lineTo(x - 5.25, 3.858);
    ctx.bezierCurveTo(x - 5.25, 2.167, x - 3.821, 0.75, x - 2, 0.75);
    ctx.closePath();

    ctx.fillStyle = PLAYHEAD_FILL;
    ctx.fill();
    ctx.strokeStyle = PLAYHEAD_STROKE;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private drawRoundRect(x: number, y: number, width: number, height: number, radius: number): void {
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, width, height, radius);
  }

  private calculateInterval(scale: number): { interval: number; subDivisions: number } {
    for (const config of TIME_INTERVALS) {
      if (scale >= config.minScale) {
        return { interval: config.interval, subDivisions: config.subDivisions };
      }
    }
    return { interval: 10, subDivisions: 5 };
  }

  destroy(clearCanvas = true): void {
    this.destroyed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (clearCanvas) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.rulerLayer = null;
    this.rulerCtx = null;
    this.rulerCacheKey = '';
  }
}
