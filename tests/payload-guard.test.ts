import { describe, it, expect } from 'vitest';
import { applyPayloadGuard } from '../src/payload-guard.js';

describe('applyPayloadGuard', () => {
  it('passes through small payloads unchanged', () => {
    const input = { url: '/foo', count: 3 };
    const out = applyPayloadGuard(input, 1000);
    expect(out).toEqual(input);
  });

  it('truncates string fields exceeding limit, marks __truncated', () => {
    const big = 'x'.repeat(2000);
    const input = { dialog: { text: big }, url: '/' };
    const out = applyPayloadGuard(input, 500) as Record<string, unknown>;
    const dialog = out.dialog as Record<string, unknown>;
    expect((dialog.text as string).length).toBeLessThan(big.length);
    expect((dialog.text as string)).toContain('...');
    expect(out.__truncated).toBeDefined();
  });

  it('truncates the largest field first', () => {
    const small = 'a'.repeat(50);
    const big = 'b'.repeat(2000);
    const input = { small, big };
    const out = applyPayloadGuard(input, 200) as Record<string, unknown>;
    expect((out.big as string).length).toBeLessThan(big.length);
    expect((out.small as string).length).toBe(50);
    expect(out.__truncated).toBeDefined();
  });

  it('handles arrays of strings', () => {
    const big = 'x'.repeat(2000);
    const input = { toasts: [big, big] };
    const out = applyPayloadGuard(input, 500) as Record<string, unknown>;
    const toasts = out.toasts as string[];
    expect(toasts[0].length).toBeLessThan(big.length);
  });
});
