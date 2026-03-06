/**
 * 波形提取服务
 * 使用 Web Audio API 解码音频文件并提取波形峰值数据
 *
 * 性能优化策略：
 * 1. AudioContext 使用 sampleRate:22050 —— 仅用于波形可视化，22050Hz 覆盖 11kHz 以下频率，
 *    波形包络视觉形态准确（8kHz 会截断人声辅音频段导致波形失真），
 *    解码后 PCM 数据量是 44100Hz 的约 1/2，兼顾内存与视觉精度。
 * 2. 峰值计算 for 循环通过内联 Blob Worker 移至 Worker 线程，
 *    避免数百万次迭代阻塞主线程。Worker 出错时自动降级回同步计算。
 */

import type { WaveformPeaks } from '../types';

/**
 * Worker 内联代码：接收 channelData + samplesPerPixel，返回 peaks Float32Array。
 * 使用原始 JS（非 TS）以便直接注入 Blob，无需任何打包配置。
 */
const PEAK_WORKER_CODE = /* javascript */ `
self.onmessage = function (e) {
  var channelData = e.data.channelData;
  var samplesPerPixel = e.data.samplesPerPixel;
  var jobId = e.data.jobId;
  var totalSamples = channelData.length;
  var peakCount = Math.ceil(totalSamples / samplesPerPixel);
  var peaks = new Float32Array(peakCount * 2);
  for (var i = 0; i < peakCount; i++) {
    var start = i * samplesPerPixel;
    var end = Math.min(start + samplesPerPixel, totalSamples);
    var min = 1, max = -1;
    for (var j = start; j < end; j++) {
      var v = channelData[j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    peaks[i * 2] = min;
    peaks[i * 2 + 1] = max;
  }
  self.postMessage({ jobId: jobId, peaks: peaks }, [peaks.buffer]);
};
`;

interface PeakPendingJob {
  resolve: (peaks: Float32Array) => void;
  reject: (err: Error) => void;
}

export class WaveformService {
  private cache = new Map<string, WaveformPeaks>();

  /**
   * 仅用于 decodeAudioData，使用低采样率减少 PCM 数据量。
   * 22050Hz 覆盖 11kHz 以下频率，波形包络视觉形态准确，内存约为 44100Hz 的一半。
   */
  private audioContext: AudioContext | null = null;

  private worker: Worker | null = null;
  private workerJobId = 0;
  private workerPending = new Map<number, PeakPendingJob>();

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      try {
        this.audioContext = new AudioContext({ sampleRate: 22050 });
      } catch {
        // 极少数环境不支持指定 sampleRate，回退到默认
        this.audioContext = new AudioContext();
      }
    }
    return this.audioContext;
  }

  /**
   * 懒初始化 Blob Worker。
   * 使用 Blob URL 创建，无需打包配置，兼容所有 bundler。
   * Worker 创建失败时返回 null，由调用方降级到同步计算。
   */
  private getWorker(): Worker | null {
    if (this.worker) return this.worker;
    try {
      const blob = new Blob([PEAK_WORKER_CODE], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);
      // Worker 创建成功后立即释放 ObjectURL，不再需要
      URL.revokeObjectURL(url);

      worker.onmessage = (e: MessageEvent<{ jobId: number; peaks: Float32Array }>) => {
        const { jobId, peaks } = e.data;
        const job = this.workerPending.get(jobId);
        if (job) {
          this.workerPending.delete(jobId);
          job.resolve(peaks);
        }
      };

      worker.onerror = (e: ErrorEvent) => {
        // Worker 崩溃：拒绝所有 pending，触发调用方的 .catch() 降级逻辑
        for (const [, job] of this.workerPending) {
          job.reject(new Error(e.message ?? 'Peak worker error'));
        }
        this.workerPending.clear();
        this.worker?.terminate();
        this.worker = null;
      };

      this.worker = worker;
      return worker;
    } catch {
      return null;
    }
  }

  /**
   * 从音频文件提取波形峰值数据
   * @param assetId 素材 ID，用于缓存
   * @param file 音频文件
   * @param samplesPerPixel 每像素的采样数，默认 256
   */
  async extractPeaks(assetId: string, file: File, samplesPerPixel = 256): Promise<WaveformPeaks> {
    const cached = this.cache.get(assetId);
    if (cached) return cached;

    const ctx = this.getAudioContext();
    const arrayBuffer = await file.arrayBuffer();
    // decodeAudioData 是异步的，浏览器用原生解码器处理，不阻塞 JS 主线程
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    const { duration, sampleRate } = audioBuffer;
    const channelData = audioBuffer.getChannelData(0);

    const peaks = await this.computePeaksInWorker(channelData, samplesPerPixel);

    const result: WaveformPeaks = { peaks, duration, sampleRate };
    this.cache.set(assetId, result);
    return result;
  }

  /**
   * 将峰值计算委托给 Worker，避免阻塞主线程。
   * channelData 拷贝一份再 transfer 到 Worker（AudioBuffer 内部 buffer 不可直接 transfer）。
   * Worker 不可用或出错时，自动降级为同步计算。
   */
  private async computePeaksInWorker(
    channelData: Float32Array,
    samplesPerPixel: number,
  ): Promise<Float32Array> {
    const worker = this.getWorker();
    if (!worker) {
      return this.computePeaksSync(channelData, samplesPerPixel);
    }

    const jobId = ++this.workerJobId;
    // 拷贝一份用于 transfer（零拷贝传入 Worker，避免序列化开销）
    const channelDataCopy = new Float32Array(channelData);

    return new Promise<Float32Array>((resolve, reject) => {
      this.workerPending.set(jobId, { resolve, reject });
      worker.postMessage({ jobId, channelData: channelDataCopy, samplesPerPixel }, [channelDataCopy.buffer]);
    }).catch(() => {
      // Worker 出错时无缝降级
      return this.computePeaksSync(channelData, samplesPerPixel);
    });
  }

  /** 同步降级计算，Worker 不可用时的兜底方案 */
  private computePeaksSync(channelData: Float32Array, samplesPerPixel: number): Float32Array {
    const totalSamples = channelData.length;
    const peakCount = Math.ceil(totalSamples / samplesPerPixel);
    const peaks = new Float32Array(peakCount * 2);

    for (let i = 0; i < peakCount; i++) {
      const start = i * samplesPerPixel;
      const end = Math.min(start + samplesPerPixel, totalSamples);
      let min = 1;
      let max = -1;

      for (let j = start; j < end; j++) {
        const val = channelData[j];
        if (val < min) min = val;
        if (val > max) max = val;
      }

      peaks[i * 2] = min;
      peaks[i * 2 + 1] = max;
    }

    return peaks;
  }

  /** 获取已缓存的波形数据 */
  getPeaks(assetId: string): WaveformPeaks | null {
    return this.cache.get(assetId) ?? null;
  }

  /** 清除指定素材的缓存 */
  clearAsset(assetId: string): void {
    this.cache.delete(assetId);
  }

  /** 清除所有缓存并释放资源 */
  clear(): void {
    this.cache.clear();
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
    this.worker?.terminate();
    this.worker = null;
    this.workerPending.clear();
  }
}
