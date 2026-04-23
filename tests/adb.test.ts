import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getConnectedDevices, findWebViewSockets, forwardPort, removeForward } from '../src/adb.js';
import * as childProcess from 'child_process';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

const mockExecFile = vi.mocked(childProcess.execFile);

function setupExecFile(stdout: string, stderr = '') {
  mockExecFile.mockImplementation((_cmd, _args, callback: any) => {
    callback(null, stdout, stderr);
    return {} as any;
  });
}

function setupExecFileError(message: string) {
  mockExecFile.mockImplementation((_cmd, _args, callback: any) => {
    callback(new Error(message), '', '');
    return {} as any;
  });
}

describe('getConnectedDevices', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parses single connected device', async () => {
    setupExecFile('List of devices attached\nR5CT419BXHJ\tdevice\n\n');
    const devices = await getConnectedDevices();
    expect(devices).toEqual([{ id: 'R5CT419BXHJ', state: 'device' }]);
    expect(mockExecFile).toHaveBeenCalledWith('adb', ['devices'], expect.any(Function));
  });

  it('filters out offline devices', async () => {
    setupExecFile('List of devices attached\nR5CT419BXHJ\tdevice\nEMULATOR1\toffline\n\n');
    const devices = await getConnectedDevices();
    expect(devices).toEqual([{ id: 'R5CT419BXHJ', state: 'device' }]);
  });

  it('returns empty array when no devices', async () => {
    setupExecFile('List of devices attached\n\n');
    const devices = await getConnectedDevices();
    expect(devices).toEqual([]);
  });

  it('throws on adb error', async () => {
    setupExecFileError('adb not found');
    await expect(getConnectedDevices()).rejects.toThrow('adb not found');
  });
});

describe('findWebViewSockets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finds webview sockets from /proc/net/unix', async () => {
    const procOutput = [
      'Num       RefCount Protocol Flags    Type St Inode Path',
      '00000000: 00000002 00000000 00010000 0001 01 12345 @webview_devtools_remote_12345',
      '00000000: 00000002 00000000 00010000 0001 01 67890 /dev/socket/dnsproxyd',
      '00000000: 00000002 00000000 00010000 0001 01 11111 @webview_devtools_remote_67890',
    ].join('\n');
    setupExecFile(procOutput);

    const sockets = await findWebViewSockets();
    expect(sockets).toEqual([
      { pid: '12345', socketName: 'webview_devtools_remote_12345' },
      { pid: '67890', socketName: 'webview_devtools_remote_67890' },
    ]);
  });

  it('returns empty when no webview sockets', async () => {
    setupExecFile('Num RefCount Protocol\n00000000: 00000002 /dev/socket/dnsproxyd\n');
    const sockets = await findWebViewSockets();
    expect(sockets).toEqual([]);
  });

  it('passes deviceId to adb when provided', async () => {
    setupExecFile('');
    await findWebViewSockets('R5CT419BXHJ');
    expect(mockExecFile).toHaveBeenCalledWith(
      'adb',
      ['-s', 'R5CT419BXHJ', 'shell', 'cat', '/proc/net/unix'],
      expect.any(Function),
    );
  });
});

describe('forwardPort', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns allocated port number', async () => {
    setupExecFile('9222\n');
    const port = await forwardPort('webview_devtools_remote_12345');
    expect(port).toBe(9222);
    expect(mockExecFile).toHaveBeenCalledWith(
      'adb',
      ['forward', 'tcp:0', 'localabstract:webview_devtools_remote_12345'],
      expect.any(Function),
    );
  });

  it('passes deviceId when provided', async () => {
    setupExecFile('9333\n');
    const port = await forwardPort('webview_devtools_remote_12345', 'R5CT419BXHJ');
    expect(port).toBe(9333);
    expect(mockExecFile).toHaveBeenCalledWith(
      'adb',
      ['-s', 'R5CT419BXHJ', 'forward', 'tcp:0', 'localabstract:webview_devtools_remote_12345'],
      expect.any(Function),
    );
  });
});

describe('removeForward', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls adb forward --remove', async () => {
    setupExecFile('');
    await removeForward(9222);
    expect(mockExecFile).toHaveBeenCalledWith(
      'adb',
      ['forward', '--remove', 'tcp:9222'],
      expect.any(Function),
    );
  });
});
