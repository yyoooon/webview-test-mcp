import { CdpClient } from "../cdp.js";
import { state, resetState, attachConsole, connectIos } from "../state.js";
import { forwardPort, removeForward, getProcessName } from "../adb.js";
import { pickDevice, pickSocket } from "../discovery.js";
import { FlowError } from "../errors.js";
import { detectPlatform } from "../platform.js";
export const definition = {
    name: "webview_connect",
    description: "Android WebView에 연결합니다. 기기를 자동 탐색하고 CDP로 연결합니다.",
    inputSchema: {
        type: "object",
        properties: {
            socketIndex: {
                type: "number",
                description: "WebView가 여러 개일 때 연결할 소켓 인덱스 (0부터 시작)",
            },
            app: {
                type: "string",
                description: '패키지명(부분 일치)으로 WebView 선택. 예: "com.huray" 또는 "huray". socketIndex보다 우선.',
            },
            platform: {
                type: "string",
                enum: ["android", "ios"],
                description: "연결 대상 플랫폼. 생략 시 자동감지(둘 다 연결 시 지정 필요).",
            },
        },
    },
};
export async function handler(args) {
    try {
        if (state.cdp)
            state.cdp.close();
        if (state.forwardedPort)
            await removeForward(state.forwardedPort).catch(() => { });
        resetState();
        const platform = args.platform ?? (await detectPlatform());
        if (platform === "ios") {
            const select = { index: args.socketIndex, urlMatch: args.app };
            const { cdp, devicePort, pageUrl } = await connectIos(select);
            const href = (await cdp.send("Runtime.evaluate", {
                expression: "window.location.href",
                returnByValue: true,
            })).result.value;
            const committed = pageUrl ?? href;
            state.cdp = cdp;
            state.platform = "ios";
            state.iosDevicePort = devicePort;
            state.iosSelect = select;
            await attachConsole(cdp);
            return {
                content: [
                    {
                        type: "text",
                        text: `연결 성공 (iOS)\nCDP 포트: ${devicePort}\n현재 URL: ${committed}`,
                    },
                ],
            };
        }
        const device = await pickDevice();
        const socket = await pickSocket(device.id, args.socketIndex, args.app);
        const port = await forwardPort(socket.socketName, device.id);
        const cdp = new CdpClient();
        await cdp.connect(port);
        const evalResult = (await cdp.send("Runtime.evaluate", {
            expression: "window.location.href",
        }));
        const href = evalResult.result.value;
        // /json 타겟이 보고하는 committed URL이 ground truth. 에러 페이지면 location.href는 의도한 URL을 반환하지만 pageUrl은 chrome-error://를 노출.
        const committed = cdp.pageUrl ?? href;
        const isErrorPage = committed.startsWith("chrome-error://");
        const appName = await getProcessName(socket.pid, device.id);
        state.cdp = cdp;
        state.deviceId = device.id;
        state.forwardedPort = port;
        state.socketName = socket.socketName;
        state.platform = "android";
        await attachConsole(cdp);
        const warning = isErrorPage
            ? `\n⚠️ 웹뷰가 에러 페이지 상태입니다 (로드 실패). location.href(의도한 URL): ${href}. 앱을 다시 로드한 뒤 재연결하세요 — 이 상태로는 fetch/세션이 전부 실패합니다.`
            : "";
        return {
            content: [
                {
                    type: "text",
                    text: `연결 성공\n기기: ${device.id}\nPID: ${socket.pid}${appName ? ` (${appName})` : ""}\nCDP 포트: ${port}\n현재 URL: ${committed}${warning}`,
                },
            ],
        };
    }
    catch (error) {
        if (error instanceof FlowError) {
            const extras = error.extras
                ? `\n${JSON.stringify(error.extras, null, 2)}`
                : "";
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `[${error.code}] ${error.message}${extras}`,
                    },
                ],
            };
        }
        const msg = error instanceof Error ? error.message : String(error);
        return {
            isError: true,
            content: [{ type: "text", text: `연결 실패: ${msg}` }],
        };
    }
}
//# sourceMappingURL=connect.js.map