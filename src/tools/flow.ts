import { ensureConnected, state } from '../state.js';
import { compileFlow, FlowInput, FlowStep } from '../flow-compiler.js';
import { applyPayloadGuard } from '../payload-guard.js';
import { FlowError, ErrorCode } from '../errors.js';
import { inputTap, inputSwipe, inputKeyEvent } from '../adb.js';
import { ConsoleEntry } from '../console-log.js';

type ControlSignal =
  | { type: 'osTap'; i: number; x: number; y: number; selector: unknown }
  | { type: 'osSwipe'; i: number; x1: number; y1: number; x2: number; y2: number; durationMs: number }
  | { type: 'osKey'; i: number; key: string }
  | { type: 'nav'; i: number; url: string; reload: boolean; timeoutMs: number };

interface SegmentResult {
  marks: unknown[];
  totalMs: number;
  captured?: Record<string, unknown>;
  control?: ControlSignal;
  failedAt?: number;
  snapshot?: unknown;
}

interface FlowResult extends SegmentResult {
  console?: ConsoleEntry[];
}

export const definition = {
  name: 'webview_flow',
  description:
    '선언형 step 배열을 한 번에 실행합니다. multi-step 시나리오 (클릭 → 대기 → 캡처/검증)를 1콜로 묶어 토큰/지연을 줄입니다. **디자인 적용 검증**에는 inspect step, **OS-level 터치**(키보드 안 뜨는 등)에는 osTap step을 사용. JS를 직접 짤 필요 없는 케이스에 우선 사용하고, 표현이 부족하면 webview_evaluate로 fallback. 스크롤은 scroll(JS)/osSwipe(ADB), OS 키는 osKey, 실제 네비게이션(새로고침/딥링크)은 goto 객체 형태 사용. flow 중 발생한 console error/warning은 결과의 console 필드에 자동 첨부.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      steps: {
        type: 'array',
        description:
          'FlowStep 배열. 각 요소는 click/type/waitFor/sleep/goto/capture/raw/assert/inspect/osTap/scroll/osSwipe/osKey 중 하나. inspect 예: `{ inspect: { title: { selector: "h1", style: ["fontSize","fontWeight"], text: true } } }`. osTap 예: `{ osTap: "#search-input" }` 또는 `{ osTap: { selector: "#btn", offsetX: 0, offsetY: -10 } }` — 좌표는 devicePixelRatio로 자동 스케일링되어 ADB shell input tap으로 실행. scroll 예: `{ scroll: { to: \'#footer\' } }` 또는 `{ scroll: { by: { y: 500 }, container: \'#list\' } }`. osSwipe 예: `{ osSwipe: { direction: \'up\' } }` (손가락 방향, ADB input swipe). osKey 예: `{ osKey: \'BACK\' }` (ADB keyevent). 실제 네비게이션 예: `{ goto: { url: \'/deep/link\' } }` 또는 `{ goto: { reload: true } }` — SPA 라우팅은 기존처럼 문자열 `{ goto: \'/path\' }`.',
      },
      bail: {
        type: 'string',
        enum: ['on-error', 'continue'],
        description: '기본 on-error: 실패 즉시 중단',
      },
      outputMaxBytes: {
        type: 'number',
        description: 'capture 결과 byte 상한 (기본 10000)',
      },
    },
    required: ['steps'],
  },
};

const DEFAULT_MAX_BYTES = 10_000;

