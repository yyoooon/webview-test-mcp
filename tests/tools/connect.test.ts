import { describe, it, expect, vi, beforeEach } from "vitest";
import { handler } from "../../src/tools/connect.js";
import * as adb from "../../src/adb.js";
import * as discovery from "../../src/discovery.js";
import * as stateModule from "../../src/state.js";
import { CdpClient } from "../../src/cdp.js";

const cdpMock = vi.hoisted(() => ({
  pageUrl: "http://localhost:3000/" as string | null,
  href: "http://localhost:3000/",
}));

vi.mock("../../src/adb.js");
vi.mock("../../src/discovery.js", { spy: true });
vi.mock("../../src/cdp.js", () => ({
  CdpClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    send: vi
      .fn()
      .mockImplementation(() => Promise.resolve({ result: { value: cdpMock.href } })),
    pageUrl: cdpMock.pageUrl,
    connected: true,
    close: vi.fn(),
  })),
}));

const mockAdb = vi.mocked(adb);

describe("webview_connect handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateModule.resetState();
    cdpMock.pageUrl = "http://localhost:3000/";
    cdpMock.href = "http://localhost:3000/";
  });

  it("connects successfully with single device and single webview", async () => {
    mockAdb.getConnectedDevices.mockResolvedValue([
      { id: "R5CT419BXHJ", state: "device" },
    ]);
    mockAdb.findWebViewSockets.mockResolvedValue([
      { pid: "12345", socketName: "webview_devtools_remote_12345" },
    ]);
    mockAdb.forwardPort.mockResolvedValue(9222);

    const result = await handler({});
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("R5CT419BXHJ");
    expect(text).toContain("http://localhost:3000/");
    expect(stateModule.state.deviceId).toBe("R5CT419BXHJ");
    expect(stateModule.state.forwardedPort).toBe(9222);
  });

  it("returns error when no devices connected", async () => {
    mockAdb.getConnectedDevices.mockResolvedValue([]);
    const result = await handler({});
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("NO_DEVICE");
  });

  it("returns error when no webview sockets found", async () => {
    mockAdb.getConnectedDevices.mockResolvedValue([
      { id: "R5CT419BXHJ", state: "device" },
    ]);
    mockAdb.findWebViewSockets.mockResolvedValue([]);
    const result = await handler({});
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("NO_WEBVIEW");
  });

  it("auto-connects to first socket when multiple found and no socketIndex", async () => {
    mockAdb.getConnectedDevices.mockResolvedValue([
      { id: "R5CT419BXHJ", state: "device" },
    ]);
    mockAdb.findWebViewSockets.mockResolvedValue([
      { pid: "12345", socketName: "webview_devtools_remote_12345" },
      { pid: "67890", socketName: "webview_devtools_remote_67890" },
    ]);
    mockAdb.forwardPort.mockResolvedValue(9222);

    const result = await handler({});
    expect(result.isError).toBeUndefined();
    expect(mockAdb.forwardPort).toHaveBeenCalledWith(
      "webview_devtools_remote_12345",
      "R5CT419BXHJ",
    );
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("12345");
  });

  it("connects to specific socket when socketIndex provided", async () => {
    mockAdb.getConnectedDevices.mockResolvedValue([
      { id: "R5CT419BXHJ", state: "device" },
    ]);
    mockAdb.findWebViewSockets.mockResolvedValue([
      { pid: "12345", socketName: "webview_devtools_remote_12345" },
      { pid: "67890", socketName: "webview_devtools_remote_67890" },
    ]);
    mockAdb.forwardPort.mockResolvedValue(9333);

    const result = await handler({ socketIndex: 1 });
    expect(result.isError).toBeUndefined();
    expect(mockAdb.forwardPort).toHaveBeenCalledWith(
      "webview_devtools_remote_67890",
      "R5CT419BXHJ",
    );
  });

  it("forwards app param to pickSocket", async () => {
    mockAdb.getConnectedDevices.mockResolvedValue([
      { id: "R5CT419BXHJ", state: "device" },
    ]);
    mockAdb.findWebViewSockets.mockResolvedValue([
      { pid: "12345", socketName: "webview_devtools_remote_12345" },
      { pid: "67890", socketName: "webview_devtools_remote_67890" },
    ]);
    mockAdb.getProcessName.mockImplementation(async (pid) =>
      pid === "12345" ? "com.other.app" : "com.huray.healthapp",
    );
    mockAdb.forwardPort.mockResolvedValue(9222);

    const result = await handler({ app: "huray" });
    expect(result.isError).toBeUndefined();
    expect(vi.mocked(discovery.pickSocket)).toHaveBeenCalledWith(
      "R5CT419BXHJ",
      undefined,
      "huray",
    );
    expect(mockAdb.forwardPort).toHaveBeenCalledWith(
      "webview_devtools_remote_67890",
      "R5CT419BXHJ",
    );
  });

  it("reports committed page URL from CDP target, not just location.href", async () => {
    mockAdb.getConnectedDevices.mockResolvedValue([
      { id: "R5CT419BXHJ", state: "device" },
    ]);
    mockAdb.findWebViewSockets.mockResolvedValue([
      { pid: "12345", socketName: "webview_devtools_remote_12345" },
    ]);
    mockAdb.forwardPort.mockResolvedValue(9222);
    cdpMock.pageUrl = "https://nest.huraydev.net/home";
    cdpMock.href = "https://nest.huraydev.net/home";

    const result = await handler({});
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("현재 URL: https://nest.huraydev.net/home");
    expect(text).not.toContain("⚠️");
  });

  it("warns when webview is on a chrome-error page (committed URL != location.href)", async () => {
    mockAdb.getConnectedDevices.mockResolvedValue([
      { id: "R5CT419BXHJ", state: "device" },
    ]);
    mockAdb.findWebViewSockets.mockResolvedValue([
      { pid: "12345", socketName: "webview_devtools_remote_12345" },
    ]);
    mockAdb.forwardPort.mockResolvedValue(9222);
    // committed URL is the error page; location.href still returns the intended URL
    cdpMock.pageUrl = "chrome-error://chromewebdata/";
    cdpMock.href = "https://nest.huraydev.net/home";

    const result = await handler({});
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("현재 URL: chrome-error://chromewebdata/");
    expect(text).toContain("⚠️");
    expect(text).toContain("에러 페이지");
    // surfaces the intended URL so the user knows what failed to load
    expect(text).toContain("https://nest.huraydev.net/home");
  });

  it("shows app name next to PID in success text", async () => {
    mockAdb.getConnectedDevices.mockResolvedValue([
      { id: "R5CT419BXHJ", state: "device" },
    ]);
    mockAdb.findWebViewSockets.mockResolvedValue([
      { pid: "12345", socketName: "webview_devtools_remote_12345" },
    ]);
    mockAdb.getProcessName.mockResolvedValue("com.huray.healthapp");
    mockAdb.forwardPort.mockResolvedValue(9222);

    const result = await handler({});
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("PID: 12345 (com.huray.healthapp)");
  });
});
