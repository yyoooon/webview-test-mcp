import { ensureConnected, state } from '../state.js';
export const definition = {
    name: 'webview_screenshot',
    description: '⚠️ 최후의 수단. 먼저 webview_evaluate로 getComputedStyle/classList/textContent/getBoundingClientRect를 뽑아 검증하세요 — 10~100배 빠르고 토큰도 거의 안 듭니다. 스크린샷은 오직 (1) 시각 회귀(아이콘 누락, 색 대비, z-index 겹침 등 style로 안 잡히는 것), (2) 레이아웃 전반 QA, (3) 사용자에게 보여줘야 할 때만. 호출 시 반드시 selector로 element-scoped 캡처하세요. 풀스크린(selector 생략)은 레이아웃 전반 QA일 때만 예외적으로 허용.',
    inputSchema: {
        type: 'object',
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
async function getElementRect(cdp, selector) {
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
    }));
    if (!res.result.value)
        return null;
    return JSON.parse(res.result.value);
}
async function getViewportRect(cdp) {
    const res = (await cdp.send('Runtime.evaluate', {
        expression: 'JSON.stringify({x:0,y:0,width:window.innerWidth,height:window.innerHeight})',
        returnByValue: true,
    }));
    return JSON.parse(res.result.value);
}
export async function handler(args = {}) {
    try {
        const cdp = await ensureConnected();
        const format = args.format ?? 'jpeg';
        const params = { format };
        if (format === 'jpeg') {
            params.quality = args.quality ?? 50;
        }
        if (args.selector) {
            const rect = await getElementRect(cdp, args.selector);
            if (!rect) {
                return {
                    isError: true,
                    content: [
                        {
                            type: 'text',
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
        let data;
        let mime;
        if (state.platform === 'ios') {
            // iOS: Page.captureScreenshot 미지원 → snapshotRect (dataURL 반환)
            const rect = params.clip ?? (await getViewportRect(cdp));
            const res = (await cdp.send('Page.snapshotRect', {
                x: rect.x, y: rect.y, width: rect.width, height: rect.height,
                coordinateSystem: 'Viewport',
            }));
            const comma = res.dataURL.indexOf(',');
            data = res.dataURL.slice(comma + 1);
            mime = res.dataURL.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
        }
        else {
            const res = (await cdp.send('Page.captureScreenshot', params));
            data = res.data;
            mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        }
        return {
            content: [{ type: 'image', data, mimeType: mime }],
        };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
            isError: true,
            content: [{ type: 'text', text: `스크린샷 실패: ${msg}` }],
        };
    }
}
//# sourceMappingURL=screenshot.js.map