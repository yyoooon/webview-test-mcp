import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { ensureConnected } from '../state.js';

export const definition = {
  name: 'webview_run_script',
  description:
    '저장된 매크로 스크립트(.webview-scripts/{name}.webview.js)를 WebView에서 실행합니다. 긴 스크립트를 매번 토큰으로 보낼 필요 없이 이름만으로 실행합니다.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        description:
          '스크립트 이름 (확장자 제외). 예: "skip-to-home" → .webview-scripts/skip-to-home.webview.js',
      },
    },
    required: ['name'],
  },
};

const VALID_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function resolveScriptPath(name: string, cwd: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('스크립트 이름이 비어있습니다.');
  if (!VALID_NAME.test(trimmed)) {
    throw new Error(
      `유효하지 않은 스크립트 이름: "${name}". 영문/숫자/대시/언더스코어만 허용합니다.`,
    );
  }
  return path.join(cwd, '.webview-scripts', `${trimmed}.webview.js`);
}

interface EvalResult {
  result?: { type: string; value?: unknown; description?: string };
  exceptionDetails?: { exception?: { description?: string } };
}

export async function handler(args: { name: string }) {
  try {
    if (!args?.name) {
      return {
        isError: true as const,
        content: [{ type: 'text' as const, text: 'name은 필수입니다.' }],
      };
    }

    let scriptPath: string;
    try {
      scriptPath = resolveScriptPath(args.name, process.cwd());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { isError: true as const, content: [{ type: 'text' as const, text: msg }] };
    }

    let source: string;
    try {
      source = await readFile(scriptPath, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        return {
          isError: true as const,
          content: [
            {
              type: 'text' as const,
              text: `스크립트를 찾을 수 없습니다: ${scriptPath}`,
            },
          ],
        };
      }
      throw err;
    }

    const cdp = await ensureConnected();
    const result = (await cdp.send('Runtime.evaluate', {
      expression: source,
      awaitPromise: true,
      returnByValue: true,
    })) as EvalResult;

    if (result.exceptionDetails) {
      const desc = result.exceptionDetails.exception?.description || 'Unknown error';
      return {
        isError: true as const,
        content: [{ type: 'text' as const, text: `JS 실행 에러: ${desc}` }],
      };
    }

    const value = result.result?.value;
    const display =
      value === undefined
        ? `(${result.result?.type || 'undefined'})`
        : typeof value === 'object'
          ? JSON.stringify(value, null, 2)
          : String(value);
    return { content: [{ type: 'text' as const, text: display }] };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      isError: true as const,
      content: [{ type: 'text' as const, text: `run-script 실패: ${msg}` }],
    };
  }
}
