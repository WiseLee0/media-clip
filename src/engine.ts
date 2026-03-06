/**
 * MediaClipEngine — Headless 视频剪辑引擎门面类
 * 拥有所有子模块实例，提供统一 API，内置 RAF 播放循环
 */

import type {
  TimelineState,
  VideoClip,
  CropRange,
  CropConfig,
  ExportOptions,
  FrameResult,
  CanvasLayout,
} from './types';
import { TIMELINE_CONFIG, DEFAULT_CROP_CONFIG, getDurationTier, type TimelineColorScheme } from './constants';
import { TimelineStore } from './store';
import { TimelineRenderer } from './renderer';
import { TimelineEventHandler, type TimelineEventCallbacks } from './event-handler';
import { MediaRegistry } from './media/registry';
import { ThumbnailStore } from './media/thumbnail-store';
import { ThumbnailService } from './media/thumbnail-service';
import { VideoFrameCache } from './media/video-frame-cache';
import { WaveformService } from './media/waveform-service';
import { exportCroppedVideo } from './export';

export interface MediaClipEngineOptions {
  cropConfig?: CropConfig;
  /** 颜色方案，不传则使用亮色主题 */
  colors?: TimelineColorScheme;
}

export class MediaClipEngine {
  // 子模块实例
  readonly store: TimelineStore;
  readonly mediaRegistry: MediaRegistry;
  readonly thumbnailStore: ThumbnailStore;
  readonly videoFrameCache: VideoFrameCache;
  readonly thumbnailService: ThumbnailService;
  readonly waveformService: WaveformService;

  private renderer: TimelineRenderer | null = null;
  private eventHandler: TimelineEventHandler | null = null;
  private canvas: HTMLCanvasElement | null = null;

  private cropConfig: CropConfig;
  private colors: TimelineColorScheme | undefined;
  private thumbAbort: AbortController | null = null;
  private seekSeq = 0;
  private destroyed = false;

  // 播放循环
  private playRafId: number | null = null;
  private playLastTime = 0;
  private playUnsubscribe: (() => void) | null = null;

  // seek 预览帧 RAF 节流
  private seekRafId: number | null = null;
  private pendingSeekTime: number | null = null;

  // 播放时帧解码并发控制
  private directDecoding = false;
  private directPendingTime: number | null = null;

  // 音频播放
  private audioElement: HTMLAudioElement | null = null;
  private audioAssetId: string | null = null;

  // 预览帧直绘回调（UI 层注入）
  onPreviewFrameDirect:
    | ((
        source: HTMLCanvasElement | OffscreenCanvas | CanvasImageSource,
        width: number,
        height: number,
      ) => void)
    | null = null;

  constructor(options?: MediaClipEngineOptions) {
    this.cropConfig = options?.cropConfig ?? DEFAULT_CROP_CONFIG;
    this.colors = options?.colors;

    this.store = new TimelineStore();
    this.mediaRegistry = new MediaRegistry();
    this.thumbnailStore = new ThumbnailStore();
    this.videoFrameCache = new VideoFrameCache((id) => this.mediaRegistry.getAsset(id));
    this.thumbnailService = new ThumbnailService(this.videoFrameCache, this.thumbnailStore);
    this.waveformService = new WaveformService();

    // Store 的 orphan 回调：释放素材
    this.store.onAssetOrphan = (assetId) => {
      this.mediaRegistry.releaseAsset(assetId);
    };

    // 监听 isPlaying 变化来启动/停止播放循环
    // 用 prevIsPlaying 追踪上一次值，避免播放期间每帧 setState 都触发此回调的冗余检查
    let prevIsPlaying = false;
    this.playUnsubscribe = this.store.subscribe(() => {
      const { isPlaying } = this.store.getState();
      if (isPlaying === prevIsPlaying) return;
      prevIsPlaying = isPlaying;
      if (isPlaying && this.playRafId === null) {
        this.startPlayLoop();
      }
    });
  }

  // --- 生命周期 ---

