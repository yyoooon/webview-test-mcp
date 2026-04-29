import { describe, it, expect } from 'vitest';
import { ErrorCode, formatError, FlowError } from '../src/errors.js';

describe('FlowError', () => {
  it('preserves code + message + extras', () => {
    const err = new FlowError(ErrorCode.SELECTOR_NOT_FOUND, 'no match', { similar: ['Foo'] });
    expect(err.code).toBe(ErrorCode.SELECTOR_NOT_FOUND);
    expect(err.message).toBe('no match');
    expect(err.extras).toEqual({ similar: ['Foo'] });
  });
});

describe('formatError', () => {
  it('formats NO_DEVICE with action hint', () => {
    const out = formatError(ErrorCode.NO_DEVICE);
    expect(out.code).toBe('NO_DEVICE');
    expect(out.message).toContain('adb');
  });

  it('formats SELECTOR_NOT_FOUND with extras', () => {
    const out = formatError(ErrorCode.SELECTOR_NOT_FOUND, { similar: ['Cancel'] });
    expect(out.extras).toEqual({ similar: ['Cancel'] });
  });
});
