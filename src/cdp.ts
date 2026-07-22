import { Transport, CdpInbound, RawTransport } from './transport.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type TransportFactory = (wsUrl: string) => Transport;
export interface SelectOpts { index?: number; urlMatch?: string; }
export interface RawTarget { type?: string; url?: string; webSocketDebuggerUrl?: string; }

/** /json 타겟 중 page 선택. android는 type==='page', iOS는 type 필드가 없어 ws 있는 첫 타겟. */
export function selectTarget(targets: RawTarget[], opts?: SelectOpts): RawTarget | undefined {
  const pages = targets.filter(
    (t) => t.webSocketDebuggerUrl && (t.type === undefined || t.type === 'page'),
  );
  if (opts?.urlMatch) {
    const m = pages.find((t) => (t.url ?? '').includes(opts.urlMatch!));
    if (m) return m;
  }
  if (opts?.index !== undefined) return pages[opts.index];
  return pages[0];
}

export class CdpClient {
  private transport: Transport | null = null;
  private messageId = 0;
  private pending = new Map<number, PendingRequest>();
  private _connected = false;
  private eventHandlers = new Map<string, Set<(params: Record<string, unknown>) => void>>();
  /** connect 시 선택된 page 타겟의 committed URL (/json 응답 기준). 에러 페이지면 'chrome-error://...'. */
  private _pageUrl: string | null = null;

  constructor(private makeTransport: TransportFactory = (u) => new RawTransport(u)) {}

  get connected(): boolean { return this._connected; }

  /** /json 타겟이 보고하는 실제 committed URL. location.href는 에러 페이지에서 의도한 URL을 반환하지만, 이 값은 chrome-error://를 그대로 노출한다. */
  get pageUrl(): string | null { return this._pageUrl; }

  on(method: string, handler: (params: Record<string, unknown>) => void): void {
    if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, new Set());
    this.eventHandlers.get(method)!.add(handler);
  }
  off(method: string, handler: (params: Record<string, unknown>) => void): void {
    this.eventHandlers.get(method)?.delete(handler);
  }

  async connect(port: number, opts?: SelectOpts): Promise<void> {
    const res = await fetch(`http://127.0.0.1:${port}/json`);
    if (!res.ok) throw new Error(`CDP targets endpoint returned ${res.status}`);
    const targets = (await res.json()) as RawTarget[];
    const page = selectTarget(targets, opts);
    if (!page?.webSocketDebuggerUrl) throw new Error('No page target found in CDP targets');
    this._pageUrl = page.url ?? null;

    this.transport = this.makeTransport(page.webSocketDebuggerUrl);
    this.transport.onMessage((msg) => this.handleMessage(msg));
    this.transport.onClose(() => { this._connected = false; });
    await this.transport.connect();
    this._connected = true;
  }

  private handleMessage(msg: CdpInbound): void {
    if (msg.method !== undefined) {
      const handlers = this.eventHandlers.get(msg.method);
      if (handlers) {
        for (const h of handlers) {
          try { h(msg.params ?? {}); } catch { /* 핸들러 예외 격리 */ }
        }
      }
      return;
    }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
    }
  }

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.transport || !this._connected) throw new Error('Not connected');
    const id = ++this.messageId;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.transport!.send({ id, method, params });
    });
  }

  close(): void {
    this.transport?.close();
    this.transport = null;
    this._connected = false;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Connection closed'));
    }
    this.pending.clear();
  }
}
