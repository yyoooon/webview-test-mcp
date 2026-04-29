import { getConnectedDevices, findWebViewSockets } from "./adb.js";
import { ErrorCode, FlowError } from "./errors.js";

interface Device {
  id: string;
  state: string;
}

interface Socket {
  pid: number;
  socketName: string;
}

const isWifiDevice = (id: string) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(id);

export async function pickDevice(): Promise<Device> {
  const devices = (await getConnectedDevices()) as Device[];
  if (devices.length === 0) {
    throw new FlowError(ErrorCode.NO_DEVICE);
  }
  if (devices.length === 1) return devices[0];
  const wifi = devices.find((d) => isWifiDevice(d.id));
  if (wifi) return wifi;
  throw new FlowError(ErrorCode.MULTIPLE_DEVICES, undefined, {
    devices: devices.map((d) => d.id),
  });
}

export async function pickSocket(
  deviceId: string,
  index?: number,
): Promise<Socket> {
  const sockets = (await findWebViewSockets(deviceId)) as Socket[];
  if (sockets.length === 0) {
    throw new FlowError(ErrorCode.NO_WEBVIEW);
  }
  if (sockets.length === 1) return sockets[0];
  if (index !== undefined) {
    const s = sockets[index];
    if (!s) {
      throw new FlowError(
        ErrorCode.MULTIPLE_WEBVIEWS,
        `socketIndex ${index} 범위 밖. 0-${sockets.length - 1}`,
        {
          sockets: sockets.map((s, i) => ({
            index: i,
            pid: s.pid,
            socketName: s.socketName,
          })),
        },
      );
    }
    return s;
  }
  throw new FlowError(ErrorCode.MULTIPLE_WEBVIEWS, undefined, {
    sockets: sockets.map((s, i) => ({
      index: i,
      pid: s.pid,
      socketName: s.socketName,
    })),
  });
}
