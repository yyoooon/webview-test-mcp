import WebSocket from 'ws';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CdpClient {
  private ws: WebSocket | null = null;
  private messageId = 0;
  private pending = new Map<number, PendingRequest>();
  private _connected = false;
  private eventHandlers = new Map<string, Set<(params: Record<string, unknown>) => void>>();
  /** connect 시 선택된 page 타겟의 committed URL (/json 응답 기준). 에러 페이지면 'chrome-error://...'. */
  private _pageUrl: string | null = null;

  get connected(): boolean {
    return this._connected;
  }

  /** /json 타겟이 보고하는 실제 committed URL. location.href는 에러 페이지에서 의도한 URL을 반환하지만, 이 값은 chrome-error://를 그대로 노출한다. */
  get pageUrl(): string | null {
    return this._pageUrl;
  }

  on(method: string, handler: (params: Record<string, unknown>) => void): void {
    if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, new Set());
    this.eventHandlers.get(method)!.add(handler);
  }

  off(method: string, handler: (params: Record<string, unknown>) => void): void {
    this.eventHandlers.get(method)?.delete(handler);
  }

  async connect(port: number): Promise<void> {
    const res = await fetch(`http://127.0.0.1:${port}/json`);
    if (!res.ok) throw new Error(`CDP targets endpoint returned ${res.status}`);
    const targets = (await res.json()) as Array<{
      type: string;
      url?: string;
      webSocketDebuggerUrl?: string;
    }>;
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!page?.webSocketDebuggerUrl) {
      throw new Error('No page target found in CDP targets');
    }
    const wsUrl = page.webSocketDebuggerUrl;
    this._pageUrl = page.url ?? null;

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this._connected = true;
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        const msg = JSON.parse(data.toString()) as {
          id?: number;
          result?: unknown;
          error?: { code: number; message: string };
          method?: string;
          params?: Record<string, unknown>;
        };
        if (msg.method !== undefined) {
          const handlers = this.eventHandlers.get(msg.method);
          if (handlers) {
            for (const h of handlers) {
              try {
                h(msg.params ?? {});
              } catch {
                // 이벤트 핸들러 예외가 ws 콜백/다른 핸들러를 죽이지 않도록 격리
              }
            }
          }
          return;
        }
        if (msg.id !== undefined) {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            clearTimeout(p.timer);
            if (msg.error) {
              p.reject(new Error(msg.error.message));
            } else {
              p.resolve(msg.result);
            }
          }
        }
      });

      this.ws.on('close', () => {
        this._connected = false;
      });

      this.ws.on('error', (err: Error) => {
        this._connected = false;
        reject(err);
      });
    });
  }

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || !this._connected) {
      throw new Error('Not connected');
    }
    const id = ++this.messageId;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30_000);

      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Connection closed'));
    }
    this.pending.clear();
  }
}
