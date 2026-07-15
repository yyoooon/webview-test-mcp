import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clickHandler, typeHandler } from '../../src/tools/interact.js';
import * as stateModule from '../../src/state.js';

function makeFakeCdp(evalResult: unknown = { result: { value: '{"x":100,"y":200}' } }) {
  return {
    connected: true,
    send: vi.fn().mockImplementation((method: string) => {
      if (method === 'Runtime.evaluate') return Promise.resolve(evalResult);
      if (method === 'Input.dispatchMouseEvent') return Promise.resolve({});
      if (method === 'Input.insertText') return Promise.resolve({});
      return Promise.resolve({});
    }),
  };
}

describe('clickHandler', () => {
  beforeEach(() => { vi.clearAllMocks(); stateModule.resetState(); });

  it('clicks element by selector', async () => {
    const fakeCdp = makeFakeCdp();
    stateModule.state.cdp = fakeCdp as any;
    const result = await clickHandler({ selector: '#submit-btn' });
    expect(result.isError).toBeUndefined();
    expect(fakeCdp.send).toHaveBeenCalledWith('Runtime.evaluate', expect.objectContaining({ expression: expect.stringContaining('#submit-btn') }));
    const mouseDownCall = fakeCdp.send.mock.calls.find((c: any) => c[0] === 'Input.dispatchMouseEvent' && c[1].type === 'mousePressed');
    expect(mouseDownCall).toBeDefined();
    expect(mouseDownCall![1].x).toBe(100);
    expect(mouseDownCall![1].y).toBe(200);
  });

  it('clicks element by text', async () => {
    const fakeCdp = makeFakeCdp();
    stateModule.state.cdp = fakeCdp as any;
    const result = await clickHandler({ text: '다음' });
    expect(result.isError).toBeUndefined();
    expect(fakeCdp.send).toHaveBeenCalledWith('Runtime.evaluate', expect.objectContaining({ expression: expect.stringContaining('다음') }));
  });

  it('returns error when element not found', async () => {
    const fakeCdp = makeFakeCdp({ result: { value: '{"error":"not_found","similar":[]}' } });
    stateModule.state.cdp = fakeCdp as any;
    const result = await clickHandler({ selector: '#nonexistent' });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('찾을 수 없습니다');
  });

  it('returns error when neither selector nor text provided', async () => {
    stateModule.state.cdp = makeFakeCdp() as any;
    const result = await clickHandler({});
    expect(result.isError).toBe(true);
  });
});

describe('typeHandler', () => {
  beforeEach(() => { vi.clearAllMocks(); stateModule.resetState(); });

  it('focuses element and types text', async () => {
    const fakeCdp = makeFakeCdp();
    stateModule.state.cdp = fakeCdp as any;
    const result = await typeHandler({ selector: 'input[name="email"]', value: 'test@test.com' });
    expect(result.isError).toBeUndefined();
    const insertCall = fakeCdp.send.mock.calls.find((c: any) => c[0] === 'Input.insertText');
    expect(insertCall).toBeDefined();
    expect(insertCall![1].text).toBe('test@test.com');
  });

  it('returns error when value is missing', async () => {
    stateModule.state.cdp = makeFakeCdp() as any;
    const result = await typeHandler({ selector: '#input' } as any);
    expect(result.isError).toBe(true);
  });
});

describe('clickHandler (iOS)', () => {
  beforeEach(() => { vi.clearAllMocks(); stateModule.resetState(); stateModule.state.platform = 'ios'; });
  afterEach(() => { stateModule.state.platform = null; });

  it('clicks element via Runtime.evaluate elementFromPoint, not Input.dispatchMouseEvent', async () => {
    const fakeCdp = makeFakeCdp();
    stateModule.state.cdp = fakeCdp as any;
    const result = await clickHandler({ selector: '#submit-btn' });
    expect(result.isError).toBeUndefined();
    const inputCalls = fakeCdp.send.mock.calls.filter((c: any) => c[0] === 'Input.dispatchMouseEvent');
    expect(inputCalls.length).toBe(0);
    const clickEvalCall = fakeCdp.send.mock.calls.find(
      (c: any) => c[0] === 'Runtime.evaluate' && c[1].expression.includes('elementFromPoint') && c[1].expression.includes('.click()'),
    );
    expect(clickEvalCall).toBeDefined();
  });

  it('returns error when element not found (iOS)', async () => {
    const fakeCdp = makeFakeCdp({ result: { value: '{"error":"not_found","similar":[]}' } });
    stateModule.state.cdp = fakeCdp as any;
    const result = await clickHandler({ selector: '#nonexistent' });
    expect(result.isError).toBe(true);
  });
});

describe('typeHandler (iOS)', () => {
  beforeEach(() => { vi.clearAllMocks(); stateModule.resetState(); stateModule.state.platform = 'ios'; });
  afterEach(() => { stateModule.state.platform = null; });

  it('types via Runtime.evaluate value-setter, not Input.insertText', async () => {
    const fakeCdp = makeFakeCdp();
    stateModule.state.cdp = fakeCdp as any;
    const result = await typeHandler({ selector: 'input[name="email"]', value: 'test@test.com' });
    expect(result.isError).toBeUndefined();
    const insertCalls = fakeCdp.send.mock.calls.filter((c: any) => c[0] === 'Input.insertText');
    expect(insertCalls.length).toBe(0);
    const typeEvalCall = fakeCdp.send.mock.calls.find(
      (c: any) => c[0] === 'Runtime.evaluate' && c[1].expression.includes('elementFromPoint') && c[1].expression.includes('test@test.com'),
    );
    expect(typeEvalCall).toBeDefined();
  });
});
