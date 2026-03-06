/**
 * 视频帧解码服务（基于 mediabunny）
 * 构造函数接收 getAsset 函数，去除全局依赖
 */

import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  Input,
  type InputVideoTrack,
  type WrappedCanvas,
} from 'mediabunny';
import type { TimelineMediaAsset, FrameResult } from '../types';

type DecoderCtx = {
  input: Input<BlobSource>;
  track: InputVideoTrack;
  canvasSink: CanvasSink;
  nextFrame: WrappedCanvas | null;
  sourceDuration: number;
  width: number;
  height: number;
  /** 上一次 seek 的时间戳，用于检测向后 seek 并重置 generator */
  lastSeekTime?: number;
};

export class VideoFrameCache {
  private decoderMap = new Map<string, Promise<DecoderCtx>>();
  private canvasesMap = new Map<string, AsyncGenerator<WrappedCanvas>>();
  private getAsset: (assetId: string) => TimelineMediaAsset | null;
  /** resetCanvases 产生的异步清理 Promise，在创建新 generator 前 await */
  private cleanupPromises: Promise<void>[] = [];

  constructor(getAsset: (assetId: string) => TimelineMediaAsset | null) {
    this.getAsset = getAsset;
  }

  async getVideoDecoderCtx(assetId: string): Promise<DecoderCtx> {
    return await this._getDecoder(assetId);
  }

  async getCanvases(assetId: string, timestamp: number): Promise<AsyncGenerator<WrappedCanvas>> {
    if (this.canvasesMap.has(assetId)) {
      return this.canvasesMap.get(assetId) as AsyncGenerator<WrappedCanvas>;
    }
    // 等待上一轮 resetCanvases 的清理完成，确保旧 generator 内的 VideoSample 已 close
    if (this.cleanupPromises.length > 0) {
      await Promise.all(this.cleanupPromises);
      this.cleanupPromises = [];
    }
    const ctx = await this._getDecoder(assetId);
    const canvases = ctx.canvasSink.canvases(timestamp);
    this.canvasesMap.set(assetId, canvases);
    ctx.nextFrame = (await canvases.next())?.value ?? null;
    return this.canvasesMap.get(assetId) as AsyncGenerator<WrappedCanvas>;
  }

  /**
   * 获取视频帧的原始 canvas（零拷贝，适用于播放时直接绘制）
   */
  async getFrameCanvas(assetId: string, timestamp: number): Promise<FrameResult | null> {
    try {
      const asset = this.getAsset(assetId);
      if (!asset) return null;

      const ctx = await this._getDecoder(assetId);
      const clampedTimestamp = Math.max(0, Math.min(timestamp, Math.max(0, ctx.sourceDuration - 0.001)));

      // 向后 seek 检测：目标时间早于上次 seek 位置时，重置 generator 以重新定位
      if (
        ctx.lastSeekTime !== undefined &&
        clampedTimestamp < ctx.lastSeekTime &&
        this.canvasesMap.has(assetId)
      ) {
        const oldGen = this.canvasesMap.get(assetId)!;
        this.canvasesMap.delete(assetId);
        try {
          await oldGen.return(null as unknown as WrappedCanvas);
        } catch {
          // ignore cleanup errors
        }
      }
      ctx.lastSeekTime = clampedTimestamp;

      const canvases = await this.getCanvases(assetId, clampedTimestamp);
      while (ctx.nextFrame) {
        if (ctx.nextFrame.timestamp <= clampedTimestamp) {
          ctx.nextFrame = (await canvases.next())?.value ?? null;
        } else {
          const canvas = ctx.nextFrame.canvas;
          return { canvas, width: ctx.width, height: ctx.height };
        }
      }
      return null;
    } catch (error) {
      console.error('VideoFrameCache: 解码视频帧失败', error);
      return null;
    }
  }

  /**
   * 获取视频帧（返回 ImageBitmap，适用于非播放时 seek 预览）
   */
  async getFrame(assetId: string, timestamp: number): Promise<ImageBitmap | null> {
    const result = await this.getFrameCanvas(assetId, timestamp);
    if (!result) return null;
    return await createImageBitmap(result.canvas);
  }

  private async _getDecoder(assetId: string): Promise<DecoderCtx> {
    const cached = this.decoderMap.get(assetId);
    if (cached) return cached;

    const promise = (async () => {
      const asset = this.getAsset(assetId);
      if (!asset) throw new Error(`asset 不存在: ${assetId}`);

      const input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(asset.file),
      });

      const sourceDuration = await input.computeDuration();
      const track = await input.getPrimaryVideoTrack();
      if (!track) {
        input.dispose();
        throw new Error('该文件不包含视频轨道');
      }

      const videoCanBeTransparent = await track.canBeTransparent();
      const canvasSink = new CanvasSink(track, {
        poolSize: 2,
        fit: 'contain',
        alpha: videoCanBeTransparent,
      });

      let width = track.displayWidth ?? track.codedWidth ?? 0;
      let height = track.displayHeight ?? track.codedHeight ?? 0;

      if (!width || !height) {
        width = 1920;
        height = 1080;
      }

      return {
        input,
        nextFrame: null as WrappedCanvas | null,
        track,
        canvasSink,
        sourceDuration,
        width,
        height,
      };
    })();

    this.decoderMap.set(assetId, promise);
    return promise;
  }

  resetCanvases(): void {
    // 清理 nextFrame 引用，避免持有过期的 WrappedCanvas
    for (const decoderPromise of this.decoderMap.values()) {
      decoderPromise
        .then((ctx) => {
          ctx.nextFrame = null;
        })
        .catch(() => {
          /* ignore */
        });
    }
    // 收集 generator 清理 Promise，确保内部 VideoSample 在新 generator 创建前被 close
    const promises: Promise<void>[] = [];
    this.canvasesMap.forEach((item) => {
      promises.push(
        item
          .return(null as unknown as WrappedCanvas)
          .then(() => {
            /* noop */
          })
          .catch(() => {
            /* ignore */
          }),
      );
    });
    this.canvasesMap.clear();
    this.cleanupPromises = promises;
  }

  async clearAsset(assetId: string): Promise<void> {
    // 先关闭 canvases generator，确保内部 VideoSample 被正确 close
    const canvases = this.canvasesMap.get(assetId);
    this.canvasesMap.delete(assetId);
    if (canvases) {
      try {
        await canvases.return(null as unknown as WrappedCanvas);
      } catch {
        // ignore cleanup errors
      }
    }

    const decoderPromise = this.decoderMap.get(assetId);
    this.decoderMap.delete(assetId);
    if (decoderPromise) {
      try {
        const ctx = await decoderPromise;
        ctx.nextFrame = null;
        ctx.input.dispose();
      } catch {
        // ignore
      }
    }
  }

  async clear(): Promise<void> {
    // 先关闭所有 canvases generator，确保内部 VideoSample 被正确 close
    for (const [, canvases] of this.canvasesMap.entries()) {
      try {
        await canvases.return(null as unknown as WrappedCanvas);
      } catch {
        // ignore cleanup errors
      }
    }
    this.canvasesMap.clear();

    for (const [, decoderPromise] of this.decoderMap.entries()) {
      try {
        const ctx = await decoderPromise;
        ctx.nextFrame = null;
        ctx.input.dispose();
      } catch {
        // ignore
      }
    }
    this.decoderMap.clear();
  }
}
