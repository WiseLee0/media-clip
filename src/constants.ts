/**
 * media-clip-core 常量配置
 */

/** 布局配置 */
export const TIMELINE_CONFIG = {
  /** 刻度尺高度 */
  RULER_HEIGHT: 28,
  /** 视频轨道高度 */
  VIDEO_TRACK_HEIGHT: 80,
  /** 片段圆角 */
  CLIP_BORDER_RADIUS: 6,
  /** 片段最小宽度（像素） */
  CLIP_MIN_WIDTH: 20,
  /** 片段内边距 */
  CLIP_PADDING: 4,
  /** 播放头宽度 */
  PLAYHEAD_WIDTH: 2,
  /** 播放头顶部控制头宽度 */
  PLAYHEAD_HEAD_WIDTH: 16,
  /** 播放头顶部控制头高度 */
  PLAYHEAD_HEAD_HEIGHT: 20,
  /** 默认缩放（像素/秒） */
  DEFAULT_SCALE: 100,
  /** 最小缩放 */
  MIN_SCALE: 10,
  /** 最大缩放 */
  MAX_SCALE: 500,
  /** 缩放步进因子 */
  ZOOM_FACTOR: 1.15,
  /** 边缘拖拽检测宽度 */
  EDGE_DRAG_WIDTH: 8,
  /** 裁剪选框手柄宽度 */
  CROP_HANDLE_WIDTH: 8,
  /** 波形 bar 宽度（像素） */
  WAVEFORM_BAR_WIDTH: 2,
  /** 波形 bar 间距（像素） */
  WAVEFORM_BAR_GAP: 1,
  /** 刻度尺与缩略图轨道左右内边距 */
  TRACK_PADDING_H: 6,
  /** 时间轴最小总时长（秒），保证时间轴始终有足够的可见长度 */
  MIN_TOTAL_DURATION: 60,
} as const;

/** 颜色方案类型 */
export type TimelineColorScheme = {
  /** 时间轴背景色 */
  BACKGROUND: string;
  /** 刻度尺小刻度颜色 */
  RULER_LINE: string;
  /** 刻度尺时间文字颜色 */
  RULER_TEXT: string;
  /** 播放头竖线颜色 */
  PLAYHEAD: string;
  /** 播放头指针头填充颜色 */
  PLAYHEAD_FILL: string;
  /** 播放头指针头描边颜色 */
  PLAYHEAD_STROKE: string;
  /** 视频片段背景色 */
  VIDEO_CLIP: string;
  /** 选中片段边框颜色 */
  SELECTED_BORDER: string;
  /** 悬停片段边框颜色 */
  HOVER_BORDER: string;
  /** 片段名称文字颜色 */
  CLIP_TEXT: string;
  /** 裁剪选框外部遮罩 */
  CROP_MASK: string;
  /** 裁剪选框边框 */
  CROP_BORDER: string;
  /** 裁剪选框手柄 */
  CROP_HANDLE: string;
  /** 裁剪手柄内部刻线颜色 */
  CROP_HANDLE_INNER: string;
  /** 音频波形颜色 */
  AUDIO_WAVEFORM: string;
  /** 缩略图缺帧占位填充色 */
  THUMBNAIL_PLACEHOLDER: string;
  /** 缩略图分隔线颜色 */
  THUMBNAIL_SEPARATOR: string;
};

/** 亮色主题 */
export const LIGHT_THEME_COLORS: TimelineColorScheme = {
  BACKGROUND: '#ffffff',
  RULER_LINE: '#12141F73',
  RULER_TEXT: '#12141F73',
  PLAYHEAD: '#15171F',
  PLAYHEAD_FILL: '#F5F7FF',
  PLAYHEAD_STROKE: '#000000',
  VIDEO_CLIP: '#ffffff10',
  SELECTED_BORDER: '#ffffff',
  HOVER_BORDER: '#aaaaaa',
  CLIP_TEXT: '#ffffff',
  CROP_MASK: 'rgba(255, 255, 255, 0.8)',
  CROP_BORDER: '#000000',
  CROP_HANDLE: '#000000',
  CROP_HANDLE_INNER: '#F5F6FF',
  AUDIO_WAVEFORM: '#7657FF',
  THUMBNAIL_PLACEHOLDER: 'rgba(0, 0, 0, 0.10)',
  THUMBNAIL_SEPARATOR: 'rgba(255, 255, 255, 0.06)',
};

