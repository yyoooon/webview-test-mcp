export type Selector = string | {
    text: string;
    within?: string;
    tag?: string;
} | {
    testId: string;
};
/**
 * 브라우저에서 평가할 visible 필터 JS 표현 (Element → boolean).
 */
export declare const VISIBLE_FILTER_JS = "((el) => {\n  if (!el || !(el instanceof Element)) return false;\n  const rects = el.getClientRects();\n  if (rects.length === 0) return false;\n  const cs = window.getComputedStyle(el);\n  if (cs.display === 'none' || cs.visibility === 'hidden') return false;\n  return true;\n})";
export declare function selectorSnippet(spec: Selector): string;
export declare function fuzzyCandidatesSnippet(): string;
