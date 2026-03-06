import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimelineStore } from '../store';
import type { VideoClip } from '../types';

function makeClip(overrides?: Partial<VideoClip>): VideoClip {
  return {
    id: crypto.randomUUID(),
    assetId: 'asset-1',
    startTime: 0,
    duration: 10,
    sourceOffset: 0,
    sourceDuration: 10,
    thumbnails: [],
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

describe('TimelineStore', () => {
  let store: TimelineStore;

  beforeEach(() => {
    store = new TimelineStore();
  });

  it('has correct default state', () => {
    const s = store.getState();
    expect(s.clips).toEqual([]);
    expect(s.currentTime).toBe(0);
    expect(s.isPlaying).toBe(false);
    expect(s.scale).toBe(100);
    expect(s.scrollX).toBe(0);
    expect(s.cropRange).toBeNull();
    expect(s.previewFrame).toBeNull();
  });

  it('setState merges partial state', () => {
    store.setState({ currentTime: 5 });
    expect(store.getState().currentTime).toBe(5);
    expect(store.getState().scale).toBe(100); // unchanged
  });

  it('subscribe and unsubscribe work', () => {
    const listener = vi.fn();
    const unsub = store.subscribe(listener);

    store.setState({ currentTime: 1 });
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    store.setState({ currentTime: 2 });
    expect(listener).toHaveBeenCalledTimes(1); // not called again
  });

  it('setCurrentTime clamps to [0, totalDuration]', () => {
    store.setState({ totalDuration: 10 });
    store.setCurrentTime(-5);
    expect(store.getState().currentTime).toBe(0);

    store.setCurrentTime(15);
    expect(store.getState().currentTime).toBe(10);

    store.setCurrentTime(5);
    expect(store.getState().currentTime).toBe(5);
  });

  it('setScale clamps to [MIN_SCALE, MAX_SCALE]', () => {
    store.setScale(1);
    expect(store.getState().scale).toBe(10); // MIN_SCALE

    store.setScale(1000);
    expect(store.getState().scale).toBe(500); // MAX_SCALE

    store.setScale(200);
    expect(store.getState().scale).toBe(200);
  });

  it('setScrollX clamps to >= 0', () => {
    store.setScrollX(-100);
    expect(store.getState().scrollX).toBe(0);

    store.setScrollX(100);
    expect(store.getState().scrollX).toBe(100);
  });

  it('addClip adds and updates totalDuration', () => {
    const clip = makeClip({ startTime: 0, duration: 30 });
    store.addClip(clip);

    expect(store.getState().clips).toHaveLength(1);
    expect(store.getState().totalDuration).toBe(60); // max(60, 30)
  });

  it('addClip extends totalDuration when clip exceeds', () => {
    const clip = makeClip({ startTime: 50, duration: 30 });
    store.addClip(clip);

    expect(store.getState().totalDuration).toBe(80);
  });

  it('updateClip modifies the right clip', () => {
    const clip = makeClip({ id: 'clip-1', name: 'Original' });
    store.addClip(clip);

    store.updateClip('clip-1', { name: 'Updated' });
    expect(store.getState().clips[0].name).toBe('Updated');
  });

  it('removeClip removes and calls onAssetOrphan when asset orphaned', () => {
    const orphanCb = vi.fn();
    store.onAssetOrphan = orphanCb;

    const clip = makeClip({ id: 'clip-1', assetId: 'asset-1' });
    store.addClip(clip);

    store.removeClip('clip-1');
    expect(store.getState().clips).toHaveLength(0);
    expect(orphanCb).toHaveBeenCalledWith('asset-1');
  });

  it('removeClip does not call onAssetOrphan when asset still used', () => {
    const orphanCb = vi.fn();
    store.onAssetOrphan = orphanCb;

    store.addClip(makeClip({ id: 'clip-1', assetId: 'asset-1' }));
    store.addClip(makeClip({ id: 'clip-2', assetId: 'asset-1' }));

    store.removeClip('clip-1');
    expect(orphanCb).not.toHaveBeenCalled();
    expect(store.getState().clips).toHaveLength(1);
  });

  it('clearAllClips removes all clips and calls onAssetOrphan', () => {
    const orphanCb = vi.fn();
    store.onAssetOrphan = orphanCb;

    store.addClip(makeClip({ assetId: 'a1' }));
    store.addClip(makeClip({ assetId: 'a2' }));

    store.clearAllClips();
    expect(store.getState().clips).toHaveLength(0);
    expect(orphanCb).toHaveBeenCalledTimes(2);
  });

  it('togglePlay flips isPlaying', () => {
    expect(store.getState().isPlaying).toBe(false);
    store.togglePlay();
    expect(store.getState().isPlaying).toBe(true);
    store.togglePlay();
    expect(store.getState().isPlaying).toBe(false);
  });

  it('setCropRange sets and clears crop range', () => {
    store.setCropRange({ start: 1, end: 5 });
    expect(store.getState().cropRange).toEqual({ start: 1, end: 5 });

    store.setCropRange(null);
    expect(store.getState().cropRange).toBeNull();
  });

  it('selectClip sets and clears selection', () => {
    store.selectClip('clip-1');
    expect(store.getState().selectedClipIds.has('clip-1')).toBe(true);

    store.selectClip(null);
    expect(store.getState().selectedClipIds.size).toBe(0);
  });

  it('reset returns to default state', () => {
    store.setState({ currentTime: 5, isPlaying: true, scale: 200 });
    store.addClip(makeClip());

    store.reset();

    const s = store.getState();
    expect(s.clips).toEqual([]);
    expect(s.currentTime).toBe(0);
    expect(s.isPlaying).toBe(false);
    expect(s.scale).toBe(100);
  });

  it('setState produces a new state object (immutability)', () => {
    const before = store.getState();
    store.setState({ currentTime: 5 });
    const after = store.getState();

    expect(before).not.toBe(after);
    expect(before.currentTime).toBe(0);
    expect(after.currentTime).toBe(5);
  });

  it('getActions returns a working actions object', () => {
    const actions = store.getActions();

    actions.setCurrentTime(7);
    expect(store.getState().currentTime).toBe(7);

    actions.togglePlay();
    expect(store.getState().isPlaying).toBe(true);
  });
});
