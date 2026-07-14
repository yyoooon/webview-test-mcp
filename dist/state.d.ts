import { CdpClient } from './cdp.js';
import { ConsoleBuffer } from './console-log.js';
export interface ConnectionState {
    cdp: CdpClient | null;
    deviceId: string | null;
    forwardedPort: number | null;
    socketName: string | null;
    console: ConsoleBuffer | null;
}
export declare const state: ConnectionState;
export declare function resetState(): void;
export declare function isConnected(): boolean;
/** 콘솔 수집은 비필수 — 실패해도 연결 자체는 유지. */
export declare function attachConsole(cdp: CdpClient): Promise<void>;
export declare function ensureConnected(): Promise<CdpClient>;
