import { describe, it, expect } from 'vitest';
import { resolvePlatform } from '../src/platform.js';
import { ErrorCode, FlowError } from '../src/errors.js';

describe('resolvePlatform', () => {
  it('android only', () => { expect(resolvePlatform(1, 0)).toBe('android'); });
  it('ios only', () => { expect(resolvePlatform(0, 2)).toBe('ios'); });
  it('both → PLATFORM_AMBIGUOUS', () => {
    expect(() => resolvePlatform(1, 1)).toThrow(FlowError);
    try {
      resolvePlatform(1, 1);
    } catch (err) {
      expect((err as FlowError).code).toBe(ErrorCode.PLATFORM_AMBIGUOUS);
    }
  });
  it('none → NO_DEVICE', () => {
    expect(() => resolvePlatform(0, 0)).toThrow(FlowError);
    try {
      resolvePlatform(0, 0);
    } catch (err) {
      expect((err as FlowError).code).toBe(ErrorCode.NO_DEVICE);
    }
  });
});
