/**
 * @whelk/media-clip-core
 * Headless 视频剪辑引擎
 */

// Engine
export { MediaClipEngine } from './engine';
export type { MediaClipEngineOptions } from './engine';

// Store
export { TimelineStore } from './store';

// Renderer & EventHandler
export { TimelineRenderer } from './renderer';
export { TimelineEventHandler } from './event-handler';
export type { TimelineEventCallbacks } from './event-handler';

// Media
export { MediaRegistry } from './media/registry';
export { ThumbnailStore } from './media/thumbnail-store';
export { ThumbnailService } from './media/thumbnail-service';
export { VideoFrameCache } from './media/video-frame-cache';
export { WaveformService } from './media/waveform-service';

// Export utils
export { exportCroppedVideo, downloadBlob } from './export';

// Utils
export { formatTime, formatTimeShort } from './utils/time';

// Constants
export {
  TIMELINE_CONFIG,
  LIGHT_THEME_COLORS,
  DARK_THEME_COLORS,
  DEFAULT_CROP_CONFIG,
  TIME_INTERVALS,
  DURATION_TIERS,
  getDurationTier,
  calcInitialScale,
} from './constants';
export type { DurationTier, TimelineColorScheme } from './constants';

// Types
export type {
  ClipType,
  VideoClip,
  CropRange,
  CropConfig,
  CanvasLayout,
  DragType,
  TimelineState,
  TimelineActions,
  FrameResult,
  ExportOptions,
  TimelineMediaAsset,
  FrameEntry,
  WaveformPeaks,
  ClipRect,
  TimelineRenderHooks,
} from './types';
