import { ensureConnected } from '../state.js';
import type { CdpClient } from '../cdp.js';

export const definition = {
  name: 'webview_screenshot',
  description:
    '현재 WebView 화면을 스크린샷으로 캡처합니다. ⚠️ 기능/상태/스타일 검증에는 쓰지 마세요 — webview_evaluate로 getComputedStyle/classList/textContent를 뽑는 게 훨씬 빠릅니다. 이 툴은 사람 눈으로 봐야 할 때만, 가능하면 selector 옵션으로 element-scoped 캡처를 사용하세요.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      selector: {
        type: 'string',
        description: '특정 요소만 캡처할 CSS selector (생략 시 전체 화면)',
      },
      format: {
        type: 'string',
        enum: ['png', 'jpeg'],
        description: '이미지 포맷 (기본: jpeg)',
      },
      quality: {
        type: 'number',
        description: 'JPEG 품질 0-100 (기본: 70, format=jpeg일 때만 적용)',
      },
    },
  },
};

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function getElementRect(
  cdp: CdpClient,
  selector: string,
): Promise<Rect | null> {
  const escaped = selector.replace(/'/g, "\\'");
  const expression = `(() => {
    const el = document.querySelector('${escaped}');
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
  })()`;
  const res = (await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  })) as { result: { value: string | null } };
  if (!res.result.value) return null;
  return JSON.parse(res.result.value) as Rect;
}

export async function handler(
  args: { selector?: string; format?: 'png' | 'jpeg'; quality?: number } = {},
) {
  try {
    const cdp = await ensureConnected();
    const format = args.format ?? 'jpeg';
    const params: Record<string, unknown> = { format };
    if (format === 'jpeg') {
      params.quality = args.quality ?? 70;
    }

    if (args.selector) {
      const rect = await getElementRect(cdp, args.selector);
      if (!rect) {
        return {
          isError: true as const,
          content: [
            {
              type: 'text' as const,
              text: `요소를 찾을 수 없거나 크기가 0입니다: ${args.selector}`,
            },
          ],
        };
      }
      params.clip = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        scale: 1,
      };
    }

    const result = (await cdp.send('Page.captureScreenshot', params)) as {
      data: string;
    };

    return {
      content: [
        {
          type: 'image' as const,
          data: result.data,
          mimeType: (format === 'jpeg' ? 'image/jpeg' : 'image/png') as
            | 'image/jpeg'
            | 'image/png',
        },
      ],
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      isError: true as const,
      content: [{ type: 'text' as const, text: `스크린샷 실패: ${msg}` }],
    };
  }
}
