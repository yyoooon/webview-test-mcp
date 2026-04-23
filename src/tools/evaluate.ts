import { ensureConnected } from '../state.js';

export const definition = {
  name: 'webview_evaluate',
  description: 'WebView에서 JavaScript를 실행하고 결과를 반환합니다. async/await 지원.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      expression: { type: 'string', description: '실행할 JavaScript 표현식' },
    },
    required: ['expression'],
  },
};

interface EvalResult {
  result?: { type: string; value?: unknown; description?: string };
  exceptionDetails?: { exception?: { description?: string } };
}

export async function handler(args: { expression: string }) {
  try {
    if (!args.expression) {
      return { isError: true, content: [{ type: 'text' as const, text: 'expression은 필수입니다.' }] };
    }
    const cdp = await ensureConnected();
    const result = (await cdp.send('Runtime.evaluate', { expression: args.expression, awaitPromise: true, returnByValue: true })) as EvalResult;
    if (result.exceptionDetails) {
      const desc = result.exceptionDetails.exception?.description || 'Unknown error';
      return { isError: true, content: [{ type: 'text' as const, text: `JS 실행 에러: ${desc}` }] };
    }
    const value = result.result?.value;
    const display = value === undefined ? `(${result.result?.type || 'undefined'})` : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
    return { content: [{ type: 'text' as const, text: display }] };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: 'text' as const, text: `evaluate 실패: ${msg}` }] };
  }
}
