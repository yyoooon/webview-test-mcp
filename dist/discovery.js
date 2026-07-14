import { getConnectedDevices, findWebViewSockets, getProcessName } from "./adb.js";
import { ErrorCode, FlowError } from "./errors.js";
const isWifiDevice = (id) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(id);
export async function pickDevice() {
    const devices = (await getConnectedDevices());
    if (devices.length === 0) {
        throw new FlowError(ErrorCode.NO_DEVICE);
    }
    if (devices.length === 1)
        return devices[0];
    const wifi = devices.find((d) => isWifiDevice(d.id));
    if (wifi)
        return wifi;
    throw new FlowError(ErrorCode.MULTIPLE_DEVICES, undefined, {
        devices: devices.map((d) => d.id),
    });
}
export async function pickSocket(deviceId, index, app) {
    const sockets = (await findWebViewSockets(deviceId));
    if (sockets.length === 0) {
        throw new FlowError(ErrorCode.NO_WEBVIEW);
    }
    if (app !== undefined) {
        const names = await Promise.all(sockets.map((s) => getProcessName(s.pid, deviceId)));
        const matchedIdx = names.findIndex((n) => n?.includes(app));
        if (matchedIdx === -1) {
            throw new FlowError(ErrorCode.NO_WEBVIEW, `앱 "${app}"에 해당하는 WebView가 없습니다.`, {
                sockets: sockets.map((s, i) => ({ index: i, pid: s.pid, app: names[i] })),
            });
        }
        return sockets[matchedIdx];
    }
    if (sockets.length === 1)
        return sockets[0];
    if (index !== undefined) {
        const s = sockets[index];
        if (!s) {
            throw new FlowError(ErrorCode.MULTIPLE_WEBVIEWS, `socketIndex ${index} 범위 밖. 0-${sockets.length - 1}`, {
                sockets: sockets.map((s, i) => ({
                    index: i,
                    pid: s.pid,
                    socketName: s.socketName,
                })),
            });
        }
        return s;
    }
    // Multiple sockets but no explicit index: default to 0.
    // 대부분 첫 socket이 메인 WebView. 다른 걸 원하면 socketIndex로 명시.
    return sockets[0];
}
//# sourceMappingURL=discovery.js.map