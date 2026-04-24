import { ensureConnected } from '../state.js';
import type { CdpClient } from '../cdp.js';

export const clickDefinition = {
  name: 'webview_click',
  description:
    'CSS selector 또는 텍스트로 요소를 찾아 클릭합니다. ⚠️ 연속 클릭은 webview_evaluate 한 번으로 체이닝하세요 (click → await sleep → click → 결과 return). 이 툴은 단발성 클릭에만 사용.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      selector: { type: 'string', description: 'CSS selector' },
      text: { type: 'string', description: '요소의 텍스트 내용' },
    },
  },
};

export const typeDefinition = {
  name: 'webview_type',
  description: '요소를 찾아 포커스 후 텍스트를 입력합니다.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      selector: { type: 'string', description: 'CSS selector' },
      text: { type: 'string', description: '요소의 텍스트 내용 (찾기용)' },
      value: { type: 'string', description: '입력할 텍스트' },
    },
    required: ['value'],
  },
};

function buildFindScript(selector?: string, text?: string, clearValue = false): string {
  const clearSnippet = clearValue ? `if ('value' in el) el.value = '';` : '';
  if (selector && text) {
    return `(() => {
      const els = document.querySelectorAll('${selector.replace(/'/g, "\\'")}');
      for (const el of els) {
        if ((el.textContent || '').trim() === '${text.replace(/'/g, "\\'")}') {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            ${clearSnippet}
            return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
          }
        }
      }
      return JSON.stringify({ error: 'not_found', similar: [] });
    })()`;
  }
  if (selector) {
    return `(() => {
      const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
      if (!el) {
        const all = document.querySelectorAll('a,button,input,select,textarea,[role="button"]');
        const similar = Array.from(all).slice(0, 5).map(e => ({ tag: e.tagName.toLowerCase(), text: (e.textContent || '').trim().slice(0, 50) }));
        return JSON.stringify({ error: 'not_found', similar });
      }
      const r = el.getBoundingClientRect();
      ${clearSnippet}
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    })()`;
  }
  if (text) {
    return `(() => {
      const target = '${text.replace(/'/g, "\\'")}';
      const all = document.querySelectorAll('*');
      let best = null;
      for (const el of all) {
        const t = (el.textContent || '').trim();
        if (t !== target) continue;
        const hasChild = Array.from(el.children).some(c => (c.textContent || '').trim() === target);
        if (hasChild) continue;
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') continue;
        best = el;
      }
      if (!best) return JSON.stringify({ error: 'not_found', similar: [] });
      const el = best;
      const r = el.getBoundingClientRect();
      ${clearSnippet}
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    })()`;
  }
  return '';
}

async function findAndClick(cdp: CdpClient, selector?: string, text?: string, clearValue = false) {
  const script = buildFindScript(selector, text, clearValue);
  if (!script) {
    return { isError: true, content: [{ type: 'text' as const, text: 'selector 또는 text 중 하나는 필수입니다.' }] };
  }
  const evalResult = (await cdp.send('Runtime.evaluate', { expression: script, returnByValue: true })) as { result: { value: string } };
  const coords = JSON.parse(evalResult.result.value);
  if (coords.error === 'not_found') {
    const hint = coords.similar?.length ? '\n유사한 요소:\n' + coords.similar.map((s: any) => `  <${s.tag}> "${s.text}"`).join('\n') : '';
    return { isError: true, content: [{ type: 'text' as const, text: `요소를 찾을 수 없습니다.${hint}` }] };
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
  return { content: [{ type: 'text' as const, text: `클릭 완료 (${Math.round(coords.x)}, ${Math.round(coords.y)})` }] };
}

export async function clickHandler(args: { selector?: string; text?: string }) {
  try {
    const cdp = await ensureConnected();
    return await findAndClick(cdp, args.selector, args.text);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: 'text' as const, text: `클릭 실패: ${msg}` }] };
  }
}

export async function typeHandler(args: { selector?: string; text?: string; value?: string }) {
  try {
    if (!args.value) {
      return { isError: true, content: [{ type: 'text' as const, text: 'value는 필수입니다.' }] };
    }
    const cdp = await ensureConnected();
    const clickResult = await findAndClick(cdp, args.selector, args.text, true);
    if (clickResult.isError) return clickResult;
    await cdp.send('Input.insertText', { text: args.value });
    return { content: [{ type: 'text' as const, text: `입력 완료: "${args.value}"` }] };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: 'text' as const, text: `입력 실패: ${msg}` }] };
  }
}
