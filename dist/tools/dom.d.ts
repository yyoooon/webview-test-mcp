export declare const definition: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {};
    };
};
export declare const DOM_SCRIPT = "(() => {\n  function generateSelector(el) {\n    if (el.id) return '#' + CSS.escape(el.id);\n    const testId = el.getAttribute('data-testid');\n    if (testId) return '[data-testid=\"' + testId + '\"]';\n    const name = el.getAttribute('name');\n    if (name) return el.tagName.toLowerCase() + '[name=\"' + name + '\"]';\n    const parent = el.parentElement;\n    if (!parent) return el.tagName.toLowerCase();\n    const sameTag = Array.from(parent.children).filter(c => c.tagName === el.tagName);\n    const tag = el.tagName.toLowerCase();\n    if (sameTag.length === 1) {\n      const parentSel = parent === document.body ? 'body' : generateSelector(parent);\n      return parentSel + ' > ' + tag;\n    }\n    const idx = sameTag.indexOf(el) + 1;\n    const parentSel = parent === document.body ? 'body' : generateSelector(parent);\n    return parentSel + ' > ' + tag + ':nth-of-type(' + idx + ')';\n  }\n\n  function isVisible(el) {\n    const s = window.getComputedStyle(el);\n    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;\n    const r = el.getBoundingClientRect();\n    return r.width > 0 && r.height > 0;\n  }\n\n  const selectors = 'a,button,input,select,textarea,[role=\"button\"],[role=\"link\"],[role=\"checkbox\"],[role=\"radio\"],[onclick],[tabindex]';\n  const elements = document.querySelectorAll(selectors);\n  const results = [];\n\n  for (const el of elements) {\n    if (!isVisible(el)) continue;\n    const entry = {\n      selector: generateSelector(el),\n      text: (el.textContent || '').trim().slice(0, 100),\n      tag: el.tagName.toLowerCase(),\n      visible: true,\n    };\n    if (el.type) entry.type = el.type;\n    if (el.placeholder) entry.placeholder = el.placeholder;\n    results.push(entry);\n    if (results.length >= 50) break;\n  }\n\n  return JSON.stringify(results);\n})()";
export declare function handler(): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError?: undefined;
} | {
    isError: boolean;
    content: {
        type: "text";
        text: string;
    }[];
}>;
