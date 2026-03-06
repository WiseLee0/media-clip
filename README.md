# media-clip

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

> 无头视频/音频剪辑引擎，零框架依赖 — 自由搭配任意 UI。

基于 Web Codecs API 构建的轻量级、框架无关的媒体剪辑引擎。在浏览器端完成时间轴状态管理、Canvas 时间轴渲染、缩略图生成、音频波形提取和视频导出 — 无需服务端。

## 特性

- **框架无关** — 纯 TypeScript，不依赖 React/Vue/Angular
- **Canvas 时间轴** — 硬件加速渲染，内置刻度尺、缩略图、波形、裁剪手柄
- **视频 & 音频** — 统一 API，自动识别文件类型
- **裁剪 & 导出** — 选定时间范围导出为视频 Blob，支持进度回调
- **缩略图生成** — 自动生成缩略图条带，采样间隔按视频时长智能分级
- **波形可视化** — 音频波形峰值提取与渲染
- **主题支持** — 内置亮色/暗色主题，完全可自定义
- **可缩放时间轴** — 缩放、滚动、播放头自动跟随
- **响应式状态** — 发布-订阅模型，兼容 React `useSyncExternalStore`
- **模块化架构** — 使用完整引擎或单独使用子模块

## 安装

```bash
npm install media-clip
# 或
pnpm add media-clip
# 或
yarn add media-clip
```

## 快速开始

```ts
import { MediaClipEngine } from 'media-clip';

// 1. 创建引擎
const engine = new MediaClipEngine({
  cropConfig: { minDuration: 2, maxDuration: 15 },
});

// 2. 绑定 Canvas（用于时间轴渲染）
const canvas = document.getElementById('timeline') as HTMLCanvasElement;
engine.attachCanvas(canvas);

// 3. 加载媒体文件（视频或音频）
const file = fileInput.files[0];
await engine.addMedia(file);

// 4. 播放控制
engine.play();
engine.pause();
engine.seek(5.0);

// 5. 导出裁剪片段
const blob = await engine.exportCrop({
  onProgress: (p) => console.log(`${Math.round(p * 100)}%`),
});

// 6. 销毁释放资源
engine.destroy();
```

## API 参考

### `MediaClipEngine`

主入口类，协调所有子模块，提供统一 API。

#### 构造函数

```ts
new MediaClipEngine(options?: MediaClipEngineOptions)
```

| 参数         | 类型                  | 默认值                                  | 说明                    |
| ------------ | --------------------- | --------------------------------------- | ----------------------- |
| `cropConfig` | `CropConfig`          | `{ minDuration: 2, maxDuration: 15.4 }` | 最小/最大裁剪时长（秒） |
| `colors`     | `TimelineColorScheme` | 亮色主题                                | 时间轴颜色方案          |

#### 生命周期

| 方法                                             | 说明                                       |
| ------------------------------------------------ | ------------------------------------------ |
| `attachCanvas(canvas, containerWidth?, layout?)` | 挂载 `<canvas>` 元素用于时间轴渲染         |
| `detachCanvas(clearCanvas?)`                     | 卸载 Canvas 并清理事件监听                 |
| `destroy()`                                      | 释放所有资源（媒体、缩略图、音频、Canvas） |

#### 状态与订阅

```ts
// 获取当前状态快照
const state: TimelineState = engine.getState();

// 订阅状态变化（返回取消订阅函数）
const unsubscribe = engine.subscribe(() => {
  const { currentTime, isPlaying, cropRange } = engine.getState();
  updateUI(currentTime, isPlaying, cropRange);
});

// 取消订阅
unsubscribe();
```

兼容 React `useSyncExternalStore`：

```ts
const state = useSyncExternalStore(engine.subscribe, engine.getState);
```

#### 媒体操作

| 方法                 | 返回值          | 说明                               |
| -------------------- | --------------- | ---------------------------------- |
| `addMedia(file)`     | `Promise<void>` | 加载视频或音频文件（替换当前媒体） |
| `removeClip(clipId)` | `void`          | 按 ID 移除片段                     |
| `getClips()`         | `VideoClip[]`   | 获取时间轴上所有片段               |

#### 裁剪与导出

