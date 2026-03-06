import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThumbnailStore } from '../media/thumbnail-store';

class MockImage {
  src = '';
  width = 100;
  height = 56;
}

vi.stubGlobal('Image', MockImage);
vi.stubGlobal(
  'ImageBitmap',
  class ImageBitmap {
    close() {
      /* noop */
    }
  },
);

/** 创建带有可识别 src 的 MockImage，用于断言查找结果 */
function makeImage(id: number): HTMLImageElement {
  const img = new MockImage() as unknown as HTMLImageElement;
  img.src = `data:image/jpeg;base64,fake-${id}`;
  return img;
}

describe('ThumbnailStore', () => {
  let store: ThumbnailStore;

  beforeEach(() => {
    store = new ThumbnailStore();
  });

  it('starts empty', () => {
    expect(store.has('asset-1')).toBe(false);
    expect(store.getFrameCount('asset-1')).toBe(0);
    expect(store.getFrameAtTime('asset-1', 0)).toBeNull();
  });

  it('appendFrame adds frames incrementally', () => {
    store.appendFrame('asset-1', { timestamp: 0, img: makeImage(0) });
    expect(store.has('asset-1')).toBe(true);
    expect(store.getFrameCount('asset-1')).toBe(1);

    store.appendFrame('asset-1', { timestamp: 0.5, img: makeImage(1) });
    expect(store.getFrameCount('asset-1')).toBe(2);
  });

  it('getFrameAtTime returns closest frame via binary search', () => {
    const imgs = [makeImage(0), makeImage(1), makeImage(2), makeImage(3)];

    store.appendFrame('a', { timestamp: 0, img: imgs[0] });
    store.appendFrame('a', { timestamp: 1, img: imgs[1] });
    store.appendFrame('a', { timestamp: 2, img: imgs[2] });
    store.appendFrame('a', { timestamp: 3, img: imgs[3] });

    expect((store.getFrameAtTime('a', 0) as MockImage).src).toBe(imgs[0].src);
    expect((store.getFrameAtTime('a', 0.3) as MockImage).src).toBe(imgs[0].src);
    expect((store.getFrameAtTime('a', 0.6) as MockImage).src).toBe(imgs[1].src);
    expect((store.getFrameAtTime('a', 1.0) as MockImage).src).toBe(imgs[1].src);
    expect((store.getFrameAtTime('a', 2.4) as MockImage).src).toBe(imgs[2].src);
    expect((store.getFrameAtTime('a', 2.6) as MockImage).src).toBe(imgs[3].src);
    expect((store.getFrameAtTime('a', 5.0) as MockImage).src).toBe(imgs[3].src);
  });

  it('getFrameAtTime returns single frame when only one exists', () => {
    const img = makeImage(42);
    store.appendFrame('a', { timestamp: 1, img });
    expect((store.getFrameAtTime('a', 0) as MockImage).src).toBe(img.src);
    expect((store.getFrameAtTime('a', 100) as MockImage).src).toBe(img.src);
  });

  it('setFrames replaces old frames', () => {
    store.appendFrame('a', { timestamp: 0, img: makeImage(0) });
    store.appendFrame('a', { timestamp: 1, img: makeImage(1) });

    const newImg = makeImage(99);
    store.setFrames('a', [{ timestamp: 0, img: newImg }]);

    expect(store.getFrameCount('a')).toBe(1);
    expect((store.getFrameAtTime('a', 0) as MockImage).src).toBe(newImg.src);
  });

  it('clearAsset removes asset', () => {
    store.appendFrame('a', { timestamp: 0, img: makeImage(0) });
    store.appendFrame('a', { timestamp: 1, img: makeImage(1) });

    store.clearAsset('a');

    expect(store.has('a')).toBe(false);
  });

  it('clearAsset on nonexistent asset is a no-op', () => {
    store.clearAsset('nonexistent');
    // no error
  });

  it('clear removes all assets', () => {
    store.appendFrame('a', { timestamp: 0, img: makeImage(0) });
    store.appendFrame('b', { timestamp: 0, img: makeImage(1) });

    store.clear();

    expect(store.has('a')).toBe(false);
    expect(store.has('b')).toBe(false);
  });
});
