import { CdpClient } from "../cdp.js";
import { state, resetState, attachConsole } from "../state.js";
import { forwardPort, removeForward, getProcessName } from "../adb.js";
import { pickDevice, pickSocket } from "../discovery.js";
import { FlowError } from "../errors.js";

export const definition = {
  name: "webview_connect",
  description:
    "Android WebView에 연결합니다. 기기를 자동 탐색하고 CDP로 연결합니다.",
  inputSchema: {
    type: "object" as const,
    properties: {
      socketIndex: {
        type: "number",
        description: "WebView가 여러 개일 때 연결할 소켓 인덱스 (0부터 시작)",
      },
      app: {
        type: "string",
        description:
          '패키지명(부분 일치)으로 WebView 선택. 예: "com.huray" 또는 "huray". socketIndex보다 우선.',
      },
    },
  },
};

interface ConnectArgs {
  socketIndex?: number;
  app?: string;
}

export async function handler(args: ConnectArgs) {
  try {
    if (state.cdp) state.cdp.close();
    if (state.forwardedPort)
      await removeForward(state.forwardedPort).catch(() => {});
    resetState();

    const device = await pickDevice();
    const socket = await pickSocket(device.id, args.socketIndex, args.app);
    const port = await forwardPort(socket.socketName, device.id);
    const cdp = new CdpClient();
    await cdp.connect(port);

    const evalResult = (await cdp.send("Runtime.evaluate", {
      expression: "window.location.href",
    })) as { result: { value: string } };

    const appName = await getProcessName(socket.pid, device.id);

    state.cdp = cdp;
    state.deviceId = device.id;
    state.forwardedPort = port;
    state.socketName = socket.socketName;
    await attachConsole(cdp);

    return {
      content: [
        {
          type: "text" as const,
          text: `연결 성공\n기기: ${device.id}\nPID: ${socket.pid}${appName ? ` (${appName})` : ""}\nCDP 포트: ${port}\n현재 URL: ${evalResult.result.value}`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof FlowError) {
      const extras = error.extras
        ? `\n${JSON.stringify(error.extras, null, 2)}`
        : "";
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `[${error.code}] ${error.message}${extras}`,
          },
        ],
      };
    }
    const msg = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: "text" as const, text: `연결 실패: ${msg}` }],
    };
  }
}
