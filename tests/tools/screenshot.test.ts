import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/tools/screenshot.js';
import * as stateModule from '../../src/state.js';

describe('webview_screenshot handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateModule.resetState();
  });

  it('returns screenshot as base64 image', async () => {
    const fakeCdp = {
      connected: true,
      send: vi.fn().mockResolvedValue({ data: 'iVBORw0KGgo=' }),
    };
    stateModule.state.cdp = fakeCdp as any;

    const result = await handler();
    expect(result.content[0]).toEqual({
      type: 'image',
      data: 'iVBORw0KGgo=',
      mimeType: 'image/png',
    });
    expect(fakeCdp.send).toHaveBeenCalledWith('Page.captureScreenshot', { format: 'png' });
  });

  it('returns error when not connected', async () => {
    const result = await handler();
    expect(result.isError).toBe(true);
  });
});
