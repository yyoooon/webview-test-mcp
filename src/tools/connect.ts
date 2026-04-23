import { getConnectedDevices, findWebViewSockets, forwardPort, removeForward } from '../adb.js';
import { CdpClient } from '../cdp.js';
import { state, resetState } from '../state.js';

export const definition = {
  name: 'webview_connect',
  description: 'Android WebView에 연결합니다. 기기를 자동 탐색하고 CDP로 연결합니다.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      socketIndex: {
        type: 'number',
        description: 'WebView가 여러 개일 때 연결할 소켓 인덱스 (0부터 시작)',
      },
    },
  },
};

interface ConnectArgs {
  socketIndex?: number;
}

export async function handler(args: ConnectArgs) {
  try {
    // Clean up previous connection
    if (state.cdp) {
      state.cdp.close();
    }
    if (state.forwardedPort) {
      await removeForward(state.forwardedPort).catch(() => {});
    }
    resetState();

    // 1. Find device
    const devices = await getConnectedDevices();
    if (devices.length === 0) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: '기기가 연결되어 있지 않습니다. adb devices를 확인하세요.' }],
      };
    }
    const device = devices[0];

    // 2. Find WebView sockets
    const sockets = await findWebViewSockets(device.id);
    if (sockets.length === 0) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: 'WebView를 찾을 수 없습니다. 앱이 실행 중인지 확인하세요.' }],
      };
    }

    // 3. If multiple sockets and no index specified, list them
    if (sockets.length > 1 && args.socketIndex === undefined) {
      const list = sockets.map((s, i) => `  [${i}] PID ${s.pid} — ${s.socketName}`).join('\n');
      return {
        content: [{
          type: 'text' as const,
          text: `WebView가 ${sockets.length}개 발견되었습니다. socketIndex를 지정해주세요:\n${list}`,
        }],
      };
    }

    const socketIdx = args.socketIndex ?? 0;
    const socket = sockets[socketIdx];
    if (!socket) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `유효하지 않은 socketIndex: ${socketIdx}. 범위: 0-${sockets.length - 1}` }],
      };
    }

    // 4. Forward port and connect CDP
    const port = await forwardPort(socket.socketName, device.id);
    const cdp = new CdpClient();
    await cdp.connect(port);

    // 5. Get current URL
    const evalResult = (await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href',
    })) as { result: { value: string } };
    const currentUrl = evalResult.result.value;

    // 6. Save state
    state.cdp = cdp;
    state.deviceId = device.id;
    state.forwardedPort = port;
    state.socketName = socket.socketName;

    return {
      content: [{
        type: 'text' as const,
        text: `연결 성공\n기기: ${device.id}\nPID: ${socket.pid}\nCDP 포트: ${port}\n현재 URL: ${currentUrl}`,
      }],
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `연결 실패: ${msg}` }],
    };
  }
}