| 方法                       | 返回值                  | 说明                                 |
| -------------------------- | ----------------------- | ------------------------------------ |
| `getCropRange()`           | `CropRange \| null`     | 获取当前裁剪范围                     |
| `setCropRange(range)`      | `void`                  | 设置裁剪范围（受 `cropConfig` 约束） |
| `updateCropConfig(config)` | `void`                  | 更新最小/最大裁剪约束                |
| `exportCrop(options?)`     | `Promise<Blob \| null>` | 导出裁剪片段为视频 Blob              |

```ts
interface ExportOptions {
  onProgress?: (progress: number) => void; // 0 ~ 1
}
```

#### 播放控制

| 方法           | 说明                 |
| -------------- | -------------------- |
| `play()`       | 从裁剪起点开始播放   |
| `pause()`      | 暂停播放             |
| `togglePlay()` | 切换播放/暂停        |
| `seek(time)`   | 跳转到指定时间（秒） |

#### 预览帧

| 方法                          | 返回值                         | 说明                                |
| ----------------------------- | ------------------------------ | ----------------------------------- |
| `getPreviewFrame(time)`       | `Promise<ImageBitmap \| null>` | 解码指定时间的单帧                  |
| `getPreviewFrameCanvas(time)` | `Promise<FrameResult \| null>` | 获取原始 Canvas（零拷贝，开销更低） |

```ts
// 播放时直接绘制预览帧的回调（从 UI 层注入）
engine.onPreviewFrameDirect = (source, width, height) => {
  const ctx = previewCanvas.getContext('2d')!;
  previewCanvas.width = width;
  previewCanvas.height = height;
  ctx.drawImage(source, 0, 0);
};
```

#### 视图控制

| 方法                     | 说明                           |
| ------------------------ | ------------------------------ |
| `setScale(scale)`        | 设置时间轴缩放级别（px/秒）    |
| `zoomIn()` / `zoomOut()` | 以 1.15× 倍率缩放              |
| `setScrollX(scrollX)`    | 设置水平滚动偏移               |
| `resize(width, layout)`  | 调整时间轴 Canvas 尺寸         |
| `setColors(colors)`      | 切换颜色方案（如暗色模式切换） |

### 状态模型

```ts
interface TimelineState {
  clips: VideoClip[]; // 时间轴上的媒体片段
  totalDuration: number; // 总时长（秒）
  currentTime: number; // 当前播放时间（秒）
  isPlaying: boolean; // 是否正在播放
  scale: number; // 时间轴缩放（px/秒）
  scrollX: number; // 水平滚动偏移（px）
  selectedClipIds: Set<string>; // 选中的片段 ID
  hoverClipId: string | null; // 悬停的片段 ID
  cropRange: CropRange | null; // 裁剪范围 { start, end }
  previewFrame: ImageBitmap | null; // 当前预览帧
}
```

### 类型定义

<details>
<summary>点击展开完整类型</summary>

```ts
type ClipType = 'video' | 'audio';

interface VideoClip {
  id: string;
  type?: ClipType;
  assetId: string;
  startTime: number; // 在时间轴上的位置（秒）
  duration: number; // 片段时长（秒）
  sourceOffset: number; // 源素材起始偏移（秒）
  sourceDuration: number; // 源素材总时长（秒）
  name?: string;
  thumbnails: string[];
  width: number;
  height: number;
  locked?: boolean;
}

interface CropRange {
  start: number; // 秒
  end: number; // 秒
}

interface CropConfig {
  minDuration: number; // 秒
  maxDuration: number; // 秒
}

interface CanvasLayout {
  rulerHeight: number; // 刻度尺高度（px）
  trackGap: number; // 刻度尺与轨道间距（px）
  thumbnailHeight: number; // 缩略图轨道高度（px）
}

interface FrameResult {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
}

interface ExportOptions {
  onProgress?: (progress: number) => void;
}
```

</details>

## 主题

内置亮色和暗色两套主题，也支持完全自定义：

