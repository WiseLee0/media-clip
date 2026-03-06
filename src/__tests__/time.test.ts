import { describe, it, expect } from 'vitest';
import { formatTime, formatTimeShort } from '../utils/time';

describe('formatTime', () => {
  it('formats 0 seconds', () => {
    expect(formatTime(0)).toBe('00:00');
  });

  it('formats seconds < 60', () => {
    expect(formatTime(5)).toBe('00:05');
    expect(formatTime(59)).toBe('00:59');
  });

  it('formats minutes', () => {
    expect(formatTime(60)).toBe('01:00');
    expect(formatTime(125)).toBe('02:05');
  });

  it('formats with milliseconds', () => {
    expect(formatTime(5.5, true)).toBe('00:05.50');
    expect(formatTime(0.12, true)).toBe('00:00.12');
    expect(formatTime(61.99, true)).toBe('01:01.99');
  });

  it('handles decimal seconds without ms flag', () => {
    expect(formatTime(5.7)).toBe('00:05');
    expect(formatTime(90.3)).toBe('01:30');
  });

  it('handles large values', () => {
    expect(formatTime(3661)).toBe('61:01');
  });

  it('floors fractional ms correctly', () => {
    expect(formatTime(1.999, true)).toBe('00:01.99');
    expect(formatTime(0.005, true)).toBe('00:00.00');
  });
});

describe('formatTimeShort', () => {
  it('formats integer seconds', () => {
    expect(formatTimeShort(0)).toBe('0s');
    expect(formatTimeShort(5)).toBe('5s');
    expect(formatTimeShort(30)).toBe('30s');
  });

  it('formats fractional seconds', () => {
    expect(formatTimeShort(1.5)).toBe('1.5s');
    expect(formatTimeShort(0.5)).toBe('0.5s');
  });

  it('formats exact minutes', () => {
    expect(formatTimeShort(60)).toBe('1m');
    expect(formatTimeShort(120)).toBe('2m');
  });

  it('formats minutes with seconds', () => {
    expect(formatTimeShort(90)).toBe('1:30');
    expect(formatTimeShort(65)).toBe('1:05');
  });
});
