/**
 * 媒体素材注册表
 * File 不可序列化，通过 assetId 引用
 */

import type { TimelineMediaAsset } from '../types';

export class MediaRegistry {
  private assets = new Map<string, TimelineMediaAsset>();

  registerVideoAsset(file: File): TimelineMediaAsset {
    const id = crypto.randomUUID();
    const objectUrl = URL.createObjectURL(file);
    const asset: TimelineMediaAsset = {
      id,
      file,
      objectUrl,
      mime: file.type,
      name: file.name,
      size: file.size,
    };
    this.assets.set(id, asset);
    return asset;
  }

  registerAudioAsset(file: File): TimelineMediaAsset {
    return this.registerVideoAsset(file);
  }

  getAsset(assetId: string): TimelineMediaAsset | null {
    return this.assets.get(assetId) ?? null;
  }

  releaseAsset(assetId: string): void {
    const asset = this.assets.get(assetId);
    if (!asset) return;
    URL.revokeObjectURL(asset.objectUrl);
    this.assets.delete(assetId);
  }

  clear(): void {
    for (const asset of this.assets.values()) {
      URL.revokeObjectURL(asset.objectUrl);
    }
    this.assets.clear();
  }

  has(assetId: string): boolean {
    return this.assets.has(assetId);
  }
}
