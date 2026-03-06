/**
 * 缩略图帧图集存储
 * 按 assetId 存储有序帧数组（CanvasImageSource，优先 ImageBitmap），支持按时间二分查找最近帧
 */

import type { FrameEntry } from '../types';

/**
 * 二分查找：返回 timestamp 最接近的帧
 */
function findNearest(frames: FrameEntry[], time: number): FrameEntry | null {
  if (frames.length === 0) return null;
  if (frames.length === 1) return frames[0];

  let lo = 0;
  let hi = frames.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].timestamp < time) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  // lo 是第一个 >= time 的索引，比较 lo 和 lo-1 谁更近
  if (lo === 0) return frames[0];
  const prev = frames[lo - 1];
  const curr = frames[lo];
  return Math.abs(prev.timestamp - time) <= Math.abs(curr.timestamp - time) ? prev : curr;
}

export class ThumbnailStore {
  private frameAtlas = new Map<string, FrameEntry[]>();

  setFrames(assetId: string, frames: FrameEntry[]): void {
    this.frameAtlas.set(assetId, frames);
  }

  appendFrame(assetId: string, frame: FrameEntry): void {
    let frames = this.frameAtlas.get(assetId);
    if (!frames) {
      frames = [];
      this.frameAtlas.set(assetId, frames);
    }
    frames.push(frame);
  }

  getFrameAtTime(assetId: string, time: number): CanvasImageSource | null {
    const frames = this.frameAtlas.get(assetId);
    if (!frames) return null;
    const entry = findNearest(frames, time);
    return entry?.img ?? null;
  }

  getFrameCount(assetId: string): number {
    return this.frameAtlas.get(assetId)?.length ?? 0;
  }

  has(assetId: string): boolean {
    const frames = this.frameAtlas.get(assetId);
    return !!frames && frames.length > 0;
  }

  clearAsset(assetId: string): void {
    this.releaseFrames(this.frameAtlas.get(assetId));
    this.frameAtlas.delete(assetId);
  }

  clear(): void {
    this.frameAtlas.forEach((frames) => this.releaseFrames(frames));
    this.frameAtlas.clear();
  }

  /** 释放帧数组中所有 ImageBitmap 的 GPU 内存 */
  private releaseFrames(frames: FrameEntry[] | undefined): void {
    frames?.forEach(({ img }) => {
      if (img instanceof ImageBitmap) img.close();
    });
  }
}
