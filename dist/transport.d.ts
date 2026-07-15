export interface CdpOutbound {
    id: number;
    method: string;
    params?: Record<string, unknown>;
}
export interface CdpInbound {
    id?: number;
    result?: unknown;
    error?: {
        code: number;
        message: string;
    };
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
export type Unwrapped = {
    kind: 'message';
    msg: CdpInbound;
} | {
    kind: 'targetCreated';
    targetId: string;
    type: string;
} | {
    kind: 'targetDestroyed';
    targetId: string;
} | {
    kind: 'other';
};
export declare function wrapForTarget(targetId: string, msg: CdpOutbound): CdpOutbound;
export declare function unwrapFromTarget(raw: Record<string, unknown>): Unwrapped;
export declare class RawTransport implements Transport {
    private wsUrl;
    private ws;
    private messageCb;
    private closeCb;
    constructor(wsUrl: string);
    connect(): Promise<void>;
    send(msg: CdpOutbound): void;
    onMessage(cb: (msg: CdpInbound) => void): void;
    onClose(cb: () => void): void;
    close(): void;
}
export declare class IosTargetTransport implements Transport {
    private wsUrl;
    private ws;
    private messageCb;
    private closeCb;
    private pageTargetId;
    private onPageReady;
    private announceTimer;
    constructor(wsUrl: string);
    connect(): Promise<void>;
    send(msg: CdpOutbound): void;
    onMessage(cb: (msg: CdpInbound) => void): void;
    onClose(cb: () => void): void;
    close(): void;
}
