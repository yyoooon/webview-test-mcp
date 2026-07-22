import { execFileSync, spawn, ChildProcess } from 'child_process';
import { createConnection } from 'net';
import { ErrorCode, FlowError } from './errors.js';

export interface IosPage { url: string; webSocketDebuggerUrl: string; appId?: string; }

const PROXY_BIN = 'ios_webkit_debug_proxy';
let proxy: { child: ChildProcess; frontPort: number } | null = null;

export function hasIosTooling(): boolean {
  try {
    execFileSync('which', [PROXY_BIN], { stdio: 'ignore' });
    execFileSync('which', ['idevice_id'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

export function listIosDevices(): string[] {
  try {
    return execFileSync('idevice_id', ['-l'], { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

export function parseDeviceList(json: unknown): { deviceId: string; port: number }[] {
  const arr = Array.isArray(json) ? json : [];
  return arr.map((d: { deviceId: string; url: string }) => ({
    deviceId: d.deviceId,
    port: parseInt(d.url.split(':')[1], 10),
  }));
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: '127.0.0.1' });
    sock.on('connect', () => { sock.destroy(); resolve(false); });
    sock.on('error', () => resolve(true));
  });
}

async function pickFrontPort(): Promise<number> {
  for (let p = 9330; p < 9400; p += 12) {
    if (await portFree(p)) return p;
  }
  throw new FlowError(ErrorCode.CDP_FAILED, 'iOS proxy용 자유 포트를 찾지 못했습니다.');
}

async function waitForJson(frontPort: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${frontPort}/json`);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new FlowError(ErrorCode.CDP_FAILED, 'ios-webkit-debug-proxy 응답 없음.');
}

export async function ensureProxy(): Promise<number> {
  if (proxy && proxy.child.exitCode === null) return proxy.frontPort;
  if (!hasIosTooling()) throw new FlowError(ErrorCode.IOS_TOOLING_MISSING);
  const frontPort = await pickFrontPort();
  const child = spawn(PROXY_BIN, ['-c', `null:${frontPort},:${frontPort + 1}-${frontPort + 10}`], {
    stdio: 'ignore',
  });
  proxy = { child, frontPort };
  await waitForJson(frontPort);
  return frontPort;
}

export function stopProxy(): void {
  if (proxy) { proxy.child.kill(); proxy = null; }
}

export async function getDevicePort(frontPort: number): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${frontPort}/json`);
  const devices = parseDeviceList(await res.json());
  if (devices.length === 0) throw new FlowError(ErrorCode.NO_DEVICE);
  return devices[0].port;
}

export async function listPages(devicePort: number): Promise<IosPage[]> {
  const res = await fetch(`http://127.0.0.1:${devicePort}/json`);
  const pages = (await res.json()) as IosPage[];
  if (!pages || pages.length === 0) throw new FlowError(ErrorCode.NO_WEBVIEW);
  return pages;
}

/** proxy 갓 spawn 시 기기 인스펙터가 cold라 첫 listPages가 빈 목록일 수 있음 → 페이지 열거까지 폴링. */
export async function discoverIosPages(
  frontPort: number,
  timeoutMs = 8000,
): Promise<{ devicePort: number; pages: IosPage[] }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const devicePort = await getDevicePort(frontPort);
      const pages = await listPages(devicePort);
      return { devicePort, pages };
    } catch (e) {
      if (Date.now() >= deadline) throw e;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}
