import { CdpClient } from "../cdp.js";
import { state, resetState } from "../state.js";
import { forwardPort, removeForward } from "../adb.js";
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
    },
  },
};

interface ConnectArgs {
  socketIndex?: number;
}

export async function handler(args: ConnectArgs) {
  try {
    if (state.cdp) state.cdp.close();
    if (state.forwardedPort)
      await removeForward(state.forwardedPort).catch(() => {});
    resetState();

    const device = await pickDevice();
    const socket = await pickSocket(device.id, args.socketIndex);
    const port = await forwardPort(socket.socketName, device.id);
    const cdp = new CdpClient();
    await cdp.connect(port);

    const evalResult = (await cdp.send("Runtime.evaluate", {
      expression: "window.location.href",
    })) as { result: { value: string } };

    state.cdp = cdp;
    state.deviceId = device.id;
    state.forwardedPort = port;
    state.socketName = socket.socketName;

    return {
      content: [
        {
          type: "text" as const,
          text: `연결 성공\n기기: ${device.id}\nPID: ${socket.pid}\nCDP 포트: ${port}\n현재 URL: ${evalResult.result.value}`,
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
