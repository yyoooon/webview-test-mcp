import { CdpClient } from './cdp.js';
import { ConsoleBuffer } from './console-log.js';
import { pickDevice, pickSocket } from './discovery.js';
import { forwardPort } from './adb.js';
export const state = {
    cdp: null,
    deviceId: null,
    forwardedPort: null,
    socketName: null,
    console: null,
};
export function resetState() {
    state.cdp = null;
    state.deviceId = null;
    state.forwardedPort = null;
    state.socketName = null;
    state.console = null;
}
export function isConnected() {
    return state.cdp !== null && state.cdp.connected;
}
/** 콘솔 수집은 비필수 — 실패해도 연결 자체는 유지. */
export async function attachConsole(cdp) {
    try {
        const buffer = new ConsoleBuffer();
        await buffer.attach(cdp);
        state.console = buffer;
    }
    catch {
        state.console = null;
    }
}
async function autoDiscoverAndConnect() {
    const device = await pickDevice();
    const socket = await pickSocket(device.id);
    const port = await forwardPort(socket.socketName, device.id);
    const cdp = new CdpClient();
    await cdp.connect(port);
    state.cdp = cdp;
    state.deviceId = device.id;
    state.forwardedPort = port;
    state.socketName = socket.socketName;
    await attachConsole(cdp);
    return cdp;
}
export async function ensureConnected() {
    if (isConnected())
        return state.cdp;
    if (state.forwardedPort && state.socketName) {
        try {
            const cdp = new CdpClient();
            await cdp.connect(state.forwardedPort);
            state.cdp = cdp;
            await attachConsole(cdp);
            return cdp;
        }
        catch {
            // fall through to auto-discover
        }
    }
    return await autoDiscoverAndConnect();
}
//# sourceMappingURL=state.js.map