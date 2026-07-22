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
  | { type: 'nav'; i: number; url: string; reload: boolean; timeoutMs: number }
  | { type: 'netwait'; i: number; method: string | null; urlContains: string; timeoutMs: number };

interface NetEntry {
  method: string;
  url: string;
  status?: number;
}

function stepIsNetWait(step: FlowStep): boolean {
  return (
    typeof step === 'object' &&
    step !== null &&
    'waitFor' in step &&
    typeof (step as { waitFor: unknown }).waitFor === 'object' &&
    (step as { waitFor: object }).waitFor !== null &&
    'network' in (step as { waitFor: object }).waitFor
  );
}

/** object 형태 goto(실제 네비게이션: url/reload)인지. 문자열 goto(pushState)는 제외. */
function stepIsNav(step: FlowStep): boolean {
  return (
    typeof step === 'object' &&
    step !== null &&
    'goto' in step &&
    typeof (step as { goto: unknown }).goto === 'object' &&
    (step as { goto: unknown }).goto !== null
  );
}

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
          'FlowStep 배열. 각 요소는 click/type/waitFor/sleep/goto/capture/raw/assert/inspect/osTap/scroll/osSwipe/osKey 중 하나. inspect 예: `{ inspect: { title: { selector: "h1", style: ["fontSize","fontWeight"], text: true } } }`. osTap 예: `{ osTap: "#search-input" }` 또는 `{ osTap: { selector: "#btn", offsetX: 0, offsetY: -10 } }` — 좌표는 devicePixelRatio로 자동 스케일링되어 ADB shell input tap으로 실행. scroll 예: `{ scroll: { to: \'#footer\' } }` 또는 `{ scroll: { by: { y: 500 }, container: \'#list\' } }`. osSwipe 예: `{ osSwipe: { direction: \'up\' } }` (손가락 방향, ADB input swipe). osKey 예: `{ osKey: \'BACK\' }` (ADB keyevent). 실제 네비게이션 예: `{ goto: { url: \'/deep/link\' } }` 또는 `{ goto: { reload: true } }` — SPA 라우팅은 기존처럼 문자열 `{ goto: \'/path\' }`. waitFor는 selector/text/role/gone/url 외에 **transient 관찰** `{ waitFor: { appearsThenGone: \'#popup\', windowMs: 2000 } }` (windowMs 동안 샘플링해 observed.appeared/wentGone/hits 기록 — 깜빡임 회귀 검증용, flow를 중단하지 않음)와 **네트워크 완료 대기** `{ waitFor: { network: \'POST /gourd/throw\', timeout: 10000 } }` (해당 요청의 response 수신까지 대기 — Lottie 콜백 뒤 POST처럼 지연 요청 후 상태조회 오판 방지) 지원.',
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

    // #5 네트워크 대기: netwait step이 있으면 flow 시작 전에 Network 도메인을 켜고
    // 이벤트를 버퍼링한다 (앞선 click이 유발한 요청도 놓치지 않도록).
    const hasNetWait = (args.steps as FlowStep[]).some(stepIsNetWait);
    const netBuffer: NetEntry[] = [];
    let netCursor = 0;
    let onReq: ((p: Record<string, unknown>) => void) | undefined;
    let onResp: ((p: Record<string, unknown>) => void) | undefined;
    if (hasNetWait) {
      const reqMap = new Map<string, { method: string; url: string }>();
      onReq = (p) => {
        const id = p.requestId as string | undefined;
        const req = p.request as { method?: string; url?: string } | undefined;
        if (id && req?.url) reqMap.set(id, { method: req.method ?? '', url: req.url });
      };
      onResp = (p) => {
        const id = p.requestId as string | undefined;
        const resp = p.response as { url?: string; status?: number } | undefined;
        const meta = id ? reqMap.get(id) : undefined;
        if (meta) netBuffer.push({ method: meta.method, url: resp?.url ?? meta.url, status: resp?.status });
      };
      cdp.on('Network.requestWillBeSent', onReq);
      cdp.on('Network.responseReceived', onResp);
      await cdp.send('Network.enable', {});
    }

    // B: object goto(실제 네비게이션)가 있으면 Page.loadEventFired로 로드 완료를 감지.
    // 기존엔 nav 후 무조건 300ms 대기 + readyState 폴링 → 이벤트 기반으로 고정 지연 제거.
    const hasNav = (args.steps as FlowStep[]).some(stepIsNav);
    let loadCount = 0;
    let onPageLoad: (() => void) | undefined;
    const pageEvents = hasNav && typeof cdp.on === 'function';
    if (pageEvents) {
      onPageLoad = () => {
        loadCount += 1;
      };
      cdp.on('Page.loadEventFired', onPageLoad);
      await cdp.send('Page.enable', {}).catch(() => {});
    }

    let remainingSteps: FlowStep[] = args.steps as FlowStep[];
    let startIndex = 0;

    try {
    while (remainingSteps.length > 0) {
      const expr = compileFlow({ steps: remainingSteps, bail }, { startIndex });

      let segment: SegmentResult;
      if (state.platform === 'ios') {
        // iOS WebKit의 Runtime.evaluate는 awaitPromise를 무시하고 Promise를 {}로 반환 →
        // 전역에 결과를 저장한 뒤 폴링해서 SegmentResult를 얻는다.
        const M = '__nestFlowSeg';
        await cdp.send('Runtime.evaluate', {
          expression: `window.${M}={done:false}; Promise.resolve(${expr}).then(r=>{window.${M}={done:true,value:r}}).catch(e=>{window.${M}={done:true,error:String((e&&e.message)||e)}}); 0`,
        });
        const end = Date.now() + 30_000;
        let polled: { done?: boolean; value?: SegmentResult; error?: string } = {};
        while (Date.now() < end) {
          const r = (await cdp.send('Runtime.evaluate', {
            expression: `JSON.stringify(window.${M})`,
            returnByValue: true,
          })) as { result: { value: string } };
          polled = JSON.parse(r.result.value);
          if (polled.done) break;
          await new Promise((res) => setTimeout(res, 50));
        }
        if (!polled.done) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `[WAIT_TIMEOUT] flow 세그먼트가 30초 내 완료되지 않았습니다.` }],
          };
        }
        if (polled.error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `[JS_ERROR] flow 실행 중 예외: ${polled.error}` }],
          };
        }
        segment = polled.value as SegmentResult;
      } else {
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

        segment = evalResult.result.value;
      }
      allMarks.push(...segment.marks);
      totalMs += segment.totalMs;
      if (segment.captured) captured = { ...(captured ?? {}), ...segment.captured };

      if (segment.control) {
        const c = segment.control;
        if (
          state.platform === 'ios' &&
          (c.type === 'osTap' || c.type === 'osSwipe' || c.type === 'osKey')
        ) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: 'iOS에서는 osTap/osSwipe/osKey(OS-level 터치)를 지원하지 않습니다. 화면 내 조작은 click/type을 사용하세요.',
              },
            ],
          };
        }
        let stop = false;
        if (c.type === 'osTap') {
          await inputTap(c.x, c.y, state.deviceId ?? undefined);
        } else if (c.type === 'osSwipe') {
          await inputSwipe(c.x1, c.y1, c.x2, c.y2, c.durationMs, state.deviceId ?? undefined);
        } else if (c.type === 'osKey') {
          await inputKeyEvent(c.key, state.deviceId ?? undefined);
        } else if (c.type === 'nav') {
          const loadsBefore = loadCount;
          if (c.reload) {
            await cdp.send('Page.reload', {});
          } else {
            await cdp.send('Page.navigate', { url: c.url });
          }
          await waitForPageLoad(cdp, c.timeoutMs, pageEvents ? () => loadCount > loadsBefore : undefined);
        } else if (c.type === 'netwait') {
          const t0 = Date.now();
          const deadline = t0 + c.timeoutMs;
          let matched: NetEntry | undefined;
          while (Date.now() < deadline) {
            for (let k = netCursor; k < netBuffer.length; k++) {
              const e = netBuffer[k];
              if ((c.method == null || e.method === c.method) && e.url.includes(c.urlContains)) {
                matched = e;
                netCursor = k + 1;
                break;
              }
            }
            if (matched) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          const ms = Date.now() - t0;
          if (matched) {
            allMarks.push({ i: c.i, kind: 'waitFor', ok: true, ms, matched });
          } else {
            allMarks.push({
              i: c.i,
              kind: 'waitFor',
              ok: false,
              ms,
              error: 'NETWORK_TIMEOUT',
              cond: { method: c.method, urlContains: c.urlContains },
              observed: netBuffer.slice(-8),
            });
            failedAt = c.i;
            if (bail === 'on-error') stop = true;
          }
        }
        if (segment.failedAt !== undefined) {
          failedAt = segment.failedAt;
          snapshot = segment.snapshot;
        }
        if (stop) break;

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
    } finally {
      if (hasNetWait) {
        if (onReq) cdp.off('Network.requestWillBeSent', onReq);
        if (onResp) cdp.off('Network.responseReceived', onResp);
        await cdp.send('Network.disable', {}).catch(() => {});
      }
      if (pageEvents && onPageLoad) {
        cdp.off('Page.loadEventFired', onPageLoad);
        await cdp.send('Page.disable', {}).catch(() => {});
      }
    }
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
  loadFired?: () => boolean,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  if (loadFired) {
    // 이벤트 기반: 이 네비게이션이 유발한 Page.loadEventFired만 기다림. 고정 지연 없음.
    while (Date.now() < end) {
      if (loadFired()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new FlowError(
      ErrorCode.WAIT_TIMEOUT,
      `페이지 로드가 ${timeoutMs}ms 내에 완료되지 않았습니다.`,
    );
  }
  // 폴백(Page 이벤트 미가용): 이전 문서의 readyState가 'complete'로 남아있을 수 있어 잠깐 대기 후 폴링
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