export async function flowHandler(args: Partial<FlowInput>) {
  try {
    if (!args.steps || !Array.isArray(args.steps) || args.steps.length === 0) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: 'steps 배열은 필수이며 1개 이상이어야 합니다.' }],
      };
    }
    const cdp = await ensureConnected();
    const bail = args.bail ?? 'on-error';
    const consoleBuffer = state.console;
    const consoleCursor = consoleBuffer ? consoleBuffer.cursor : 0;

    const allMarks: unknown[] = [];
    let captured: Record<string, unknown> | undefined;
    let totalMs = 0;
    let failedAt: number | undefined;
    let snapshot: unknown;

    let remainingSteps: FlowStep[] = args.steps as FlowStep[];
    let startIndex = 0;

    while (remainingSteps.length > 0) {
      const expr = compileFlow({ steps: remainingSteps, bail }, { startIndex });
      const evalResult = (await cdp.send('Runtime.evaluate', {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
      })) as { result: { value: SegmentResult }; exceptionDetails?: { exception?: { description?: string } } };

      if (evalResult.exceptionDetails) {
        const desc = evalResult.exceptionDetails.exception?.description || 'Unknown';
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `[JS_ERROR] flow 실행 중 예외: ${desc}` }],
        };
      }

      const segment = evalResult.result.value;
      allMarks.push(...segment.marks);
      totalMs += segment.totalMs;
      if (segment.captured) captured = { ...(captured ?? {}), ...segment.captured };

      if (segment.control) {
        const c = segment.control;
        if (c.type === 'osTap') {
          await inputTap(c.x, c.y, state.deviceId ?? undefined);
        } else if (c.type === 'osSwipe') {
          await inputSwipe(c.x1, c.y1, c.x2, c.y2, c.durationMs, state.deviceId ?? undefined);
        } else if (c.type === 'osKey') {
          await inputKeyEvent(c.key, state.deviceId ?? undefined);
        } else if (c.type === 'nav') {
          if (c.reload) {
            await cdp.send('Page.reload', {});
          } else {
            await cdp.send('Page.navigate', { url: c.url });
          }
          await waitForPageLoad(cdp, c.timeoutMs);
        }
        if (segment.failedAt !== undefined) {
          failedAt = segment.failedAt;
          snapshot = segment.snapshot;
        }

        const consumedCount = c.i - startIndex + 1;
        remainingSteps = remainingSteps.slice(consumedCount);
        startIndex = c.i + 1;
        continue;
      }

      if (segment.failedAt !== undefined) {
        failedAt = segment.failedAt;
        snapshot = segment.snapshot;
      }
      break;
    }

    const merged: FlowResult = { marks: allMarks, totalMs };
    if (captured !== undefined) merged.captured = captured;
    if (failedAt !== undefined) merged.failedAt = failedAt;
    if (snapshot !== undefined) merged.snapshot = snapshot;

    const consoleLogs =
      consoleBuffer
        ?.since(consoleCursor)
        .filter((e) => e.level === 'error' || e.level === 'warning') ?? [];
    if (consoleLogs.length > 0) merged.console = consoleLogs;

    const guarded = applyPayloadGuard(merged, args.outputMaxBytes ?? DEFAULT_MAX_BYTES);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(guarded, null, 2) }],
    };
  } catch (error) {
    if (error instanceof FlowError) {
      const extras = error.extras ? `\n${JSON.stringify(error.extras, null, 2)}` : '';
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `[${error.code}] ${error.message}${extras}` }],
      };
    }
    const msg = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `flow 실패: ${msg}` }],
    };
  }
}

interface ReadyStateResult {
  result: { value: string };
}

async function waitForPageLoad(
  cdp: { send: (method: string, params?: Record<string, unknown>) => Promise<unknown> },
  timeoutMs: number,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  // navigate 직후에는 이전 문서의 readyState가 'complete'로 남아있을 수 있어 잠깐 대기
  await new Promise((r) => setTimeout(r, 300));
  while (Date.now() < end) {
    try {
      const res = (await cdp.send('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      })) as ReadyStateResult;
      if (res.result.value === 'complete') return;
    } catch {
      // 네비게이션 중 실행 컨텍스트 파괴 — 재시도
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new FlowError(
    ErrorCode.WAIT_TIMEOUT,
    `페이지 로드가 ${timeoutMs}ms 내에 완료되지 않았습니다.`,
  );
}
