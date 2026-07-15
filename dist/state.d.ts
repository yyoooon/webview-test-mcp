import { CdpClient } from './cdp.js';
import { ConsoleBuffer } from './console-log.js';
export interface ConnectionState {
    cdp: CdpClient | null;
    deviceId: string | null;
    forwardedPort: number | null;
    socketName: string | null;
    console: ConsoleBuffer | null;
    platform: 'android' | 'ios' | null;
    iosDevicePort: number | null;
    iosSelect: {
        index?: number;
        urlMatch?: string;
    } | null;
}
export declare const state: ConnectionState;
export declare function resetState(): void;
export declare function isConnected(): boolean;
/** 콘솔 수집은 비필수 — 실패해도 연결 자체는 유지. */
export declare function attachConsole(cdp: CdpClient): Promise<void>;
/** iOS 연결: 프록시 기동 → device port 조회·페이지 열거까지 폴링(콜드스타트 레이스 방어) → CdpClient 연결. */
export declare function connectIos(select: {
    index?: number;
    urlMatch?: string;
}): Promise<{
    cdp: CdpClient;
    devicePort: number;
    pageUrl: string | null;
}>;
export declare function ensureConnected(): Promise<CdpClient>;