  /** 默认 Canvas 布局尺寸 */
  private static readonly DEFAULT_LAYOUT: CanvasLayout = {
    rulerHeight: TIMELINE_CONFIG.RULER_HEIGHT,
    trackGap: 0,
    thumbnailHeight: TIMELINE_CONFIG.VIDEO_TRACK_HEIGHT + TIMELINE_CONFIG.CLIP_PADDING * 2,
  };

  /**
   * 挂载 Canvas。
   * @param layout Canvas 布局尺寸（rulerHeight / trackGap / thumbnailHeight）
   */
  attachCanvas(canvas: HTMLCanvasElement, containerWidth?: number, layout?: CanvasLayout): void {
    this.canvas = canvas;
    const width = containerWidth ?? canvas.parentElement?.clientWidth ?? canvas.clientWidth;
    const resolvedLayout = layout ?? MediaClipEngine.DEFAULT_LAYOUT;

    this.renderer = new TimelineRenderer(
      canvas,
      () => this.store.getState(),
      this.thumbnailStore,
      this.waveformService,
      { colors: this.colors },
    );
    this.renderer.resize(width, resolvedLayout);

    const callbacks: TimelineEventCallbacks = {
      onStateChange: (partial) => this.store.setState(partial),
      onRequestRender: () => this.requestRender(),
      onPlayheadSeek: (time) => {
        this.scheduleSeekPreview(time);
      },
      onUserInteraction: () => {
        // 播放中用户操作了时间轴（滚动/缩放），暂停播放
        if (this.store.getState().isPlaying) {
          this.pause();
          this.requestRender();
        }
      },
      onCropDragEnd: (dragType) => {
        const { cropRange } = this.store.getState();
        if (!cropRange) return;
        // 左手柄/移动裁剪框 → 播放头吸附到左侧；右手柄 → 播放头吸附到右侧
        const seekTime = dragType === 'crop-right' ? cropRange.end : cropRange.start;
        this.seek(seekTime);
      },
    };

    this.eventHandler = new TimelineEventHandler(canvas, callbacks, () => this.store.getState());
    this.eventHandler.updateCropConfig(this.cropConfig);
    this.eventHandler.updateLayout(resolvedLayout);

    this.requestRender();
  }

  detachCanvas(clearCanvas = true): void {
    this.eventHandler?.destroy();
    this.renderer?.destroy(clearCanvas);
    this.eventHandler = null;
    this.renderer = null;
    this.canvas = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.stopPlayLoop();
    this.playUnsubscribe?.();

    if (this.seekRafId !== null) {
      cancelAnimationFrame(this.seekRafId);
      this.seekRafId = null;
    }
    this.pendingSeekTime = null;

    this.thumbAbort?.abort();
    this.disposeAudioElement();
    this.detachCanvas();
    this.thumbnailStore.clear();
    this.waveformService.clear();
    this.videoFrameCache.resetCanvases();
    void this.videoFrameCache.clear();
    this.mediaRegistry.clear();
    this.store.reset();
  }

  // --- 状态订阅 ---

