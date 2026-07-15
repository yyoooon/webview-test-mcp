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

describe('flowHandler — osKey orchestration', () => {
  beforeEach(() => { vi.clearAllMocks(); stateModule.resetState(); });

  it('executes adb inputKeyEvent for osKey control', async () => {
    const segment1 = {
      marks: [{ i: 0, kind: 'osKey', ok: true, ms: 0, key: 'BACK' }],
      totalMs: 0,
      control: { type: 'osKey', i: 0, key: 'BACK' },
    };
    const segment2 = { marks: [{ i: 1, kind: 'sleep', ok: true, ms: 1 }], totalMs: 1 };
    stateModule.state.cdp = makeFakeCdpQueue([segment1, segment2]) as any;
    stateModule.state.deviceId = 'TESTDEV';

    const result = await flowHandler({ steps: [{ osKey: 'BACK' }, { sleep: 1 }] as any });

    expect(adbModule.inputKeyEvent).toHaveBeenCalledWith('BACK', 'TESTDEV');
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.marks.map((m: any) => m.kind)).toEqual(['osKey', 'sleep']);
  });
});

describe('flowHandler — bail continue with control step after failure', () => {
  beforeEach(() => { vi.clearAllMocks(); stateModule.resetState(); });

  it('preserves failedAt/snapshot from a segment that also carries a control signal', async () => {
    const segment1 = {
      marks: [
        { i: 0, kind: 'click', ok: false, ms: 1, error: 'SELECTOR_NOT_FOUND' },
        { i: 1, kind: 'osKey', ok: true, ms: 0, key: 'BACK' },
      ],
      totalMs: 1,
      failedAt: 0,
      snapshot: { url: '/', dialogPresent: false, visibleButtons: [], headings: [] },
      control: { type: 'osKey', i: 1, key: 'BACK' },
    };
    const segment2 = { marks: [{ i: 2, kind: 'sleep', ok: true, ms: 1 }], totalMs: 1 };
    stateModule.state.cdp = makeFakeCdpQueue([segment1, segment2]) as any;
    stateModule.state.deviceId = 'TESTDEV';

    const result = await flowHandler({
      bail: 'continue',
      steps: [{ click: '#missing' }, { osKey: 'BACK' }, { sleep: 1 }] as any,
    });

    expect(adbModule.inputKeyEvent).toHaveBeenCalledWith('BACK', 'TESTDEV');
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.failedAt).toBe(0);
    expect(parsed.snapshot).toBeDefined();
  });
});

describe('flowHandler — nav orchestration', () => {
  beforeEach(() => { vi.clearAllMocks(); stateModule.resetState(); });

  it('nav control triggers Page.navigate then polls readyState and resumes', async () => {
    const segment1 = {
      marks: [{ i: 0, kind: 'goto', ok: true, ms: 0, nav: 'http://x.test/a' }],
      totalMs: 0,
      control: { type: 'nav', i: 0, url: 'http://x.test/a', reload: false, timeoutMs: 5000 },
    };
    const segment2 = { marks: [{ i: 1, kind: 'sleep', ok: true, ms: 1 }], totalMs: 1 };
    // Runtime.evaluate 순서: segment1 → readyState 폴링('complete') → segment2
    const cdp = makeFakeCdpQueue([segment1, 'complete', segment2]);
    stateModule.state.cdp = cdp as any;

    const result = await flowHandler({
      steps: [{ goto: { url: 'http://x.test/a' } }, { sleep: 1 }] as any,
    });

    expect(cdp.send).toHaveBeenCalledWith('Page.navigate', { url: 'http://x.test/a' });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.marks.map((m: any) => m.kind)).toEqual(['goto', 'sleep']);
  }, 10_000);

  it('resolves nav via Page.loadEventFired (event-driven, no fixed delay) when events available', async () => {
    const handlers: Record<string, (p: any) => void> = {};
    const segment1 = {
      marks: [{ i: 0, kind: 'goto', ok: true, ms: 0, nav: 'http://x.test/a' }],
      totalMs: 0,
      control: { type: 'nav', i: 0, url: 'http://x.test/a', reload: false, timeoutMs: 5000 },
    };
    const segment2 = { marks: [{ i: 1, kind: 'sleep', ok: true, ms: 1 }], totalMs: 1 };
    let i = 0;
    const cdp = {
      connected: true,
      on: vi.fn().mockImplementation((m: string, h: (p: any) => void) => { handlers[m] = h; }),
      off: vi.fn(),
      send: vi.fn().mockImplementation((method: string) => {
        if (method === 'Runtime.evaluate') {
          const v = [segment1, segment2][i++];
          return Promise.resolve({ result: { value: v } });
        }
        if (method === 'Page.navigate') {
          // 실제 기기처럼 잠시 후 load 이벤트 발생
          setTimeout(() => handlers['Page.loadEventFired']?.({}), 20);
        }
        return Promise.resolve({});
      }),
    };
    stateModule.state.cdp = cdp as any;

    const result = await flowHandler({ steps: [{ goto: { url: 'http://x.test/a' } }, { sleep: 1 }] as any });

    expect(cdp.send).toHaveBeenCalledWith('Page.enable', {});
    // readyState 폴링(폴백)이 아니라 이벤트로 진행 — Runtime.evaluate는 segment 실행 2회뿐
    const evalCalls = cdp.send.mock.calls.filter((c) => c[0] === 'Runtime.evaluate');
    expect(evalCalls).toHaveLength(2);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.marks.map((m: any) => m.kind)).toEqual(['goto', 'sleep']);
  }, 10_000);

  it('nav control with reload triggers Page.reload', async () => {
    const segment1 = {
      marks: [{ i: 0, kind: 'goto', ok: true, ms: 0 }],
      totalMs: 0,
      control: { type: 'nav', i: 0, url: 'http://x.test/', reload: true, timeoutMs: 5000 },
    };
    const cdp = makeFakeCdpQueue([segment1, 'complete']);
    stateModule.state.cdp = cdp as any;

    await flowHandler({ steps: [{ goto: { reload: true } }] as any });

    expect(cdp.send).toHaveBeenCalledWith('Page.reload', {});
  }, 10_000);
});

