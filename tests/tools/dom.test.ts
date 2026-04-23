import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler, DOM_SCRIPT } from '../../src/tools/dom.js';
import * as stateModule from '../../src/state.js';

describe('webview_get_dom handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateModule.resetState();
  });

  it('returns parsed DOM snapshot', async () => {
    const mockElements = [
      { selector: '#submit-btn', text: '다음', tag: 'button', visible: true },
      { selector: 'input[name="email"]', text: '', tag: 'input', type: 'email', visible: true },
    ];
    const fakeCdp = {
      connected: true,
      send: vi.fn().mockResolvedValue({
        result: { value: JSON.stringify(mockElements) },
      }),
    };
    stateModule.state.cdp = fakeCdp as any;

    const result = await handler();
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].selector).toBe('#submit-btn');
    expect(parsed[1].tag).toBe('input');
  });

  it('sends DOM_SCRIPT via Runtime.evaluate', async () => {
    const fakeCdp = {
      connected: true,
      send: vi.fn().mockResolvedValue({ result: { value: '[]' } }),
    };
    stateModule.state.cdp = fakeCdp as any;

    await handler();
    expect(fakeCdp.send).toHaveBeenCalledWith('Runtime.evaluate', {
      expression: DOM_SCRIPT,
      returnByValue: true,
    });
  });

  it('returns error when not connected', async () => {
    const result = await handler();
    expect(result.isError).toBe(true);
  });
});

describe('DOM_SCRIPT', () => {
  it('is a non-empty string (injected JS)', () => {
    expect(typeof DOM_SCRIPT).toBe('string');
    expect(DOM_SCRIPT.length).toBeGreaterThan(100);
  });
});
