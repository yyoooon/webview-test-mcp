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