describe('flowHandler — netwait orchestration', () => {
  beforeEach(() => { vi.clearAllMocks(); stateModule.resetState(); });

  // CDP fake that records event handlers and lets the test emit Network events.
  function makeNetCdp(segments: unknown[]) {
    let i = 0;
    const handlers: Record<string, (p: any) => void> = {};
    return {
      connected: true,
      on: vi.fn().mockImplementation((method: string, h: (p: any) => void) => { handlers[method] = h; }),
      off: vi.fn(),
      emit: (method: string, p: any) => handlers[method]?.(p),
      send: vi.fn().mockImplementation((method: string) => {
        if (method === 'Runtime.evaluate') {
          const value = segments[i++] ?? segments[segments.length - 1];
          return Promise.resolve({ result: { value } });
        }
        return Promise.resolve({});
      }),
    };
  }

  it('enables Network and resolves when a matching POST response arrives', async () => {
    const segment1 = {
      marks: [{ i: 0, kind: 'click', ok: true, ms: 1 }],
      totalMs: 1,
      // netwait control emitted by compiler for step 1
      control: { type: 'netwait', i: 1, method: 'POST', urlContains: '/gourd/throw', timeoutMs: 3000 },
    };
    const segment2 = { marks: [{ i: 2, kind: 'capture', ok: true, ms: 1 }], totalMs: 1, captured: { url: '/home' } };
    const cdp = makeNetCdp([segment1, segment2]);
    stateModule.state.cdp = cdp as any;

    const resultPromise = flowHandler({
      steps: [
        { click: '#throw' },
        { waitFor: { network: 'POST /gourd/throw' } },
        { capture: { url: true } },
      ] as any,
    });

    // simulate the request firing shortly after
    await new Promise((r) => setTimeout(r, 50));
    cdp.emit('Network.requestWillBeSent', { requestId: 'r1', request: { method: 'POST', url: 'https://api.test/gourd/throw' } });
    cdp.emit('Network.responseReceived', { requestId: 'r1', response: { url: 'https://api.test/gourd/throw', status: 200 } });

    const result = await resultPromise;
    expect(cdp.send).toHaveBeenCalledWith('Network.enable', {});
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    const netMark = parsed.marks.find((m: any) => m.matched);
    expect(netMark).toBeDefined();
    expect(netMark.matched.status).toBe(200);
    expect(parsed.marks.map((m: any) => m.kind)).toEqual(['click', 'waitFor', 'capture']);
    expect(parsed.captured?.url).toBe('/home');
  }, 10_000);

  it('times out with NETWORK_TIMEOUT when no matching request fires', async () => {
    const segment1 = {
      marks: [],
      totalMs: 0,
      control: { type: 'netwait', i: 0, method: 'POST', urlContains: '/never', timeoutMs: 300 },
    };
    const cdp = makeNetCdp([segment1]);
    stateModule.state.cdp = cdp as any;

    const result = await flowHandler({
      steps: [{ waitFor: { network: 'POST /never' } }] as any,
    });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.failedAt).toBe(0);
    const mark = parsed.marks.find((m: any) => m.error === 'NETWORK_TIMEOUT');
    expect(mark).toBeDefined();
  }, 10_000);

  it('does not enable Network when no netwait step present', async () => {
    const cdp = makeNetCdp([{ marks: [{ i: 0, kind: 'sleep', ok: true, ms: 1 }], totalMs: 1 }]);
    stateModule.state.cdp = cdp as any;
    await flowHandler({ steps: [{ sleep: 1 }] });
    expect(cdp.send).not.toHaveBeenCalledWith('Network.enable', {});
  });
});

describe('flowHandler — iOS awaitPromise fallback', () => {
  beforeEach(() => { vi.clearAllMocks(); stateModule.resetState(); stateModule.state.platform = 'ios'; });
  afterEach(() => { stateModule.state.platform = null; });

  it('polls window global instead of awaitPromise and returns marks', async () => {
    const cdp = {
      connected: true,
      send: vi.fn().mockImplementation((method: string, params?: any) => {
        if (method === 'Runtime.evaluate') {
          if (params?.returnByValue) {
            // 폴링 evaluate: done:true를 첫 호출에 반환해 대기 없이 결정적으로 통과
            return Promise.resolve({
              result: { value: JSON.stringify({ done: true, value: { marks: [], totalMs: 1 } }) },
            });
          }
          // kickoff evaluate: 반환값은 사용되지 않음
          return Promise.resolve({ result: { value: undefined } });
        }
        return Promise.resolve({});
      }),
    };
    stateModule.state.cdp = cdp as any;

    const result = await flowHandler({ steps: [{ sleep: 1 }] });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.marks).toEqual([]);
    expect(parsed.totalMs).toBe(1);
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
