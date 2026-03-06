import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaRegistry } from '../media/registry';

// Mock URL.createObjectURL / revokeObjectURL
let urlCounter = 0;
vi.stubGlobal('URL', {
  ...globalThis.URL,
  createObjectURL: vi.fn(() => `blob:mock-${++urlCounter}`),
  revokeObjectURL: vi.fn(),
});

function makeFile(name = 'test.mp4'): File {
  return new File(['video-data'], name, { type: 'video/mp4' });
}

describe('MediaRegistry', () => {
  let registry: MediaRegistry;

  beforeEach(() => {
    registry = new MediaRegistry();
    urlCounter = 0;
    vi.clearAllMocks();
  });

  it('registerVideoAsset creates an asset with UUID and objectUrl', () => {
    const file = makeFile();
    const asset = registry.registerVideoAsset(file);

    expect(asset.id).toBeTruthy();
    expect(asset.file).toBe(file);
    expect(asset.objectUrl).toMatch(/^blob:mock-/);
    expect(asset.name).toBe('test.mp4');
    expect(asset.mime).toBe('video/mp4');
    expect(asset.size).toBeGreaterThan(0);
  });

  it('getAsset returns registered asset', () => {
    const file = makeFile();
    const asset = registry.registerVideoAsset(file);

    expect(registry.getAsset(asset.id)).toBe(asset);
    expect(registry.has(asset.id)).toBe(true);
  });

  it('getAsset returns null for unknown id', () => {
    expect(registry.getAsset('unknown')).toBeNull();
    expect(registry.has('unknown')).toBe(false);
  });

  it('releaseAsset revokes URL and removes asset', () => {
    const asset = registry.registerVideoAsset(makeFile());

    registry.releaseAsset(asset.id);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(asset.objectUrl);
    expect(registry.getAsset(asset.id)).toBeNull();
  });

  it('releaseAsset on unknown id is a no-op', () => {
    registry.releaseAsset('unknown');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('clear revokes all URLs and removes all assets', () => {
    const a1 = registry.registerVideoAsset(makeFile('a.mp4'));
    const a2 = registry.registerVideoAsset(makeFile('b.mp4'));

    registry.clear();

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(registry.getAsset(a1.id)).toBeNull();
    expect(registry.getAsset(a2.id)).toBeNull();
  });
});
