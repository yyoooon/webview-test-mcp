import { CdpClient } from './cdp.js';
import { pickDevice, pickSocket } from './discovery.js';
import { forwardPort } from './adb.js';

export interface ConnectionState {
  cdp: CdpClient | null;
  deviceId: string | null;
  forwardedPort: number | null;
  socketName: string | null;
}

export const state: ConnectionState = {
  cdp: null,
  deviceId: null,
  forwardedPort: null,
  socketName: null,
};

export function resetState(): void {
  state.cdp = null;
  state.deviceId = null;
  state.forwardedPort = null;
  state.socketName = null;
}

export function isConnected(): boolean {
  return state.cdp !== null && state.cdp.connected;
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
  return cdp;
}

export async function ensureConnected(): Promise<CdpClient> {
  if (isConnected()) return state.cdp!;

  if (state.forwardedPort && state.socketName) {
    try {
      const cdp = new CdpClient();
      await cdp.connect(state.forwardedPort);
      state.cdp = cdp;
      return cdp;
    } catch {
      // fall through to auto-discover
    }
  }

  return await autoDiscoverAndConnect();
}
