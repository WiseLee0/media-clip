/**
 * media-clip-core 类型定义
 * 单轨道视频剪辑引擎
 */

/** 片段类型 */
export type ClipType = 'video' | 'audio';

/** 视频片段 */
export interface VideoClip {
  id: string;
  /** 片段类型，默认 'video' */
  type?: ClipType;
  /** 引用的媒体素材 id */
  assetId: string;
  /** 在时间轴上的开始时间（秒） */
  startTime: number;
  /** 片段持续时长（秒） */
  duration: number;
  /** 源素材的起始偏移（秒） */
  sourceOffset: number;
  /** 源素材总时长（秒） */
  sourceDuration: number;
  /** 片段名称 */
  name?: string;
  /** 缩略图 key 数组 */
  thumbnails: string[];
  /** 原始宽度 */
  width: number;
  /** 原始高度 */
  height: number;
  /** 是否锁定 */
  locked?: boolean;
}

/** 波形峰值数据 */
export interface WaveformPeaks {
  /** 每像素的峰值对（min/max 交替存储） */
  peaks: Float32Array;
  /** 音频总时长（秒） */
  duration: number;
  /** 采样率 */
  sampleRate: number;
}

/** 裁剪范围 */
export interface CropRange {
  /** 裁剪起点（秒） */
  start: number;
  /** 裁剪终点（秒） */
  end: number;
}

/** 裁剪配置 */
export interface CropConfig {
  /** 最小裁切时长（秒） */
  minDuration: number;
  /** 最大裁切时长（秒） */
  maxDuration: number;
}

/** Canvas 时间轴布局尺寸配置 */
export interface CanvasLayout {
  /** 刻度尺高度（px） */
  rulerHeight: number;
  /** 刻度尺与缩略图轨道之间的间距（px） */
  trackGap: number;
  /** 缩略图轨道高度，不含刻度尺和间距（px） */
  thumbnailHeight: number;
}

/** 拖拽类型 */
export type DragType = 'playhead' | 'crop-left' | 'crop-right' | 'crop-body' | 'scroll' | null;

/** Timeline 状态 */
export interface TimelineState {
  /** 所有视频片段 */
  clips: VideoClip[];
  /** 总时长（秒） */
  totalDuration: number;
  /** 当前播放时间（秒） */
  currentTime: number;
  /** 是否正在播放 */
  isPlaying: boolean;
  /** 时间轴缩放（像素/秒） */
  scale: number;
  /** 横向滚动偏移（像素） */
  scrollX: number;
  /** 选中的片段 ID 集合 */
  selectedClipIds: Set<string>;
  /** 悬停的片段 ID */
  hoverClipId: string | null;
  /** 裁剪范围 */
  cropRange: CropRange | null;
  /** 视频预览帧 */
  previewFrame: ImageBitmap | null;
}

/** Timeline 动作 */
export interface TimelineActions {
  setCurrentTime: (time: number) => void;
  setScale: (scale: number) => void;
  setScrollX: (scrollX: number) => void;
  selectClip: (clipId: string | null) => void;
  setHoverClip: (clipId: string | null) => void;
  addClip: (clip: VideoClip) => void;
  updateClip: (clipId: string, updates: Partial<VideoClip>) => void;
  removeClip: (clipId: string) => void;
  clearAllClips: () => void;
  togglePlay: () => void;
  setPreviewFrame: (frame: ImageBitmap | null) => void;
  setCropRange: (range: CropRange | null) => void;
  setState: (state: Partial<TimelineState>) => void;
}

/** 帧解码结果 */
export interface FrameResult {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
}

/** 导出选项 */
export interface ExportOptions {
  /** 导出进度回调 (0~1) */
  onProgress?: (progress: number) => void;
}

/** 媒体素材 */
export interface TimelineMediaAsset {
  id: string;
  file: File;
  objectUrl: string;
  mime: string;
  name: string;
  size: number;
}

/** Clip 在 Canvas 上的绘制区域，供渲染钩子使用 */
export interface ClipRect {
  /** clip 左边界（像素） */
  x: number;
  /** clip 顶部 y（像素） */
  y: number;
  /** clip 宽度（像素） */
  width: number;
  /** clip 高度（像素） */
  height: number;
  /**
   * 源素材在 canvas 上的起始 x（像素）
   * 用于缩略图 tile 对齐：tile 从 sourceX 开始铺贴，保证素材滚动时缩略图位置连续
   */
  sourceX: number;
}

/**
 * 渲染钩子，允许外部按需覆盖 TimelineRenderer 中特定的绘制步骤。
 * 未提供的钩子均回落到内置默认实现，互不影响。
 */
export interface TimelineRenderHooks {
  /**
   * 覆盖整体背景的绘制。
   * 不提供时默认用 LIGHT_THEME_COLORS.BACKGROUND 填充。
   */
  drawBackground?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  /**
   * 覆盖单个 clip 内容区域的绘制（缩略图 / 波形等）。
   * 返回 `true` 表示已完全处理，跳过内置默认实现；
   * 不返回或返回 `false` / `undefined` 则继续执行默认实现。
   */
  drawClipContent?: (ctx: CanvasRenderingContext2D, clip: VideoClip, rect: ClipRect) => boolean | void;
  /**
   * 在 clip 内容绘制完毕后叠加额外内容（如自定义标签、选中高亮、角标等）。
   * 与 drawClipContent 不互斥，总是在其之后调用。
   */
  drawClipOverlay?: (ctx: CanvasRenderingContext2D, clip: VideoClip, rect: ClipRect) => void;
}

/** 缩略图帧条目 */
export interface FrameEntry {
  timestamp: number;
  /**
   * 缩略图图像资源，直接用于 Canvas drawImage。
   * 优先存储 ImageBitmap（GPU 侧资源，需在清理时调用 .close()），
   * 降级时兼容 HTMLImageElement。
   */
  img: CanvasImageSource;
}
