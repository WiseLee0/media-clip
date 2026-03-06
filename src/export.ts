/**
 * 视频裁剪导出工具
 * 使用 mediabunny Conversion 实现浏览器端裁剪，输出保持原始格式
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  type InputFormat,
  IsobmffInputFormat,
  MatroskaInputFormat,
  Mp3InputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  MkvOutputFormat,
  MovOutputFormat,
  AdtsInputFormat,
  AdtsOutputFormat,
  FlacInputFormat,
  FlacOutputFormat,
  OggInputFormat,
  OggOutputFormat,
  WaveInputFormat,
  WavOutputFormat,
  Output,
  type OutputFormat,
  QuickTimeInputFormat,
  WebMInputFormat,
  WebMOutputFormat,
} from 'mediabunny';

import { registerMp3Encoder } from '@mediabunny/mp3-encoder';
import type { ExportOptions } from './types';

// 注册 MP3 编码器扩展
registerMp3Encoder();

/** 根据输入格式选择对应的输出格式，保持原始格式 */
function getOutputFormat(inputFormat: InputFormat): OutputFormat {
  // 音频格式
  if (inputFormat instanceof Mp3InputFormat) {
    return new Mp3OutputFormat();
  }
  if (inputFormat instanceof AdtsInputFormat) {
    return new AdtsOutputFormat();
  }
  if (inputFormat instanceof FlacInputFormat) {
    return new FlacOutputFormat();
  }
  if (inputFormat instanceof OggInputFormat) {
    return new OggOutputFormat();
  }
  if (inputFormat instanceof WaveInputFormat) {
    return new WavOutputFormat();
  }
  // 视频格式
  if (inputFormat instanceof WebMInputFormat) {
    return new WebMOutputFormat();
  }
  if (inputFormat instanceof MatroskaInputFormat) {
    return new MkvOutputFormat();
  }
  if (inputFormat instanceof QuickTimeInputFormat) {
    return new MovOutputFormat({ fastStart: 'in-memory' });
  }
  if (inputFormat instanceof IsobmffInputFormat) {
    return new Mp4OutputFormat({ fastStart: 'in-memory' });
  }
  // 默认输出 MP4
  return new Mp4OutputFormat({ fastStart: 'in-memory' });
}

/**
 * 裁剪媒体文件指定时间范围并导出为 Blob
 */
export async function exportCroppedVideo(
  file: File,
  startTime: number,
  endTime: number,
  options?: ExportOptions,
): Promise<Blob> {
  const { onProgress } = options ?? {};

  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });

  try {
    const inputFormat = await input.getFormat();
    const outputFormat = getOutputFormat(inputFormat);
    const target = new BufferTarget();
    const output = new Output({ format: outputFormat, target });

    const conversion = await Conversion.init({
      input,
      output,
      trim: { start: startTime, end: endTime },
      showWarnings: false,
    });

    if (!conversion.isValid) {
      console.warn('部分轨道在转换中被丢弃，继续导出可用轨道');
    }

    if (onProgress) {
      conversion.onProgress = onProgress;
    }

    await conversion.execute();

    const mimeType = outputFormat.mimeType;
    return new Blob([target.buffer!], { type: mimeType });
  } finally {
    input.dispose();
  }
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
