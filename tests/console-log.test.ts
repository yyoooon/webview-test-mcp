import { describe, it, expect, vi } from 'vitest';
import { ConsoleBuffer } from '../src/console-log.js';

function makeFakeCdp() {
  const handlers: Record<string, (params: Record<string, unknown>) => void> = {};
  return {
    handlers,
    on: vi.fn((method: string, h: (params: Record<string, unknown>) => void) => {
      handlers[method] = h;
    }),
    send: vi.fn().mockResolvedValue({}),
  };
}

describe('ConsoleBuffer', () => {
  it('attach subscribes to console/exception events and enables Runtime', async () => {
    const cdp = makeFakeCdp();
    const buffer = new ConsoleBuffer();
    await buffer.attach(cdp as any);
    expect(cdp.send).toHaveBeenCalledWith('Runtime.enable');
    expect(cdp.handlers['Runtime.consoleAPICalled']).toBeDefined();
    expect(cdp.handlers['Runtime.exceptionThrown']).toBeDefined();
  });

  it('records consoleAPICalled with joined args', async () => {
    const cdp = makeFakeCdp();
    const buffer = new ConsoleBuffer();
    await buffer.attach(cdp as any);
    cdp.handlers['Runtime.consoleAPICalled']({
      type: 'error',
      args: [{ type: 'string', value: 'fetch failed:' }, { type: 'number', value: 500 }],
    });
    expect(buffer.since(0)).toEqual([
      { kind: 'console', level: 'error', text: 'fetch failed: 500' },
    ]);
  });

  it('records exceptionThrown with description', async () => {
    const cdp = makeFakeCdp();
    const buffer = new ConsoleBuffer();
    await buffer.attach(cdp as any);
    cdp.handlers['Runtime.exceptionThrown']({
      exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: x is not a function' } },
    });
    expect(buffer.since(0)).toEqual([
      { kind: 'exception', level: 'error', text: 'TypeError: x is not a function' },
    ]);
  });

  it('since(cursor) returns only entries after the cursor', () => {
    const buffer = new ConsoleBuffer();
    buffer.push({ kind: 'console', level: 'error', text: 'old' });
    const cursor = buffer.cursor;
    buffer.push({ kind: 'console', level: 'error', text: 'new' });
    expect(buffer.since(cursor)).toEqual([{ kind: 'console', level: 'error', text: 'new' }]);
  });

  it('evicts oldest beyond 100 entries and keeps cursor math correct', () => {
    const buffer = new ConsoleBuffer();
    for (let i = 0; i < 105; i++) {
      buffer.push({ kind: 'console', level: 'log', text: `msg${i}` });
    }
    const all = buffer.since(0);
    expect(all).toHaveLength(100);
    expect(all[0].text).toBe('msg5');
    expect(buffer.since(103)).toEqual([
      { kind: 'console', level: 'log', text: 'msg103' },
      { kind: 'console', level: 'log', text: 'msg104' },
    ]);
  });

  it('truncates long messages to 300 chars', async () => {
    const cdp = makeFakeCdp();
    const buffer = new ConsoleBuffer();
    await buffer.attach(cdp as any);
    cdp.handlers['Runtime.consoleAPICalled']({
      type: 'error',
      args: [{ type: 'string', value: 'x'.repeat(500) }],
    });
    expect(buffer.since(0)[0].text).toHaveLength(300);
  });
});
