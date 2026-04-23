import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CdpClient } from '../src/cdp.js';
import WebSocket from 'ws';

vi.mock('ws', () => {
  const listeners: Record<string, Function[]> = {};
  const MockWebSocket = vi.fn().mockImplementation(() => ({
    on(event: string, cb: Function) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    },
    send: vi.fn(),
    close: vi.fn(),
    _listeners: listeners,
    _emit(event: string, ...args: any[]) {
      for (const cb of listeners[event] || []) cb(...args);
    },
  }));
  return { default: MockWebSocket, __listeners: listeners };
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('CdpClient', () => {
  let client: CdpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new CdpClient();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        webSocketDebuggerUrl: 'ws://localhost:9222/devtools/browser/abc',
      }),
    });
  });

  afterEach(() => {
    client.close();
  });

  it('connects to CDP endpoint', async () => {
    const connectPromise = client.connect(9222);
    await vi.waitFor(() => {
      const ws = vi.mocked(WebSocket).mock.results[0]?.value;
      expect(ws).toBeDefined();
      ws._emit('open');
    });
    await connectPromise;
    expect(client.connected).toBe(true);
  });

  it('sends CDP command and resolves response', async () => {
    const connectPromise = client.connect(9222);
    await vi.waitFor(() => {
      const ws = vi.mocked(WebSocket).mock.results[0]?.value;
      ws._emit('open');
    });
    await connectPromise;

    const ws = vi.mocked(WebSocket).mock.results[0].value;
    const resultPromise = client.send('Runtime.evaluate', { expression: '1+1' });

    const sentMsg = JSON.parse(ws.send.mock.calls[0][0] as string);
    ws._emit('message', JSON.stringify({ id: sentMsg.id, result: { result: { value: 2 } } }));

    const result = await resultPromise;
    expect(result).toEqual({ result: { value: 2 } });
  });

  it('rejects on CDP error response', async () => {
    const connectPromise = client.connect(9222);
    await vi.waitFor(() => {
      const ws = vi.mocked(WebSocket).mock.results[0]?.value;
      ws._emit('open');
    });
    await connectPromise;

    const ws = vi.mocked(WebSocket).mock.results[0].value;
    const resultPromise = client.send('Bad.method', {});

    const sentMsg = JSON.parse(ws.send.mock.calls[0][0] as string);
    ws._emit('message', JSON.stringify({ id: sentMsg.id, error: { code: -32601, message: 'Method not found' } }));

    await expect(resultPromise).rejects.toThrow('Method not found');
  });

  it('throws when sending on closed connection', async () => {
    await expect(client.send('Runtime.evaluate', {})).rejects.toThrow('Not connected');
  });

  it('sets connected to false on close', async () => {
    const connectPromise = client.connect(9222);
    await vi.waitFor(() => {
      const ws = vi.mocked(WebSocket).mock.results[0]?.value;
      ws._emit('open');
    });
    await connectPromise;
    expect(client.connected).toBe(true);

    const ws = vi.mocked(WebSocket).mock.results[0].value;
    ws._emit('close');
    expect(client.connected).toBe(false);
  });
});
