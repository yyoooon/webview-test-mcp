import { ensureConnected } from '../state.js';
import type { CdpClient } from '../cdp.js';

export const definition = {
  name: 'webview_screenshot',
  description:
    '⚠️ 최후의 수단. 먼저 webview_evaluate로 getComputedStyle/classList/textContent/getBoundingClientRect를 뽑아 검증하세요 — 10~100배 빠르고 토큰도 거의 안 듭니다. 스크린샷은 오직 (1) 시각 회귀(아이콘 누락, 색 대비, z-index 겹침 등 style로 안 잡히는 것), (2) 레이아웃 전반 QA, (3) 사용자에게 보여줘야 할 때만. 호출 시 반드시 selector로 element-scoped 캡처하세요. 풀스크린(selector 생략)은 레이아웃 전반 QA일 때만 예외적으로 허용.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      selector: {
        type: 'string',
        description: '특정 요소만 캡처할 CSS selector. 생략 시 풀스크린 — 레이아웃 전반 QA가 아니면 생략하지 마세요.',
      },
      format: {
        type: 'string',
        enum: ['png', 'jpeg'],
        description: '이미지 포맷 (기본: jpeg)',
      },
      quality: {
        type: 'number',
        description: 'JPEG 품질 0-100 (기본: 50, format=jpeg일 때만 적용)',
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
      params.quality = args.quality ?? 50;
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
