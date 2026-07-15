import { describe, it, expect, vi } from 'vitest';
import WebSocket from 'ws';
import { wrapForTarget, unwrapFromTarget, RawTransport } from '../src/transport.js';

vi.mock('ws', () => {
  const MockWebSocket = vi.fn().mockImplementation(() => {
    const listeners: Record<string, Function[]> = {};
    return {
      on(event: string, cb: Function) { (listeners[event] ??= []).push(cb); },
      send: vi.fn(),
      close: vi.fn(),
      _emit(event: string, ...args: any[]) { for (const cb of listeners[event] || []) cb(...args); },
    };
  });
  return { default: MockWebSocket };
});

describe('wrapForTarget', () => {
  it('wraps a CDP command into Target.sendMessageToTarget with stringified inner message', () => {
    const wrapped = wrapForTarget('page-1', { id: 7, method: 'Runtime.evaluate', params: { expression: '1+1' } });
    expect(wrapped.method).toBe('Target.sendMessageToTarget');
    expect(wrapped.params!.targetId).toBe('page-1');
    expect(JSON.parse(wrapped.params!.message as string)).toEqual({
      id: 7, method: 'Runtime.evaluate', params: { expression: '1+1' },
    });
  });
});

describe('unwrapFromTarget', () => {
  it('extracts inner CDP message from Target.dispatchMessageFromTarget', () => {
    const inner = { id: 7, result: { result: { value: 2 } } };
    const res = unwrapFromTarget({
      method: 'Target.dispatchMessageFromTarget',
      params: { targetId: 'page-1', message: JSON.stringify(inner) },
    });
    expect(res).toEqual({ kind: 'message', msg: inner });
  });

  it('recognizes a page targetCreated', () => {
    const res = unwrapFromTarget({
      method: 'Target.targetCreated',
      params: { targetInfo: { targetId: 'page-178', type: 'page' } },
    });
    expect(res).toEqual({ kind: 'targetCreated', targetId: 'page-178', type: 'page' });
  });

  it('recognizes targetDestroyed', () => {
    const res = unwrapFromTarget({ method: 'Target.targetDestroyed', params: { targetId: 'page-178' } });
    expect(res).toEqual({ kind: 'targetDestroyed', targetId: 'page-178' });
  });

  it('classifies an envelope ack (no method) as other', () => {
    expect(unwrapFromTarget({ id: 100, result: {} })).toEqual({ kind: 'other' });
  });
});

describe('RawTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves connect on ws open and forwards parsed messages', async () => {
    const t = new RawTransport('ws://x/1');
    const received: any[] = [];
    t.onMessage((m) => received.push(m));
    const p = t.connect();
    const ws = vi.mocked(WebSocket).mock.results.at(-1)!.value;
    ws._emit('open');
    await p;
    ws._emit('message', JSON.stringify({ id: 1, result: { ok: true } }));
    expect(received).toEqual([{ id: 1, result: { ok: true } }]);
  });

  it('send serializes the raw CDP message to ws', async () => {
    const t = new RawTransport('ws://x/1');
    const p = t.connect();
    const ws = vi.mocked(WebSocket).mock.results.at(-1)!.value;
    ws._emit('open');
    await p;
    t.send({ id: 3, method: 'Runtime.evaluate', params: { expression: '2' } });
    expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({ id: 3, method: 'Runtime.evaluate', params: { expression: '2' } });
  });

  it('onClose fires when ws closes', async () => {
    const t = new RawTransport('ws://x/1');
    const closed = vi.fn();
    t.onClose(closed);
    const p = t.connect();
    const ws = vi.mocked(WebSocket).mock.results.at(-1)!.value;
    ws._emit('open');
    await p;
    ws._emit('close');
    expect(closed).toHaveBeenCalled();
  });
});
