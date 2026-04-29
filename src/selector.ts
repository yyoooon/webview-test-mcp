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
      const all = [...document.querySelectorAll('[data-testid=\\'${tid}\\']')];
      const visible = all.find(${VISIBLE_FILTER_JS});
      return visible ?? null;
    })()`;
  }
  // text spec
  const text = escapeStr(spec.text);
  const tagFilter = spec.tag
    ? `el.tagName.toLowerCase() === '${escapeStr(spec.tag.toLowerCase())}'`
    : 'true';
  const root = spec.within
    ? `document.querySelector('${escapeStr(spec.within)}')`
    : 'document.body';
  return `(() => {
    const root = ${root};
    if (!root) return null;
    const all = [...root.querySelectorAll('*')];
    const isVisible = ${VISIBLE_FILTER_JS};
    const candidates = all.filter((el) => {
      if (!isVisible(el)) return false;
      if (!(${tagFilter})) return false;
      const t = (el.textContent || '').trim();
      if (!t.includes('${text}')) return false;
      const childWithSameText = [...el.children].find((c) => (c.textContent || '').trim() === t);
      return !childWithSameText;
    });
    const isInteractive = (el) => el.matches('button, a, [role=button], input, [role=link]');
    candidates.sort((a, b) => {
      const ai = isInteractive(a) ? 0 : 1;
      const bi = isInteractive(b) ? 0 : 1;
      return ai - bi;
    });
    const exact = candidates.find((el) => (el.textContent || '').trim() === '${text}');
    if (exact) return exact;
    return candidates[0] ?? null;
  })()`;
}

export function fuzzyCandidatesSnippet(): string {
  return `(() => {
    const all = [...document.querySelectorAll('button, a, [role=button]')];
    const isVisible = ${VISIBLE_FILTER_JS};
    return all
      .filter(isVisible)
      .slice(0, 5)
      .map((el) => (el.textContent || '').trim())
      .filter((t) => t.length > 0);
  })()`;
}
