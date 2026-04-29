import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import { handler, resolveScriptPath } from '../../src/tools/run-script.js';
import * as stateModule from '../../src/state.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';

describe('resolveScriptPath', () => {
  it('resolves to .webview-scripts/{name}.webview.js under cwd', () => {
    const p = resolveScriptPath('skip-to-home', '/repo');
    expect(p).toBe(path.join('/repo', '.webview-scripts', 'skip-to-home.webview.js'));
  });

  it('rejects names containing path separators', () => {
    expect(() => resolveScriptPath('foo/bar', '/repo')).toThrow();
    expect(() => resolveScriptPath('../etc/passwd', '/repo')).toThrow();
    expect(() => resolveScriptPath('a\\b', '/repo')).toThrow();
  });

  it('rejects empty or whitespace names', () => {
    expect(() => resolveScriptPath('', '/repo')).toThrow();
    expect(() => resolveScriptPath('   ', '/repo')).toThrow();
  });

  it('rejects names with leading dot', () => {
    expect(() => resolveScriptPath('.hidden', '/repo')).toThrow();
  });

  it('accepts alphanumeric, dash, underscore', () => {
    expect(() => resolveScriptPath('skip-to-home', '/repo')).not.toThrow();
    expect(() => resolveScriptPath('foo_bar2', '/repo')).not.toThrow();
  });
});

describe('webview_run_script handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateModule.resetState();
  });

  it('reads script and forwards content to Runtime.evaluate', async () => {
    vi.mocked(readFile).mockResolvedValue('(async()=>42)()');
    const send = vi.fn().mockResolvedValue({ result: { type: 'number', value: 42 } });
    stateModule.state.cdp = { connected: true, send } as any;

    const result = await handler({ name: 'skip-to-home' });

    expect(readFile).toHaveBeenCalledWith(
      expect.stringContaining(path.join('.webview-scripts', 'skip-to-home.webview.js')),
      'utf8',
    );
    expect(send).toHaveBeenCalledWith(
      'Runtime.evaluate',
      expect.objectContaining({
        expression: '(async()=>42)()',
        awaitPromise: true,
        returnByValue: true,
      }),
    );
    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toContain('42');
  });

  it('returns error when name is invalid', async () => {
    stateModule.state.cdp = { connected: true, send: vi.fn() } as any;
    const result = await handler({ name: '../etc/passwd' });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/이름|name/i);
  });

  it('returns error when file not found', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    vi.mocked(readFile).mockRejectedValue(err);
    stateModule.state.cdp = { connected: true, send: vi.fn() } as any;

    const result = await handler({ name: 'missing-script' });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/찾을 수 없|not found|missing-script/);
  });

  it('returns exception details on JS error', async () => {
    vi.mocked(readFile).mockResolvedValue('foo()');
    const send = vi.fn().mockResolvedValue({
      exceptionDetails: { exception: { description: 'ReferenceError: foo is not defined' } },
    });
    stateModule.state.cdp = { connected: true, send } as any;

    const result = await handler({ name: 'broken' });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('ReferenceError');
  });

  it('returns object value as JSON', async () => {
    vi.mocked(readFile).mockResolvedValue('({ok:true})');
    const send = vi.fn().mockResolvedValue({ result: { type: 'object', value: { ok: true } } });
    stateModule.state.cdp = { connected: true, send } as any;

    const result = await handler({ name: 'obj' });
    expect((result.content[0] as { text: string }).text).toContain('"ok": true');
  });
});
