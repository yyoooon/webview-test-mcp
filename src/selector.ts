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
