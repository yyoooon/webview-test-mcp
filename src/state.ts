import { CdpClient } from './cdp.js';

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

export async function ensureConnected(): Promise<CdpClient> {
  if (isConnected()) return state.cdp!;

  // Auto-reconnect: if we had a previous connection, try once
  if (state.forwardedPort && state.socketName) {
    try {
      const cdp = new CdpClient();
      await cdp.connect(state.forwardedPort);
      state.cdp = cdp;
      return cdp;
    } catch {
      // Reconnect failed — fall through to error
    }
  }

  throw new Error('WebView에 연결되어 있지 않습니다. webview_connect를 먼저 호출하세요.');
}
