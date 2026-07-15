export interface IosPage {
    url: string;
    webSocketDebuggerUrl: string;
    appId?: string;
}
export declare function hasIosTooling(): boolean;
export declare function listIosDevices(): string[];
export declare function parseDeviceList(json: unknown): {
    deviceId: string;
    port: number;
}[];
export declare function ensureProxy(): Promise<number>;
export declare function stopProxy(): void;
export declare function getDevicePort(frontPort: number): Promise<number>;
export declare function listPages(devicePort: number): Promise<IosPage[]>;
/** proxy 갓 spawn 시 기기 인스펙터가 cold라 첫 listPages가 빈 목록일 수 있음 → 페이지 열거까지 폴링. */
export declare function discoverIosPages(frontPort: number, timeoutMs?: number): Promise<{
    devicePort: number;
    pages: IosPage[];
}>;
