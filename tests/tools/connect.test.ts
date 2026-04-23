import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/tools/connect.js';
import * as adb from '../../src/adb.js';
import * as stateModule from '../../src/state.js';
import { CdpClient } from '../../src/cdp.js';

vi.mock('../../src/adb.js');
vi.mock('../../src/cdp.js', () => ({
  CdpClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue({ result: { value: 'http://localhost:3000/' } }),
    connected: true,
    close: vi.fn(),
  })),
}));

const mockAdb = vi.mocked(adb);

describe('webview_connect handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateModule.resetState();
  });

  it('connects successfully with single device and single webview', async () => {
    mockAdb.getConnectedDevices.mockResolvedValue([{ id: 'R5CT419BXHJ', state: 'device' }]);
    mockAdb.findWebViewSockets.mockResolvedValue([{ pid: '12345', socketName: 'webview_devtools_remote_12345' }]);
    mockAdb.forwardPort.mockResolvedValue(9222);

    const result = await handler({});
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('R5CT419BXHJ');
    expect(text).toContain('http://localhost:3000/');
    expect(stateModule.state.deviceId).toBe('R5CT419BXHJ');
    expect(stateModule.state.forwardedPort).toBe(9222);
  });

  it('returns error when no devices connected', async () => {
    mockAdb.getConnectedDevices.mockResolvedValue([]);
    const result = await handler({});
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('기기가 연결되어 있지 않습니다');
  });

  it('returns error when no webview sockets found', async () => {
    mockAdb.getConnectedDevices.mockResolvedValue([{ id: 'R5CT419BXHJ', state: 'device' }]);
    mockAdb.findWebViewSockets.mockResolvedValue([]);
    const result = await handler({});
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('WebView를 찾을 수 없습니다');
  });

  it('lists sockets when multiple found', async () => {
    mockAdb.getConnectedDevices.mockResolvedValue([{ id: 'R5CT419BXHJ', state: 'device' }]);
    mockAdb.findWebViewSockets.mockResolvedValue([
      { pid: '12345', socketName: 'webview_devtools_remote_12345' },
      { pid: '67890', socketName: 'webview_devtools_remote_67890' },
    ]);
    const result = await handler({});
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('12345');
    expect(text).toContain('67890');
  });

  it('connects to specific socket when socketIndex provided', async () => {
    mockAdb.getConnectedDevices.mockResolvedValue([{ id: 'R5CT419BXHJ', state: 'device' }]);
    mockAdb.findWebViewSockets.mockResolvedValue([
      { pid: '12345', socketName: 'webview_devtools_remote_12345' },
      { pid: '67890', socketName: 'webview_devtools_remote_67890' },
    ]);
    mockAdb.forwardPort.mockResolvedValue(9333);

    const result = await handler({ socketIndex: 1 });
    expect(result.isError).toBeUndefined();
    expect(mockAdb.forwardPort).toHaveBeenCalledWith('webview_devtools_remote_67890', 'R5CT419BXHJ');
  });
});
