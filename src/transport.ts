import WebSocket from 'ws';

export interface CdpOutbound {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface CdpInbound {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
  method?: string;
  params?: Record<string, unknown>;
}

export interface Transport {
  connect(): Promise<void>;
  send(msg: CdpOutbound): void;
  onMessage(cb: (msg: CdpInbound) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export type Unwrapped =
  | { kind: 'message'; msg: CdpInbound }
  | { kind: 'targetCreated'; targetId: string; type: string }
  | { kind: 'targetDestroyed'; targetId: string }
  | { kind: 'other' };

export function wrapForTarget(targetId: string, msg: CdpOutbound): CdpOutbound {
  return {
    id: msg.id,
    method: 'Target.sendMessageToTarget',
    params: { targetId, message: JSON.stringify(msg) },
  };
}

export function unwrapFromTarget(raw: Record<string, unknown>): Unwrapped {
  const method = raw.method as string | undefined;
  const params = (raw.params ?? {}) as Record<string, unknown>;
  if (method === 'Target.dispatchMessageFromTarget') {
    const msg = JSON.parse(params.message as string) as CdpInbound;
    return { kind: 'message', msg };
  }
  if (method === 'Target.targetCreated') {
    const info = (params.targetInfo ?? {}) as { targetId: string; type: string };
    return { kind: 'targetCreated', targetId: info.targetId, type: info.type };
  }
  if (method === 'Target.targetDestroyed') {
    return { kind: 'targetDestroyed', targetId: params.targetId as string };
  }
  return { kind: 'other' };
}

export class RawTransport implements Transport {
  private ws: WebSocket | null = null;
  private messageCb: (msg: CdpInbound) => void = () => {};
  private closeCb: () => void = () => {};

  constructor(private wsUrl: string) {}

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('message', (data: WebSocket.Data) => {
        this.messageCb(JSON.parse(data.toString()) as CdpInbound);
      });
      this.ws.on('close', () => this.closeCb());
      this.ws.on('error', (err: Error) => { this.closeCb(); reject(err); });
    });
  }

  send(msg: CdpOutbound): void {
    this.ws!.send(JSON.stringify(msg));
  }

  onMessage(cb: (msg: CdpInbound) => void): void { this.messageCb = cb; }
  onClose(cb: () => void): void { this.closeCb = cb; }

  close(): void {
    if (this.ws) { this.ws.close(); this.ws = null; }
  }
}

export class IosTargetTransport implements Transport {
  private ws: WebSocket | null = null;
  private messageCb: (msg: CdpInbound) => void = () => {};
  private closeCb: () => void = () => {};
  private pageTargetId: string | null = null;
  private onPageReady: (() => void) | null = null;
  private announceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private wsUrl: string) {}

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.announceTimer = setTimeout(
        () => reject(new Error('iOS page target announce 타임아웃 (맥 웹 인스펙터 창을 닫으세요)')),
        5000,
      );
      this.onPageReady = () => {
        if (this.announceTimer) clearTimeout(this.announceTimer);
        this.announceTimer = null;
        resolve();
      };

      this.ws.on('message', (data: WebSocket.Data) => {
        const raw = JSON.parse(data.toString()) as Record<string, unknown>;
        const u = unwrapFromTarget(raw);
        if (u.kind === 'targetCreated' && u.type === 'page') {
          this.pageTargetId = u.targetId;
          this.onPageReady?.();
          this.onPageReady = null;
        } else if (u.kind === 'message') {
          this.messageCb(u.msg);
        }
        // targetDestroyed / other → 무시
      });
      this.ws.on('close', () => this.closeCb());
      this.ws.on('error', (err: Error) => {
        if (this.announceTimer) clearTimeout(this.announceTimer);
        this.announceTimer = null;
        this.closeCb();
        reject(err);
      });
    });
  }

  send(msg: CdpOutbound): void {
    if (!this.pageTargetId) throw new Error('iOS page target 미확보');
    this.ws!.send(JSON.stringify(wrapForTarget(this.pageTargetId, msg)));
  }

  onMessage(cb: (msg: CdpInbound) => void): void { this.messageCb = cb; }
  onClose(cb: () => void): void { this.closeCb = cb; }

  close(): void {
    if (this.announceTimer) { clearTimeout(this.announceTimer); this.announceTimer = null; }
    if (this.ws) { this.ws.close(); this.ws = null; }
  }
}
