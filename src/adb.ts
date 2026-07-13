import { execFile as execFileCb } from 'child_process';

export interface AdbDevice {
  id: string;
  state: string;
}

export interface WebViewSocket {
  pid: string;
  socketName: string;
}

function execFile(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFileCb(cmd, args, (error, stdout, _stderr) => {
      if (error) return reject(error);
      resolve(stdout);
    });
  });
}

export async function getConnectedDevices(): Promise<AdbDevice[]> {
  const stdout = await execFile('adb', ['devices']);
  return stdout
    .split('\n')
    .slice(1)
    .filter((line) => line.includes('\t'))
    .map((line) => {
      const [id, state] = line.split('\t');
      return { id: id.trim(), state: state.trim() };
    })
    .filter((d) => d.state === 'device');
}

export async function findWebViewSockets(deviceId?: string): Promise<WebViewSocket[]> {
  const args = deviceId
    ? ['-s', deviceId, 'shell', 'cat', '/proc/net/unix']
    : ['shell', 'cat', '/proc/net/unix'];
  const stdout = await execFile('adb', args);
  const results: WebViewSocket[] = [];
  for (const line of stdout.split('\n')) {
    const match = line.match(/webview_devtools_remote_(\d+)/);
    if (match) {
      results.push({ pid: match[1], socketName: `webview_devtools_remote_${match[1]}` });
    }
  }
  return results;
}

export async function forwardPort(socketName: string, deviceId?: string): Promise<number> {
  const args = deviceId
    ? ['-s', deviceId, 'forward', 'tcp:0', `localabstract:${socketName}`]
    : ['forward', 'tcp:0', `localabstract:${socketName}`];
  const stdout = await execFile('adb', args);
  return parseInt(stdout.trim(), 10);
}

export async function removeForward(port: number): Promise<void> {
  await execFile('adb', ['forward', '--remove', `tcp:${port}`]);
}

export async function inputTap(x: number, y: number, deviceId?: string): Promise<void> {
  const ix = Math.round(x).toString();
  const iy = Math.round(y).toString();
  const args = deviceId
    ? ['-s', deviceId, 'shell', 'input', 'tap', ix, iy]
    : ['shell', 'input', 'tap', ix, iy];
  await execFile('adb', args);
}

export async function inputSwipe(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs: number,
  deviceId?: string,
): Promise<void> {
  const coords = [x1, y1, x2, y2].map((v) => Math.round(v).toString());
  const swipeArgs = ['shell', 'input', 'swipe', ...coords, Math.round(durationMs).toString()];
  const args = deviceId ? ['-s', deviceId, ...swipeArgs] : swipeArgs;
  await execFile('adb', args);
}

export async function inputKeyEvent(key: string, deviceId?: string): Promise<void> {
  const upper = key.toUpperCase();
  const keycode = upper.startsWith('KEYCODE_') ? upper : `KEYCODE_${upper}`;
  if (!/^KEYCODE_[A-Z0-9_]+$/.test(keycode)) {
    throw new Error(`유효하지 않은 keycode: ${key}`);
  }
  const keyArgs = ['shell', 'input', 'keyevent', keycode];
  const args = deviceId ? ['-s', deviceId, ...keyArgs] : keyArgs;
  await execFile('adb', args);
}

export async function getProcessName(pid: string, deviceId?: string): Promise<string | null> {
  const catArgs = ['shell', 'cat', `/proc/${pid}/cmdline`];
  const args = deviceId ? ['-s', deviceId, ...catArgs] : catArgs;
  try {
    const stdout = await execFile('adb', args);
    const name = stdout.split('\0')[0].trim();
    return name || null;
  } catch {
    return null;
  }
}
