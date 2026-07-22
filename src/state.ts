import { CdpClient } from './cdp.js';
import { ConsoleBuffer } from './console-log.js';
import { pickDevice, pickSocket } from './discovery.js';
import { forwardPort } from './adb.js';
import { IosTargetTransport } from './transport.js';
import { ensureProxy, discoverIosPages, stopProxy } from './ios.js';

export interface ConnectionState {
  cdp: CdpClient | null;
  deviceId: string | null;
  forwardedPort: number | null;
  socketName: string | null;
  console: ConsoleBuffer | null;
  platform: 'android' | 'ios' | null;
  iosDevicePort: number | null;
  iosSelect: { index?: number; urlMatch?: string } | null;
}

export const state: ConnectionState = {
  cdp: null,
  deviceId: null,
  forwardedPort: null,
  socketName: null,
  console: null,
  platform: null,
  iosDevicePort: null,
  iosSelect: null,
};

export function resetState(): void {
  if (state.platform === 'ios') stopProxy();
  state.cdp = null;
  state.deviceId = null;
  state.forwardedPort = null;
  state.socketName = null;
  state.console = null;
  state.platform = null;
  state.iosDevicePort = null;
  state.iosSelect = null;
}

export function isConnected(): boolean {
  return state.cdp !== null && state.cdp.connected;
}

/** 콘솔 수집은 비필수 — 실패해도 연결 자체는 유지. */
export async function attachConsole(cdp: CdpClient): Promise<void> {
  try {
    const buffer = new ConsoleBuffer();
    await buffer.attach(cdp, state.platform);
    state.console = buffer;
  } catch {
    state.console = null;
  }
}

async function autoDiscoverAndConnect(): Promise<CdpClient> {
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

/** iOS 연결: 프록시 기동 → device port 조회·페이지 열거까지 폴링(콜드스타트 레이스 방어) → CdpClient 연결. */
export async function connectIos(
  select: { index?: number; urlMatch?: string },
): Promise<{ cdp: CdpClient; devicePort: number; pageUrl: string | null }> {
  const frontPort = await ensureProxy();
  const { devicePort } = await discoverIosPages(frontPort);
  const opts: { index?: number; urlMatch?: string } = {};
  if (select.urlMatch) opts.urlMatch = select.urlMatch;
  else if (select.index !== undefined) opts.index = select.index;
  const cdp = new CdpClient((wsUrl) => new IosTargetTransport(wsUrl));
  await cdp.connect(devicePort, opts);
  return { cdp, devicePort, pageUrl: cdp.pageUrl };
}

export async function ensureConnected(): Promise<CdpClient> {
  if (isConnected()) return state.cdp!;

  if (state.platform === 'ios' && state.iosSelect) {
    const { cdp, devicePort } = await connectIos(state.iosSelect);
    state.cdp = cdp;
    state.iosDevicePort = devicePort;
    await attachConsole(cdp);
    return cdp;
  }

  if (state.forwardedPort && state.socketName) {
    try {
      const cdp = new CdpClient();
      await cdp.connect(state.forwardedPort);
      state.cdp = cdp;
      await attachConsole(cdp);
      return cdp;
    } catch {
      // fall through to auto-discover
    }
  }

  return await autoDiscoverAndConnect();
}
