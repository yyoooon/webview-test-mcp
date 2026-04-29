import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/adb.js", () => ({
  getConnectedDevices: vi.fn(),
  findWebViewSockets: vi.fn(),
  forwardPort: vi.fn(),
  removeForward: vi.fn(),
}));

import * as adb from "../src/adb.js";
import { pickDevice, pickSocket } from "../src/discovery.js";
import { ErrorCode } from "../src/errors.js";

describe("pickDevice", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws NO_DEVICE when none connected", async () => {
    vi.mocked(adb.getConnectedDevices).mockResolvedValue([]);
    await expect(pickDevice()).rejects.toMatchObject({
      code: ErrorCode.NO_DEVICE,
    });
  });

  it("returns single device unchanged", async () => {
    vi.mocked(adb.getConnectedDevices).mockResolvedValue([
      { id: "XYZ123", state: "device" } as any,
    ]);
    const out = await pickDevice();
    expect(out.id).toBe("XYZ123");
  });

  it("prefers Wi-Fi device when multiple", async () => {
    vi.mocked(adb.getConnectedDevices).mockResolvedValue([
      { id: "XYZ123", state: "device" } as any,
      { id: "192.168.1.5:5555", state: "device" } as any,
    ]);
    const out = await pickDevice();
    expect(out.id).toBe("192.168.1.5:5555");
  });

  it("throws MULTIPLE_DEVICES when no Wi-Fi available", async () => {
    vi.mocked(adb.getConnectedDevices).mockResolvedValue([
      { id: "XYZ123", state: "device" } as any,
      { id: "ABC456", state: "device" } as any,
    ]);
    await expect(pickDevice()).rejects.toMatchObject({
      code: ErrorCode.MULTIPLE_DEVICES,
    });
  });
});

describe("pickSocket", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws NO_WEBVIEW when none", async () => {
    vi.mocked(adb.findWebViewSockets).mockResolvedValue([]);
    await expect(pickSocket("XYZ")).rejects.toMatchObject({
      code: ErrorCode.NO_WEBVIEW,
    });
  });

  it("returns single socket unchanged", async () => {
    vi.mocked(adb.findWebViewSockets).mockResolvedValue([
      { pid: 1234, socketName: "webview_devtools_remote_1234" } as any,
    ]);
    const out = await pickSocket("XYZ");
    expect(out.pid).toBe(1234);
  });

  it("throws MULTIPLE_WEBVIEWS when multiple and no index", async () => {
    vi.mocked(adb.findWebViewSockets).mockResolvedValue([
      { pid: 1, socketName: "a" } as any,
      { pid: 2, socketName: "b" } as any,
    ]);
    await expect(pickSocket("XYZ")).rejects.toMatchObject({
      code: ErrorCode.MULTIPLE_WEBVIEWS,
    });
  });

  it("returns indexed socket when explicitly chosen", async () => {
    vi.mocked(adb.findWebViewSockets).mockResolvedValue([
      { pid: 1, socketName: "a" } as any,
      { pid: 2, socketName: "b" } as any,
    ]);
    const out = await pickSocket("XYZ", 1);
    expect(out.pid).toBe(2);
  });
});
