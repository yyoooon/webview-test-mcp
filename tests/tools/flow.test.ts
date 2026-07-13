import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flowHandler } from '../../src/tools/flow.js';
import * as stateModule from '../../src/state.js';
import * as adbModule from '../../src/adb.js';
import { ConsoleBuffer } from '../../src/console-log.js';

vi.mock('../../src/adb.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/adb.js')>();
  return {
    ...actual,
    inputTap: vi.fn().mockResolvedValue(undefined),
    inputSwipe: vi.fn().mockResolvedValue(undefined),
    inputKeyEvent: vi.fn().mockResolvedValue(undefined),
  };
});

function makeFakeCdp(evalReturn: unknown) {
  return {
    connected: true,
    send: vi.fn().mockImplementation((method: string) => {
      if (method === 'Runtime.evaluate') {
        return Promise.resolve({ result: { value: evalReturn } });
      }
      return Promise.resolve({});
    }),
  };
}

function makeFakeCdpQueue(returns: unknown[]) {
  let i = 0;
  return {
    connected: true,
    send: vi.fn().mockImplementation((method: string) => {
      if (method === 'Runtime.evaluate') {
        const value = returns[i++] ?? returns[returns.length - 1];
        return Promise.resolve({ result: { value } });
      }
      return Promise.resolve({});
    }),
  };
}

describe('flowHandler', () => {
  beforeEach(() => { vi.clearAllMocks(); stateModule.resetState(); });

  it('returns error when steps missing', async () => {
    stateModule.state.cdp = makeFakeCdp({}) as any;
    const result = await flowHandler({} as any);
    expect(result.isError).toBe(true);
  });

  it('runs compiled flow and returns marks', async () => {
    const fakeReturn = { marks: [{ i: 0, kind: 'sleep', ok: true, ms: 10 }], totalMs: 12 };
    stateModule.state.cdp = makeFakeCdp(fakeReturn) as any;
    const result = await flowHandler({ steps: [{ sleep: 10 }] });
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text)).toMatchObject({ totalMs: 12 });
  });

  it('truncates oversized capture per outputMaxBytes', async () => {
    const big = 'x'.repeat(2000);
    const fakeReturn = { marks: [{ i: 0, kind: 'capture', ok: true, ms: 1 }], totalMs: 1, captured: { dialog: { text: big } } };
    stateModule.state.cdp = makeFakeCdp(fakeReturn) as any;
    const result = await flowHandler({ steps: [{ capture: { dialog: { text: true } } }], outputMaxBytes: 500 });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.__truncated).toBeDefined();
  });
});

