interface Device {
    id: string;
    state: string;
}
interface Socket {
    pid: string;
    socketName: string;
}
export declare function pickDevice(): Promise<Device>;
export declare function pickSocket(deviceId: string, index?: number, app?: string): Promise<Socket>;
export {};