/** 暗色主题 */
export const DARK_THEME_COLORS: TimelineColorScheme = {
  BACKGROUND: '#121316',
  RULER_LINE: 'rgba(224, 229, 255, 0.35)',
  RULER_TEXT: 'rgba(235, 238, 255, 0.65)',
  PLAYHEAD: '#F5F6FF',
  PLAYHEAD_FILL: '#F5F6FF',
  PLAYHEAD_STROKE: '#15171F',
  VIDEO_CLIP: 'rgba(255, 255, 255, 0.06)',
  SELECTED_BORDER: '#F5F6FF',
  HOVER_BORDER: 'rgba(235, 238, 255, 0.65)',
  CLIP_TEXT: '#F5F6FF',
  CROP_MASK: 'rgba(18, 19, 22, 0.8)',
  CROP_BORDER: '#F5F6FF',
  CROP_HANDLE: '#F5F6FF',
  CROP_HANDLE_INNER: '#15171F',
  AUDIO_WAVEFORM: '#7657FF',
  THUMBNAIL_PLACEHOLDER: 'rgba(255, 255, 255, 0.06)',
  THUMBNAIL_SEPARATOR: 'rgba(197, 184, 255, 0.08)',
};

/** 默认裁剪配置 */
export const DEFAULT_CROP_CONFIG = {
  /** 最小裁切时长（秒） */
  minDuration: 2,
  /** 最大裁切时长（秒） */
  maxDuration: 15.4,
} as const;

/** 时间刻度间隔配置（参考剪映规则，子刻度对应整数时间单位） */
export const TIME_INTERVALS = [
  { minScale: 400, interval: 0.5, subDivisions: 5 }, // 每格0.1s
  { minScale: 200, interval: 1, subDivisions: 5 }, // 每格0.1s
  { minScale: 80, interval: 1, subDivisions: 5 }, // 每格0.2s
  { minScale: 40, interval: 2, subDivisions: 5 }, // 每格0.5s
  { minScale: 15, interval: 5, subDivisions: 5 }, // 每格1s
  { minScale: 5, interval: 10, subDivisions: 5 }, // 每格2s
  { minScale: 2, interval: 30, subDivisions: 6 }, // 每格5s
  { minScale: 0, interval: 60, subDivisions: 6 }, // 每格10s
] as const;

/** 视频时长分级配置：根据视频总时长决定初始缩放和缩略图采样间隔 */
export interface DurationTier {
  /** 时长上限（秒），Infinity 表示无上限 */
  maxDuration: number;
  /** 缩略图采样间隔（秒） */
  sampleInterval: number;
  /** 时间轴宽度倍率（1 = 全屏, 2 = 2倍宽度, 4 = 4倍宽度） */
  widthMultiplier: number;
}

export const DURATION_TIERS: DurationTier[] = [
  { maxDuration: 15, sampleInterval: 0.5, widthMultiplier: 1 },
  { maxDuration: 60, sampleInterval: 1.0, widthMultiplier: 1 },
  { maxDuration: 180, sampleInterval: 2.0, widthMultiplier: 1 },
  { maxDuration: 600, sampleInterval: 5.0, widthMultiplier: 2 },
  { maxDuration: Infinity, sampleInterval: 10.0, widthMultiplier: 4 },
];

/** 根据视频总时长获取对应的分级配置 */
export function getDurationTier(totalDuration: number): DurationTier {
  return (
    DURATION_TIERS.find((tier) => totalDuration <= tier.maxDuration) ??
    DURATION_TIERS[DURATION_TIERS.length - 1]
  );
}

/** 根据视频总时长和容器宽度计算初始缩放值（px/s） */
export function calcInitialScale(totalDuration: number, containerWidth: number): number {
  const tier = getDurationTier(totalDuration);
  const { TRACK_PADDING_H, MIN_SCALE, MAX_SCALE } = TIMELINE_CONFIG;
  const availableWidth = containerWidth - TRACK_PADDING_H * 2;
  const scale = (availableWidth * tier.widthMultiplier) / totalDuration;
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}
