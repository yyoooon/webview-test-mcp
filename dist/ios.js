import { execFileSync, spawn } from 'child_process';
import { createConnection } from 'net';
import { ErrorCode, FlowError } from './errors.js';
const PROXY_BIN = 'ios_webkit_debug_proxy';
let proxy = null;
export function hasIosTooling() {
    try {
        execFileSync('which', [PROXY_BIN], { stdio: 'ignore' });
        execFileSync('which', ['idevice_id'], { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
export function listIosDevices() {
    try {
        return execFileSync('idevice_id', ['-l'], { encoding: 'utf8' })
            .split('\n').map((s) => s.trim()).filter(Boolean);
    }
    catch {
        return [];
    }
}
export function parseDeviceList(json) {
    const arr = Array.isArray(json) ? json : [];
    return arr.map((d) => ({
        deviceId: d.deviceId,
        port: parseInt(d.url.split(':')[1], 10),
    }));
}
function portFree(port) {
    return new Promise((resolve) => {
        const sock = createConnection({ port, host: '127.0.0.1' });
        sock.on('connect', () => { sock.destroy(); resolve(false); });
        sock.on('error', () => resolve(true));
    });
}
async function pickFrontPort() {
    for (let p = 9330; p < 9400; p += 12) {
        if (await portFree(p))
            return p;
    }
    throw new FlowError(ErrorCode.CDP_FAILED, 'iOS proxy용 자유 포트를 찾지 못했습니다.');
}
async function waitForJson(frontPort, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`http://127.0.0.1:${frontPort}/json`);
            if (res.ok)
                return;
        }
        catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new FlowError(ErrorCode.CDP_FAILED, 'ios-webkit-debug-proxy 응답 없음.');
}
export async function ensureProxy() {
    if (proxy && proxy.child.exitCode === null)
        return proxy.frontPort;
    if (!hasIosTooling())
        throw new FlowError(ErrorCode.IOS_TOOLING_MISSING);
    const frontPort = await pickFrontPort();
    const child = spawn(PROXY_BIN, ['-c', `null:${frontPort},:${frontPort + 1}-${frontPort + 10}`], {
        stdio: 'ignore',
    });
    proxy = { child, frontPort };
    await waitForJson(frontPort);
    return frontPort;
}
export function stopProxy() {
    if (proxy) {
        proxy.child.kill();
        proxy = null;
    }
}
export async function getDevicePort(frontPort) {
    const res = await fetch(`http://127.0.0.1:${frontPort}/json`);
    const devices = parseDeviceList(await res.json());
    if (devices.length === 0)
        throw new FlowError(ErrorCode.NO_DEVICE);
    return devices[0].port;
}
export async function listPages(devicePort) {
    const res = await fetch(`http://127.0.0.1:${devicePort}/json`);
    const pages = (await res.json());
    if (!pages || pages.length === 0)
        throw new FlowError(ErrorCode.NO_WEBVIEW);
    return pages;
}
/** proxy 갓 spawn 시 기기 인스펙터가 cold라 첫 listPages가 빈 목록일 수 있음 → 페이지 열거까지 폴링. */
export async function discoverIosPages(frontPort, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            const devicePort = await getDevicePort(frontPort);
            const pages = await listPages(devicePort);
            return { devicePort, pages };
        }
        catch (e) {
            if (Date.now() >= deadline)
                throw e;
        }
        await new Promise((r) => setTimeout(r, 200));
    }
}
//# sourceMappingURL=ios.js.map