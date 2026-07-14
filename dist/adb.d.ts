export interface AdbDevice {
    id: string;
    state: string;
}
export interface WebViewSocket {
    pid: string;
    socketName: string;
}
export declare function getConnectedDevices(): Promise<AdbDevice[]>;
export declare function findWebViewSockets(deviceId?: string): Promise<WebViewSocket[]>;
export declare function forwardPort(socketName: string, deviceId?: string): Promise<number>;
export declare function removeForward(port: number): Promise<void>;
export declare function inputTap(x: number, y: number, deviceId?: string): Promise<void>;
export declare function inputSwipe(x1: number, y1: number, x2: number, y2: number, durationMs: number, deviceId?: string): Promise<void>;
export declare function inputKeyEvent(key: string, deviceId?: string): Promise<void>;
export declare function getProcessName(pid: string, deviceId?: string): Promise<string | null>;