  getState(): TimelineState {
    return this.store.getState();
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener);
  }

  // --- 核心操作 ---

  /** 判断文件是否为音频类型 */
  private isAudioFile(file: File): boolean {
    return file.type.startsWith('audio/');
  }

  /**
   * 添加媒体文件（视频或音频），替换现有内容
   * 自动根据文件 MIME 类型识别并选择对应处理流程
   */
  async addMedia(file: File): Promise<void> {
    // 暂停播放
    this.store.setState({ isPlaying: false, currentTime: 0 });

    // 中止旧缩略图任务
    this.thumbAbort?.abort();
    this.thumbAbort = null;

    // 清理旧资源
    this.disposeAudioElement();
    const s = this.store.getState();
    if (s.clips.length > 0) {
      const oldAssetIds = new Set(s.clips.map((c) => c.assetId));
      for (const oldId of oldAssetIds) {
        this.thumbnailStore.clearAsset(oldId);
        this.waveformService.clearAsset(oldId);
      }
      this.store.clearAllClips();
      for (const oldId of oldAssetIds) {
        await this.videoFrameCache.clearAsset(oldId);
      }
    }

    if (this.isAudioFile(file)) {
      await this.addAudioInternal(file);
    } else {
      await this.addVideoInternal(file);
    }
  }

  private async addVideoInternal(file: File): Promise<void> {
    const asset = this.mediaRegistry.registerVideoAsset(file);

    let meta: { sourceDuration: number; width: number; height: number };
    try {
      meta = await this.thumbnailService.getVideoMeta(asset.id);
    } catch (e) {
      console.warn('解析视频失败：', e);
      return;
    }

    const duration = Math.max(0.1, meta.sourceDuration || 0.1);

    const clipId = crypto.randomUUID();
    const newClip: VideoClip = {
      id: clipId,
      assetId: asset.id,
      name: file.name,
      startTime: 0,
      duration,
      sourceOffset: 0,
      sourceDuration: meta.sourceDuration,
      thumbnails: [],
      width: meta.width,
      height: meta.height,
    };

    this.store.addClip(newClip);

    const cropEnd = Math.min(duration, this.cropConfig.maxDuration);
    this.store.setState({
      totalDuration: duration,
      cropRange: { start: 0, end: cropEnd },
      currentTime: 0,
    });

    // 创建音频播放元素（视频文件中的音轨）
    this.disposeAudioElement();
    this.audioElement = new Audio(asset.objectUrl);
    this.audioElement.preload = 'auto';
    this.audioAssetId = asset.id;

    this.requestRender();

    // 初始化预览帧，完成后清理 canvases generator 中堆积的 VideoSample，再启动缩略图生成
    // 避免两个 CanvasSink 在同一 track 上并发解码导致 VideoSample 泄漏
    await this.updatePreviewFrame(0);
    this.videoFrameCache.resetCanvases();

    this.requestRender();

    // 生成缩略图（根据视频时长分级决定采样间隔）
    const abortController = new AbortController();
    this.thumbAbort = abortController;

    const { CLIP_PADDING, VIDEO_TRACK_HEIGHT } = TIMELINE_CONFIG;
    const thumbHeight = Math.max(8, VIDEO_TRACK_HEIGHT - CLIP_PADDING * 2);
    const tier = getDurationTier(duration);

    this.thumbnailService.generateThumbnails(
      asset.id,
      duration,
      thumbHeight,
      meta.width,
      meta.height,
      () => this.requestRender(),
      abortController.signal,
      tier.sampleInterval,
    );
  }

  private async addAudioInternal(file: File): Promise<void> {
    const asset = this.mediaRegistry.registerAudioAsset(file);

    let peaks;
    try {
      peaks = await this.waveformService.extractPeaks(asset.id, file);
    } catch (e) {
      console.warn('解析音频失败：', e);
      return;
    }

    const duration = Math.max(0.1, peaks.duration || 0.1);

    const clipId = crypto.randomUUID();
    const newClip: VideoClip = {
      id: clipId,
      type: 'audio',
      assetId: asset.id,
      name: file.name,
      startTime: 0,
      duration,
      sourceOffset: 0,
      sourceDuration: duration,
      thumbnails: [],
      width: 0,
      height: 0,
    };

    this.store.addClip(newClip);

    const cropEnd = Math.min(duration, this.cropConfig.maxDuration);
    this.store.setState({
      totalDuration: duration,
      cropRange: { start: 0, end: cropEnd },
      currentTime: 0,
    });

    // 创建音频播放元素
    this.disposeAudioElement();
    this.audioElement = new Audio(asset.objectUrl);
    this.audioElement.preload = 'auto';
    this.audioAssetId = asset.id;

    this.requestRender();
  }

  /** 获取当前活跃的音频 clip（如果有） */
  private getActiveAudioClip(): VideoClip | null {
    const clips = this.store.getState().clips;
    return clips.find((c) => c.type === 'audio') ?? null;
  }

  private disposeAudioElement(): void {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = '';
      this.audioElement = null;
      this.audioAssetId = null;
    }
  }

  removeClip(clipId: string): void {
    this.store.removeClip(clipId);
    this.requestRender();
  }

  getClips(): VideoClip[] {
    return this.store.getState().clips;
  }

  getCropRange(): CropRange | null {
    return this.store.getState().cropRange;
  }

  setCropRange(range: CropRange | null): void {
    if (range) {
      const d = range.end - range.start;
      if (d < this.cropConfig.minDuration || d > this.cropConfig.maxDuration) return;
    }
    this.store.setCropRange(range);
    this.requestRender();
  }

  async exportCrop(options?: ExportOptions): Promise<Blob | null> {
    const s = this.store.getState();
    if (s.clips.length === 0 || !s.cropRange) return null;

    if (s.isPlaying) {
      this.store.setState({ isPlaying: false });
    }

    const clip = s.clips[0];
    const asset = this.mediaRegistry.getAsset(clip.assetId);
    if (!asset) return null;

    const startTime = s.cropRange.start + clip.sourceOffset;
    const endTime = s.cropRange.end + clip.sourceOffset;

    return exportCroppedVideo(asset.file, startTime, endTime, options);
  }

  // --- 播放控制 ---

  play(): void {
    const s = this.store.getState();
    if (s.isPlaying) return;

    if (s.cropRange) {
      if (s.currentTime < s.cropRange.start || s.currentTime >= s.cropRange.end) {
        this.store.setState({ currentTime: s.cropRange.start });
      }
    }

    // 播放前确保播放头在可视区域内
    this.ensurePlayheadVisible();

    // 同步音频元素（视频和音频 clip 都有音频播放）
    if (this.audioElement) {
      const currentState = this.store.getState();
      const clip = currentState.clips[0];
      if (clip) {
        this.audioElement.currentTime = currentState.currentTime + clip.sourceOffset;
      }
      void this.audioElement.play();
    }

    this.store.setState({ isPlaying: true });
  }

  pause(): void {
    this.audioElement?.pause();
    this.store.setState({ isPlaying: false });
  }

  togglePlay(): void {
    const s = this.store.getState();
    if (s.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
    this.requestRender();
  }

  seek(time: number): void {
    this.store.setCurrentTime(time);

    // 同步音频元素位置（视频和音频 clip 都适用）
    if (this.audioElement) {
      const clip = this.store.getState().clips[0];
      if (clip) {
        this.audioElement.currentTime = time + clip.sourceOffset;
      }
    }

    this.scheduleSeekPreview(time);
    this.requestRender();
  }

  // --- 预览帧 ---

  async getPreviewFrame(time: number): Promise<ImageBitmap | null> {
    const clips = this.store.getState().clips;
    const activeClip = clips.find((c) => time >= c.startTime && time <= c.startTime + c.duration);
    if (!activeClip || activeClip.type === 'audio') return null;

    const sourceTime = time - activeClip.startTime + activeClip.sourceOffset;
    return this.videoFrameCache.getFrame(activeClip.assetId, sourceTime);
  }

  async getPreviewFrameCanvas(time: number): Promise<FrameResult | null> {
    const clips = this.store.getState().clips;
    const activeClip = clips.find((c) => time >= c.startTime && time <= c.startTime + c.duration);
    if (!activeClip || activeClip.type === 'audio') return null;

    const sourceTime = time - activeClip.startTime + activeClip.sourceOffset;
    return this.videoFrameCache.getFrameCanvas(activeClip.assetId, sourceTime);
  }

  // --- 视图控制 ---

  setScale(scale: number): void {
    this.pauseIfPlaying();
    this.store.setScale(scale);
    this.requestRender();
  }

  zoomIn(): void {
    this.pauseIfPlaying();
    const { MAX_SCALE, ZOOM_FACTOR } = TIMELINE_CONFIG;
    const currentScale = this.store.getState().scale;
    this.store.setScale(Math.min(MAX_SCALE, currentScale * ZOOM_FACTOR));
    this.requestRender();
  }

  zoomOut(): void {
    this.pauseIfPlaying();
    const { MIN_SCALE, ZOOM_FACTOR } = TIMELINE_CONFIG;
    const currentScale = this.store.getState().scale;
    this.store.setScale(Math.max(MIN_SCALE, currentScale / ZOOM_FACTOR));
    this.requestRender();
  }

  setScrollX(scrollX: number): void {
    this.pauseIfPlaying();
    this.store.setScrollX(scrollX);
    this.requestRender();
  }

  /**
   * 调整 Canvas 尺寸。
   * @param layout Canvas 布局尺寸（rulerHeight / trackGap / thumbnailHeight）
   */
  resize(width: number, layout: CanvasLayout): void {
    this.renderer?.resize(width, layout);
    this.eventHandler?.updateLayout(layout);
    this.requestRender();
  }

  updateCropConfig(config: CropConfig): void {
    this.cropConfig = config;
    this.eventHandler?.updateCropConfig(config);
  }

  /** 动态更新颜色方案（主题切换时调用） */
  setColors(colors: TimelineColorScheme): void {
    this.colors = colors;
    this.renderer?.setColors(colors);
  }

  /** 如果正在播放则暂停（用于用户主动操作时间轴时） */
  private pauseIfPlaying(): void {
    if (this.store.getState().isPlaying) {
      this.pause();
    }
  }

  // --- 内部方法 ---

  requestRender(): void {
    this.renderer?.markNeedsRender();
  }

  /**
   * RAF 节流的预览帧更新调度。
   * 快速拖拽播放头时，同一帧内多次调用只执行最后一次解码，
   * 避免大量中间帧的 createImageBitmap 开销。
   */
  private scheduleSeekPreview(time: number): void {
    this.pendingSeekTime = time;
    if (this.seekRafId !== null) return;
    this.seekRafId = requestAnimationFrame(() => {
      this.seekRafId = null;
      if (this.pendingSeekTime !== null) {
        void this.updatePreviewFrame(this.pendingSeekTime);
        this.pendingSeekTime = null;
      }
    });
  }

  private async updatePreviewFrame(time: number): Promise<void> {
    const seq = ++this.seekSeq;

    const clips = this.store.getState().clips;
    const activeClip = clips.find((c) => time >= c.startTime && time <= c.startTime + c.duration);
    if (!activeClip) {
      this.store.setPreviewFrame(null);
      return;
    }

    // 音频 clip 没有视频帧，跳过预览帧解码
    if (activeClip.type === 'audio') return;

    const sourceTime = time - activeClip.startTime + activeClip.sourceOffset;
    const frame = await this.videoFrameCache.getFrame(activeClip.assetId, sourceTime);

    if (this.seekSeq !== seq) {
      frame?.close();
      return;
    }

    if (frame) {
      this.store.setPreviewFrame(frame);
    }
  }

  private async updatePreviewFrameDirect(time: number): Promise<void> {
    // 并发控制：如果正在解码，记录最新时间戳，等当前解码完成后再处理
    if (this.directDecoding) {
      this.directPendingTime = time;
      return;
    }

    this.directDecoding = true;
    try {
      const clips = this.store.getState().clips;
      const activeClip = clips.find((c) => time >= c.startTime && time <= c.startTime + c.duration);
      if (!activeClip || activeClip.type === 'audio') return;

      const sourceTime = time - activeClip.startTime + activeClip.sourceOffset;
      const result = await this.videoFrameCache.getFrameCanvas(activeClip.assetId, sourceTime);
      if (result && this.onPreviewFrameDirect) {
        this.onPreviewFrameDirect(result.canvas, result.width, result.height);
      }
    } finally {
      this.directDecoding = false;

      // 如果解码期间有新的帧请求，处理最新的那个（丢弃中间帧）
      if (this.directPendingTime !== null) {
        const pending = this.directPendingTime;
        this.directPendingTime = null;
        void this.updatePreviewFrameDirect(pending);
      }
    }
  }

  /** 播放前确保播放头在可视区域内，不在则跳转滚动到播放头位置 */
  private ensurePlayheadVisible(): void {
    const { currentTime, scale, scrollX } = this.store.getState();
    const { TRACK_PADDING_H } = TIMELINE_CONFIG;
    const viewWidth = this.renderer?.getWidth() ?? 0;
    if (viewWidth <= 0) return;

    const playheadX = currentTime * scale - scrollX + TRACK_PADDING_H;
    if (playheadX < TRACK_PADDING_H || playheadX > viewWidth - TRACK_PADDING_H) {
      const contentWidth = viewWidth - TRACK_PADDING_H * 2;
      const newScrollX = currentTime * scale - contentWidth * 0.1;
      this.store.setState({ scrollX: Math.max(0, newScrollX) });
    }
  }

  /** 播放时自动跟随播放头：超出右边界时翻页滚动 */
  private autoFollowPlayhead(time: number): void {
    const { scale, scrollX } = this.store.getState();
    const { TRACK_PADDING_H } = TIMELINE_CONFIG;
    const viewWidth = this.renderer?.getWidth() ?? 0;
    if (viewWidth <= 0) return;

    const contentWidth = viewWidth - TRACK_PADDING_H * 2;
    const playheadX = time * scale - scrollX + TRACK_PADDING_H;

    if (playheadX > viewWidth - TRACK_PADDING_H) {
      // 翻页：播放头回到左侧约 10% 的位置
      const newScrollX = time * scale - contentWidth * 0.1;
      this.store.setStateSilent({ scrollX: Math.max(0, newScrollX) });
    }
  }

  private startPlayLoop(): void {
    this.playLastTime = performance.now();
    this.videoFrameCache.resetCanvases();

    const isAudioOnlyMode = !!this.getActiveAudioClip();
    const hasAudio = !!this.audioElement;
    const activeClip = this.store.getState().clips[0] ?? null;

    const updateTime = (now: number) => {
      if (!this.store.getState().isPlaying) {
        this.playRafId = null;
        this.videoFrameCache.resetCanvases();
        this.audioElement?.pause();
        return;
      }

      const s = this.store.getState();
      const cropEnd = s.cropRange ? s.cropRange.end : s.totalDuration;

      let newTime: number;
      if (hasAudio && activeClip) {
        // 从音频元素读取真实播放时间，音视频统一使用音频时钟
        newTime = Math.min(this.audioElement!.currentTime - activeClip.sourceOffset, cropEnd);
      } else {
        const delta = (now - this.playLastTime) / 1000;
        this.playLastTime = now;
        newTime = Math.min(s.currentTime + delta, cropEnd);
      }

      if (newTime >= cropEnd) {
        this.audioElement?.pause();
        this.store.setState({ currentTime: cropEnd, isPlaying: false });
        this.requestRender();
        this.playRafId = null;
        this.videoFrameCache.resetCanvases();
        return;
      }

      // 静默更新 currentTime，保持 60fps 流畅
      this.store.setStateSilent({ currentTime: newTime });

      // 自动跟随：播放头超出可视区域右边界时翻页
      this.autoFollowPlayhead(newTime);

      if (!isAudioOnlyMode) {
        void this.updatePreviewFrameDirect(newTime);
      }

      this.requestRender();
      this.playRafId = requestAnimationFrame(updateTime);
    };

    this.playRafId = requestAnimationFrame(updateTime);
  }

  private stopPlayLoop(): void {
    if (this.playRafId !== null) {
      cancelAnimationFrame(this.playRafId);
      this.playRafId = null;
    }
    this.audioElement?.pause();
    // 播放停止时清理 canvases generator，避免内部 VideoSample 泄漏
    this.videoFrameCache.resetCanvases();
  }
}
