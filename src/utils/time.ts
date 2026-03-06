/**
 * 时间格式化工具
 */

export function formatTime(seconds: number, showMs = false): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);

  const minsStr = mins.toString().padStart(2, '0');
  const secsStr = secs.toString().padStart(2, '0');

  if (showMs) {
    const msStr = ms.toString().padStart(2, '0');
    return `${minsStr}:${secsStr}.${msStr}`;
  }

  return `${minsStr}:${secsStr}`;
}

export function formatTimeShort(seconds: number): string {
  if (seconds < 60) {
    if (Number.isInteger(seconds)) {
      return `${seconds}s`;
    }
    return `${seconds.toFixed(1)}s`;
  }

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  if (secs === 0) {
    return `${mins}m`;
  }

  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
