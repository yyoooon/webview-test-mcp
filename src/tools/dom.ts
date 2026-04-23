import { ensureConnected } from '../state.js';

export const definition = {
  name: 'webview_get_dom',
  description: '현재 WebView에서 보이는 상호작용 가능한 요소들의 스냅샷을 반환합니다.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};

export const DOM_SCRIPT = `(() => {
  function generateSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const testId = el.getAttribute('data-testid');
    if (testId) return '[data-testid="' + testId + '"]';
    const name = el.getAttribute('name');
    if (name) return el.tagName.toLowerCase() + '[name="' + name + '"]';
    const parent = el.parentElement;
    if (!parent) return el.tagName.toLowerCase();
    const sameTag = Array.from(parent.children).filter(c => c.tagName === el.tagName);
    const tag = el.tagName.toLowerCase();
    if (sameTag.length === 1) {
      const parentSel = parent === document.body ? 'body' : generateSelector(parent);
      return parentSel + ' > ' + tag;
    }
    const idx = sameTag.indexOf(el) + 1;
    const parentSel = parent === document.body ? 'body' : generateSelector(parent);
    return parentSel + ' > ' + tag + ':nth-of-type(' + idx + ')';
  }

  function isVisible(el) {
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  const selectors = 'a,button,input,select,textarea,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[onclick],[tabindex]';
  const elements = document.querySelectorAll(selectors);
  const results = [];

  for (const el of elements) {
    if (!isVisible(el)) continue;
    const entry = {
      selector: generateSelector(el),
      text: (el.textContent || '').trim().slice(0, 100),
      tag: el.tagName.toLowerCase(),
      visible: true,
    };
    if (el.type) entry.type = el.type;
    if (el.placeholder) entry.placeholder = el.placeholder;
    results.push(entry);
    if (results.length >= 50) break;
  }

  return JSON.stringify(results);
})()`;

export async function handler() {
  try {
    const cdp = await ensureConnected();
    const result = (await cdp.send('Runtime.evaluate', {
      expression: DOM_SCRIPT,
      returnByValue: true,
    })) as { result: { value: string } };

    const elements = JSON.parse(result.result.value);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(elements, null, 2),
      }],
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `DOM 스냅샷 실패: ${msg}` }],
    };
  }
}