describe('flowHandler — osTap orchestration', () => {
  beforeEach(() => { vi.clearAllMocks(); stateModule.resetState(); });

  it('calls adb inputTap and resumes flow with remaining steps', async () => {
    const segment1 = {
      marks: [
        { i: 0, kind: 'click', ok: true, ms: 5 },
        { i: 1, kind: 'osTap', ok: true, ms: 2, x: 100, y: 200 },
      ],
      totalMs: 7,
      control: { type: 'osTap', i: 1, x: 100, y: 200, selector: '#btn' },
    };
    const segment2 = {
      marks: [{ i: 2, kind: 'capture', ok: true, ms: 1 }],
      totalMs: 1,
      captured: { url: '/home' },
    };
    const cdp = makeFakeCdpQueue([segment1, segment2]);
    stateModule.state.cdp = cdp as any;
    stateModule.state.deviceId = 'TESTDEV';

    const result = await flowHandler({
      steps: [{ click: '#a' }, { osTap: '#btn' }, { capture: { url: true } }],
    });

    expect(adbModule.inputTap).toHaveBeenCalledWith(100, 200, 'TESTDEV');
    expect(cdp.send).toHaveBeenCalledTimes(2);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    // marks merged across both segments, in order
    expect(parsed.marks.map((m: any) => m.kind)).toEqual(['click', 'osTap', 'capture']);
    expect(parsed.captured?.url).toBe('/home');
    // resume signal removed from final result (orchestration consumed it)
    expect(parsed.control).toBeUndefined();
  });

  it('halts after osTap when subsequent step fails', async () => {
    const segment1 = {
      marks: [{ i: 0, kind: 'osTap', ok: true, ms: 1, x: 10, y: 20 }],
      totalMs: 1,
      control: { type: 'osTap', i: 0, x: 10, y: 20, selector: '#x' },
    };
    const segment2 = {
      marks: [{ i: 1, kind: 'click', ok: false, ms: 1, error: 'SELECTOR_NOT_FOUND' }],
      totalMs: 1,
      failedAt: 1,
      snapshot: { url: '/', dialogPresent: false, visibleButtons: [], headings: [] },
    };
    stateModule.state.cdp = makeFakeCdpQueue([segment1, segment2]) as any;
    stateModule.state.deviceId = null;

    const result = await flowHandler({
      steps: [{ osTap: '#x' }, { click: '#missing' }],
    });

    expect(adbModule.inputTap).toHaveBeenCalledWith(10, 20, undefined);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.failedAt).toBe(1);
    expect(parsed.snapshot).toBeDefined();
  });

  it('executes adb inputSwipe and resumes remaining steps', async () => {
    const segment1 = {
      marks: [{ i: 0, kind: 'osSwipe', ok: true, ms: 1 }],
      totalMs: 1,
      control: { type: 'osSwipe', i: 0, x1: 540, y1: 1200, x2: 540, y2: 400, durationMs: 300 },
    };
    const segment2 = {
      marks: [{ i: 1, kind: 'capture', ok: true, ms: 1 }],
      totalMs: 1,
      captured: { url: '/list' },
    };
    stateModule.state.cdp = makeFakeCdpQueue([segment1, segment2]) as any;
    stateModule.state.deviceId = 'TESTDEV';

    const result = await flowHandler({
      steps: [{ osSwipe: { direction: 'up' } }, { capture: { url: true } }] as any,
    });

    expect(adbModule.inputSwipe).toHaveBeenCalledWith(540, 1200, 540, 400, 300, 'TESTDEV');
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.marks.map((m: any) => m.kind)).toEqual(['osSwipe', 'capture']);
    expect(parsed.captured?.url).toBe('/list');
  });
});

describe('flowHandler — console attachment', () => {
  beforeEach(() => { vi.clearAllMocks(); stateModule.resetState(); });

  it('attaches error/warning logs emitted during the flow', async () => {
    const buffer = new ConsoleBuffer();
    buffer.push({ kind: 'console', level: 'error', text: 'before flow' }); // 실행 전 로그 — 제외돼야 함
    stateModule.state.console = buffer;

    const fakeReturn = { marks: [{ i: 0, kind: 'sleep', ok: true, ms: 1 }], totalMs: 1 };
    stateModule.state.cdp = {
      connected: true,
      send: vi.fn().mockImplementation((method: string) => {
        if (method === 'Runtime.evaluate') {
          buffer.push({ kind: 'exception', level: 'error', text: 'TypeError: boom' });
          buffer.push({ kind: 'console', level: 'log', text: 'verbose noise' }); // log 레벨 — 제외
          return Promise.resolve({ result: { value: fakeReturn } });
        }
        return Promise.resolve({});
      }),
    } as any;

    const result = await flowHandler({ steps: [{ sleep: 1 }] });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.console).toEqual([{ kind: 'exception', level: 'error', text: 'TypeError: boom' }]);
  });

  it('omits console field when no errors occurred', async () => {
    stateModule.state.console = new ConsoleBuffer();
    const fakeReturn = { marks: [{ i: 0, kind: 'sleep', ok: true, ms: 1 }], totalMs: 1 };
    stateModule.state.cdp = makeFakeCdp(fakeReturn) as any;

    const result = await flowHandler({ steps: [{ sleep: 1 }] });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.console).toBeUndefined();
  });
});
