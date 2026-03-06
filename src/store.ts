/**
 * media-clip-core 状态管理
 * 纯逻辑 TimelineStore 类，零 React 依赖
 */

import type { TimelineState, TimelineActions, VideoClip, CropRange } from './types';
import { TIMELINE_CONFIG } from './constants';

const defaultState: TimelineState = {
  clips: [],
  totalDuration: TIMELINE_CONFIG.MIN_TOTAL_DURATION,
  currentTime: 0,
  isPlaying: false,
  scale: TIMELINE_CONFIG.DEFAULT_SCALE,
  scrollX: 0,
  selectedClipIds: new Set(),
  hoverClipId: null,
  cropRange: null,
  previewFrame: null,
};

export class TimelineStore {
  private state: TimelineState;
  private listeners = new Set<() => void>();

  /** 移除 clip 时的副作用回调（释放素材等），由 Engine 注入 */
  onAssetOrphan: ((assetId: string) => void) | null = null;

  constructor() {
    this.state = { ...defaultState };
  }

  getState(): TimelineState {
    return this.state;
  }

  setState(partial: Partial<TimelineState>): void {
    // 浅比较：所有字段均未变化时跳过通知，避免无意义的重渲染
    const keys = Object.keys(partial) as Array<keyof TimelineState>;
    const hasChanged = keys.some((k) => this.state[k] !== (partial as TimelineState)[k]);
    if (!hasChanged) return;
    this.state = { ...this.state, ...partial };
    this.emitChange();
  }

  /**
   * 静默更新状态，不通知订阅者。
   * 适用于播放循环中高频更新 currentTime，避免每帧触发 React 重渲染。
   * 调用方需自行保证在合适时机通过 setState 同步最终状态。
   */
  setStateSilent(partial: Partial<TimelineState>): void {
    this.state = { ...this.state, ...partial };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  // --- Actions ---

  setCurrentTime(time: number): void {
    const clampedTime = Math.max(0, Math.min(time, this.state.totalDuration));
    this.setState({ currentTime: clampedTime });
  }

  setScale(scale: number): void {
    const { MIN_SCALE, MAX_SCALE } = TIMELINE_CONFIG;
    const clampedScale = Math.max(MIN_SCALE, Math.min(scale, MAX_SCALE));
    this.setState({ scale: clampedScale });
  }

  setScrollX(scrollX: number): void {
    this.setState({ scrollX: Math.max(0, scrollX) });
  }

  selectClip(clipId: string | null): void {
    if (clipId) {
      this.setState({ selectedClipIds: new Set([clipId]) });
    } else {
      this.setState({ selectedClipIds: new Set() });
    }
  }

  setHoverClip(clipId: string | null): void {
    this.setState({ hoverClipId: clipId });
  }

  addClip(clip: VideoClip): void {
    this.setState({
      clips: [...this.state.clips, clip],
      totalDuration: Math.max(
        TIMELINE_CONFIG.MIN_TOTAL_DURATION,
        this.state.totalDuration,
        clip.startTime + clip.duration,
      ),
    });
  }

  updateClip(clipId: string, updates: Partial<VideoClip>): void {
    this.setState({
      clips: this.state.clips.map((clip) => (clip.id === clipId ? { ...clip, ...updates } : clip)),
    });
  }

  removeClip(clipId: string): void {
    const clip = this.state.clips.find((c) => c.id === clipId);
    if (clip) {
      const stillUsed = this.state.clips.some((c) => c.id !== clipId && c.assetId === clip.assetId);
      if (!stillUsed) {
        this.onAssetOrphan?.(clip.assetId);
      }
    }

    this.setState({
      clips: this.state.clips.filter((c) => c.id !== clipId),
      selectedClipIds: new Set([...this.state.selectedClipIds].filter((id) => id !== clipId)),
    });
  }

  clearAllClips(): void {
    const assetIds = new Set<string>();
    for (const c of this.state.clips) {
      assetIds.add(c.assetId);
    }
    for (const id of assetIds) {
      this.onAssetOrphan?.(id);
    }
    this.setState({ clips: [], selectedClipIds: new Set(), hoverClipId: null });
  }

  togglePlay(): void {
    this.setState({ isPlaying: !this.state.isPlaying });
  }

  setPreviewFrame(frame: ImageBitmap | null): void {
    const old = this.state.previewFrame;
    if (old && old !== frame) {
      old.close();
    }
    this.setState({ previewFrame: frame });
  }

  setCropRange(range: CropRange | null): void {
    this.setState({ cropRange: range });
  }

  reset(): void {
    const old = this.state.previewFrame;
    if (old) old.close();
    this.state = { ...defaultState };
    this.emitChange();
  }

  /** 获取 TimelineActions 接口（兼容层） */
  getActions(): TimelineActions {
    return {
      setCurrentTime: (t) => this.setCurrentTime(t),
      setScale: (s) => this.setScale(s),
      setScrollX: (sx) => this.setScrollX(sx),
      selectClip: (id) => this.selectClip(id),
      setHoverClip: (id) => this.setHoverClip(id),
      addClip: (clip) => this.addClip(clip),
      updateClip: (id, updates) => this.updateClip(id, updates),
      removeClip: (id) => this.removeClip(id),
      clearAllClips: () => this.clearAllClips(),
      togglePlay: () => this.togglePlay(),
      setPreviewFrame: (frame) => this.setPreviewFrame(frame),
      setCropRange: (range) => this.setCropRange(range),
      setState: (state) => this.setState(state),
    };
  }
}
