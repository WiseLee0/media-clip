/**
 * 缩略图生成服务（基于 mediabunny）
 * 构造函数接收 VideoFrameCache + ThumbnailStore 实例
 */

import { CanvasSink } from 'mediabunny';
import type { VideoFrameCache } from './video-frame-cache';
import type { ThumbnailStore } from './thumbnail-store';

/** 默认采样间隔（秒）*/
const DEFAULT_SAMPLE_INTERVAL = 0.5;

export class ThumbnailService {
  private videoFrameCache: VideoFrameCache;
  private thumbnailStore: ThumbnailStore;

  constructor(videoFrameCache: VideoFrameCache, thumbnailStore: ThumbnailStore) {
    this.videoFrameCache = videoFrameCache;
    this.thumbnailStore = thumbnailStore;
  }

  async getVideoMeta(assetId: string): Promise<{ sourceDuration: number; width: number; height: number }> {
    const ctx = await this.videoFrameCache.getVideoDecoderCtx(assetId);
    return {
      sourceDuration: ctx.sourceDuration,
      width: ctx.width,
      height: ctx.height,
    };
  }

  async generateThumbnails(
    assetId: string,
    duration: number,
    thumbHeight: number,
    videoWidth: number,
    videoHeight: number,
    onUpdate?: () => void,
    signal?: AbortSignal,
    sampleInterval: number = DEFAULT_SAMPLE_INTERVAL,
  ): Promise<void> {
    if (this.thumbnailStore.has(assetId)) return;

    const aspect = videoWidth && videoHeight ? videoWidth / videoHeight : 16 / 9;
    const thumbW = Math.max(12, Math.floor(thumbHeight * aspect));

    const count = Math.max(1, Math.ceil(duration / sampleInterval));
    const timestamps: number[] = [];
    for (let i = 0; i < count; i++) {
      timestamps.push(((i + 0.5) * duration) / count);
    }

    const ctx = await this.videoFrameCache.getVideoDecoderCtx(assetId);
    if (signal?.aborted) return;

    // 为缩略图创建低分辨率 CanvasSink，避免以原始分辨率（如 4K）解码
    const thumbSink = new CanvasSink(ctx.track, {
      width: thumbW,
      height: thumbHeight,
      fit: 'contain',
      poolSize: 2,
    });

    const clampedTimestamps = timestamps.map((t) =>
      Math.max(0, Math.min(t, Math.max(0, ctx.sourceDuration - 0.001))),
    );
    const canvases = thumbSink.canvasesAtTimestamps(clampedTimestamps);
    if (!canvases) return;

    /** 最小重绘间隔（ms），避免高速解码时频繁触发 Canvas 重绘 */
    const FLUSH_MIN_INTERVAL_MS = 200;
    let lastFlush = 0;

    try {
      for (let i = 0; i < count; i++) {
        if (signal?.aborted) return;
        const canvas = await canvases.next();
        if (signal?.aborted) return;

        if (!canvas.value) continue;

        const img = await createImageBitmap(canvas.value.canvas);
        this.thumbnailStore.appendFrame(assetId, { timestamp: timestamps[i], img });

        const now = performance.now();
        const isLast = i === count - 1;
        if (isLast || now - lastFlush >= FLUSH_MIN_INTERVAL_MS) {
          onUpdate?.();
          lastFlush = now;
        }
      }
    } finally {
      try {
        await canvases.return(undefined as never);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  async disposeAsset(assetId: string): Promise<void> {
    await this.videoFrameCache.clearAsset(assetId);
    this.thumbnailStore.clearAsset(assetId);
  }
}