```ts
import { MediaClipEngine, LIGHT_THEME_COLORS, DARK_THEME_COLORS } from 'media-clip';

// 使用暗色主题
const engine = new MediaClipEngine({ colors: DARK_THEME_COLORS });

// 运行时切换主题
engine.setColors(LIGHT_THEME_COLORS);

// 自定义主题
engine.setColors({
  BACKGROUND: '#1a1a2e',
  RULER_LINE: 'rgba(255,255,255,0.2)',
  RULER_TEXT: 'rgba(255,255,255,0.6)',
  PLAYHEAD: '#e94560',
  PLAYHEAD_FILL: '#e94560',
  PLAYHEAD_STROKE: '#1a1a2e',
  // ... 完整字段见 TimelineColorScheme 类型定义
});
```

## 进阶：自定义 UI

完全抛开默认组件，基于引擎构建自定义 UI：

```ts
import { MediaClipEngine } from 'media-clip';

const engine = new MediaClipEngine();

// 绑定你自己的 Canvas
engine.attachCanvas(myTimelineCanvas);

// 注入预览帧直绘回调
engine.onPreviewFrameDirect = (source, width, height) => {
  const ctx = myPreviewCanvas.getContext('2d')!;
  myPreviewCanvas.width = width;
  myPreviewCanvas.height = height;
  ctx.drawImage(source, 0, 0);
};

// 订阅状态变化来更新你的 UI
engine.subscribe(() => {
  const { currentTime, isPlaying, cropRange } = engine.getState();
  updateMyUI(currentTime, isPlaying, cropRange);
});

// 绑定你的控件
playBtn.onclick = () => engine.togglePlay();
zoomInBtn.onclick = () => engine.zoomIn();
zoomOutBtn.onclick = () => engine.zoomOut();
```

## 进阶：渲染钩子

自定义特定的绘制步骤，无需替换整个渲染器：

```ts
import type { TimelineRenderHooks } from 'media-clip';

const hooks: TimelineRenderHooks = {
  // 覆盖背景绘制
  drawBackground: (ctx, width, height) => {
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#1a1a2e');
    gradient.addColorStop(1, '#16213e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  },

  // 覆盖片段内容绘制（返回 true 跳过默认渲染）
  drawClipContent: (ctx, clip, rect) => {
    ctx.fillStyle = '#0f3460';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    return true;
  },

  // 在片段内容上方叠加额外内容
  drawClipOverlay: (ctx, clip, rect) => {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '12px sans-serif';
    ctx.fillText(clip.name ?? '', rect.x + 8, rect.y + 16);
  },
};
```

## 子模块

引擎由独立的子模块组成，可直接访问：

| 属性                      | 类名               | 说明                               |
| ------------------------- | ------------------ | ---------------------------------- |
| `engine.store`            | `TimelineStore`    | 响应式状态管理                     |
| `engine.mediaRegistry`    | `MediaRegistry`    | 媒体素材注册表（File → ObjectURL） |
| `engine.thumbnailStore`   | `ThumbnailStore`   | 缩略图帧图集存储                   |
| `engine.videoFrameCache`  | `VideoFrameCache`  | 视频帧解码缓存                     |
| `engine.thumbnailService` | `ThumbnailService` | 缩略图生成管线                     |
| `engine.waveformService`  | `WaveformService`  | 音频波形峰值提取                   |

## 常量与工具函数

```ts
import {
  TIMELINE_CONFIG, // 布局常量（刻度尺高度、轨道高度等）
  DEFAULT_CROP_CONFIG, // 默认裁剪配置 { minDuration, maxDuration }
  DURATION_TIERS, // 根据视频时长自动分级的配置
  getDurationTier, // 获取指定时长对应的分级配置
  calcInitialScale, // 根据时长和容器宽度计算初始缩放值
  formatTime, // "00:05.2" 格式
  formatTimeShort, // "0:05" 格式
} from 'media-clip';
```

## 浏览器兼容性

需要以下 API 支持：

- [Web Codecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) — 视频帧解码
- [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) — 离屏渲染
- [ImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmap) — GPU 侧图像资源

| 浏览器       | 支持情况                          |
| ------------ | --------------------------------- |
| Chrome 94+   | 完整支持                          |
| Edge 94+     | 完整支持                          |
| Firefox 118+ | 部分支持（WebCodecs 需开启 flag） |
| Safari 16.4+ | 部分支持                          |

## License

MIT
