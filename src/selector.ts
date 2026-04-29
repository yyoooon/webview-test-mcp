export type Selector =
  | string
  | { text: string; within?: string; tag?: string }
  | { testId: string };

/**
 * 브라우저에서 평가할 visible 필터 JS 표현 (Element → boolean).
 */
export const VISIBLE_FILTER_JS = `((el) => {
  if (!el || !(el instanceof Element)) return false;
  const rects = el.getClientRects();
  if (rects.length === 0) return false;
  const cs = window.getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  return true;
})`;

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

export function selectorSnippet(spec: Selector): string {
  if (typeof spec === 'string') {
    const css = escapeStr(spec);
    return `(() => {
      const all = [...document.querySelectorAll('${css}')];
      const visible = all.find(${VISIBLE_FILTER_JS});
      return visible ?? null;
    })()`;
  }
  if ('testId' in spec) {
    const tid = escapeStr(spec.testId);
    return `(() => {
      const all = [...document.querySelectorAll('[data-testid="${tid}"]')];
      const visible = all.find(${VISIBLE_FILTER_JS});
      return visible ?? null;
    })()`;
  }
  // text branch — placeholder, filled in Task 4
  return 'null';
}
