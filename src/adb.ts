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
