import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaClipEngine } from '../engine';

// Mock mediabunny
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [],
  BlobSource: vi.fn(),
  CanvasSink: vi.fn(),
  Input: vi.fn(),
}));

// Mock URL APIs
vi.stubGlobal('URL', {
  ...globalThis.URL,
  createObjectURL: vi.fn(() => 'blob:mock'),
  revokeObjectURL: vi.fn(),
});

describe('MediaClipEngine', () => {
  let engine: MediaClipEngine;

  beforeEach(() => {
    engine = new MediaClipEngine({ cropConfig: { minDuration: 2, maxDuration: 15 } });
  });

  it('initializes with default state', () => {
    const s = engine.getState();
    expect(s.clips).toEqual([]);
    expect(s.isPlaying).toBe(false);
    expect(s.currentTime).toBe(0);
  });

  it('subscribe notifies listeners on state change', () => {
    const listener = vi.fn();
    const unsub = engine.subscribe(listener);

    // totalDuration 必须大于 seek 目标值，否则 setCurrentTime 会将时间 clamp 到 0
    // 而初始 currentTime 本就是 0，浅比较无变化则不触发通知
    engine.store.setState({ totalDuration: 30 });
    engine.seek(5);
    expect(listener).toHaveBeenCalled();

    unsub();
  });

  it('setCropRange validates duration constraints', () => {
    // Too short
    engine.setCropRange({ start: 0, end: 1 }); // 1s < 2s minDuration
    expect(engine.getCropRange()).toBeNull();

    // Too long
    engine.setCropRange({ start: 0, end: 20 }); // 20s > 15s maxDuration
    expect(engine.getCropRange()).toBeNull();

    // Valid
    engine.setCropRange({ start: 0, end: 5 });
    expect(engine.getCropRange()).toEqual({ start: 0, end: 5 });
  });

  it('setCropRange accepts null to clear', () => {
    engine.setCropRange({ start: 0, end: 5 });
    engine.setCropRange(null);
    expect(engine.getCropRange()).toBeNull();
  });

  it('play/pause/togglePlay control isPlaying', () => {
    // Note: play triggers RAF which won't run in test environment, so we
    // just verify state changes.
    engine.pause();
    expect(engine.getState().isPlaying).toBe(false);

    engine.store.setState({ isPlaying: true });
    expect(engine.getState().isPlaying).toBe(true);

    engine.pause();
    expect(engine.getState().isPlaying).toBe(false);
  });

  it('togglePlay flips isPlaying', () => {
    engine.togglePlay();
    expect(engine.getState().isPlaying).toBe(true);

    engine.store.setState({ isPlaying: false }); // reset without triggering play loop
    engine.togglePlay();
    expect(engine.getState().isPlaying).toBe(true);
  });

  it('seek updates currentTime', () => {
    engine.store.setState({ totalDuration: 30 });
    engine.seek(10);
    expect(engine.getState().currentTime).toBe(10);
  });

  it('setScale clamps and updates', () => {
    engine.setScale(50);
    expect(engine.getState().scale).toBe(50);

    engine.setScale(1);
    expect(engine.getState().scale).toBe(10); // MIN_SCALE
  });

  it('zoomIn/zoomOut change scale', () => {
    const before = engine.getState().scale;
    engine.zoomIn();
    expect(engine.getState().scale).toBeGreaterThan(before);

    const after = engine.getState().scale;
    engine.zoomOut();
    expect(engine.getState().scale).toBeLessThan(after);
  });

  it('updateCropConfig updates constraints', () => {
    engine.updateCropConfig({ minDuration: 1, maxDuration: 30 });

    // Now 1s is valid
    engine.setCropRange({ start: 0, end: 1 });
    expect(engine.getCropRange()).toEqual({ start: 0, end: 1 });
  });

  it('getClips returns clips from state', () => {
    expect(engine.getClips()).toEqual([]);
  });

  it('destroy cleans up without errors', () => {
    engine.destroy();
    // Should not throw when destroyed twice
    engine.destroy();
  });

  it('exportCrop returns null when no clips', async () => {
    const result = await engine.exportCrop();
    expect(result).toBeNull();
  });
});
