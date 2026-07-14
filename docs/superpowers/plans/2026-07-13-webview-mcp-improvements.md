# webview-test-mcp 개선 6건 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모바일 QA에서 부딪히는 6개 빈 곳을 채운다 — 콘솔/에러 로그 수집, scroll/osSwipe step, OS 키 이벤트(Back/Enter), 진짜 페이지 네비게이션(Page.navigate), WebView 앱 이름 선택, 매크로 args.

**Architecture:** 기존 패턴을 그대로 따른다. (1) 페이지 안에서 실행 가능한 step은 flow-compiler가 JS 문자열로 컴파일, (2) Node 레이어가 필요한 step(ADB/CDP 명령)은 osTap처럼 "control 신호"를 반환하고 flowHandler가 실행 후 잔여 step을 재컴파일해 이어간다. osTap 전용이던 이 채널을 `control: { type, ... }`로 일반화한 뒤 osSwipe/osKey/nav를 얹는다. 콘솔 수집은 CdpClient에 이벤트 구독을 추가하고 링 버퍼로 모아 flow 결과에 첨부한다.

**Tech Stack:** TypeScript(ESM), @modelcontextprotocol/sdk, ws(CDP), vitest + happy-dom.

## Global Constraints

- **자동 커밋 금지**: 각 Task의 Commit step은 사용자에게 커밋 여부를 확인한 후에만 실행. (사용자 전역 규칙)
- **커밋 메시지에 Claude 서명 금지**: `Co-Authored-By: Claude`, `🤖 Generated with...` 문구 넣지 않음.
- 테스트: `npm test` (vitest run). 단일 파일: `npx vitest run tests/<file>.test.ts`.
- 빌드: `npm run build` (tsc → dist/).
- 컴파일된 flow JS 안의 임시 변수는 기존 컨벤션대로 `__` 접두사 사용.
- 기존 코드 스타일 유지 (flow-compiler.ts는 큰따옴표, tools/*.ts는 작은따옴표 혼재 — 파일별 기존 스타일 따름).
- 시작 전 baseline 확인: `npm test`가 green인지 1회 실행. (red가 있으면 멈추고 사용자에게 보고)

---

### Task 1: CdpClient 이벤트 구독 (`on`/`off`)

CDP는 응답(id 있음)과 이벤트(method 있음)를 같은 WebSocket으로 보낸다. 현재 CdpClient는 응답만 처리하고 이벤트를 버린다. `Runtime.consoleAPICalled` 등을 받으려면 구독 API가 필요하다.

**Files:**
- Modify: `src/cdp.ts`
- Test: `tests/cdp.test.ts`

**Interfaces:**
- Produces: `CdpClient.on(method: string, handler: (params: Record<string, unknown>) => void): void`, `CdpClient.off(method, handler): void`. 이벤트 메시지(`{ method, params }`)가 오면 등록된 핸들러에 `params`를 전달.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/cdp.test.ts`의 `describe('CdpClient')` 블록 안에 추가:

```ts
  it('dispatches CDP events to registered handlers', async () => {
    const connectPromise = client.connect(9222);
    await vi.waitFor(() => {
      const ws = vi.mocked(WebSocket).mock.results[0]?.value;
      ws._emit('open');
    });
    await connectPromise;

    const ws = vi.mocked(WebSocket).mock.results[0].value;
    const handler = vi.fn();
    client.on('Runtime.consoleAPICalled', handler);
    ws._emit('message', JSON.stringify({ method: 'Runtime.consoleAPICalled', params: { type: 'error' } }));

    expect(handler).toHaveBeenCalledWith({ type: 'error' });
  });

  it('off unregisters an event handler', async () => {
    const connectPromise = client.connect(9222);
    await vi.waitFor(() => {
      const ws = vi.mocked(WebSocket).mock.results[0]?.value;
      ws._emit('open');
    });
    await connectPromise;

    const ws = vi.mocked(WebSocket).mock.results[0].value;
    const handler = vi.fn();
    client.on('Runtime.consoleAPICalled', handler);
    client.off('Runtime.consoleAPICalled', handler);
    ws._emit('message', JSON.stringify({ method: 'Runtime.consoleAPICalled', params: {} }));

    expect(handler).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/cdp.test.ts`
Expected: FAIL — `client.on is not a function`

- [ ] **Step 3: 구현**

`src/cdp.ts`:

클래스 필드 추가 (`private _connected = false;` 아래):

```ts
  private eventHandlers = new Map<string, Set<(params: Record<string, unknown>) => void>>();
```

메서드 추가 (`get connected()` 아래):

```ts
  on(method: string, handler: (params: Record<string, unknown>) => void): void {
    if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, new Set());
    this.eventHandlers.get(method)!.add(handler);
  }

  off(method: string, handler: (params: Record<string, unknown>) => void): void {
    this.eventHandlers.get(method)?.delete(handler);
  }
```

`'message'` 핸들러 수정 — 파싱 타입에 `method`/`params` 추가하고 이벤트 분기:

```ts
      this.ws.on('message', (data: WebSocket.Data) => {
        const msg = JSON.parse(data.toString()) as {
          id?: number;
          result?: unknown;
          error?: { code: number; message: string };
          method?: string;
          params?: Record<string, unknown>;
        };
        if (msg.method !== undefined) {
          const handlers = this.eventHandlers.get(msg.method);
          if (handlers) for (const h of handlers) h(msg.params ?? {});
          return;
        }
        if (msg.id !== undefined) {
          // ... 기존 응답 처리 그대로 ...
        }
      });
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/cdp.test.ts`
Expected: PASS (기존 테스트 포함 전부)

- [ ] **Step 5: 사용자 승인 후 커밋**

```bash
git add src/cdp.ts tests/cdp.test.ts
git commit -m "feat(cdp): event subscription (on/off) for CDP notifications"
```

---

### Task 2: ConsoleBuffer 모듈 + 연결 시 자동 attach

`Runtime.consoleAPICalled` / `Runtime.exceptionThrown`을 링 버퍼(최근 100개, 메시지당 300자)에 모은다. 연결 성립 시점마다 attach하고 `Runtime.enable`을 보낸다.

**Files:**
- Create: `src/console-log.ts`
- Modify: `src/state.ts`, `src/tools/connect.ts`
- Test: `tests/console-log.test.ts` (신규)

**Interfaces:**
- Consumes: Task 1의 `CdpClient.on(method, handler)`.
- Produces:
  - `ConsoleEntry = { kind: 'console' | 'exception'; level: string; text: string }`
  - `ConsoleBuffer.cursor: number` (누적 카운터), `.since(cursor): ConsoleEntry[]`, `.push(entry)`, `.attach(cdp): Promise<void>`
  - `state.console: ConsoleBuffer | null`
  - `attachConsole(cdp): Promise<void>` — state.ts에서 export. 실패해도 throw하지 않음(비필수 기능).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/console-log.test.ts` 생성:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ConsoleBuffer } from '../src/console-log.js';

function makeFakeCdp() {
  const handlers: Record<string, (params: Record<string, unknown>) => void> = {};
  return {
    handlers,
    on: vi.fn((method: string, h: (params: Record<string, unknown>) => void) => {
      handlers[method] = h;
    }),
    send: vi.fn().mockResolvedValue({}),
  };
}

describe('ConsoleBuffer', () => {
  it('attach subscribes to console/exception events and enables Runtime', async () => {
    const cdp = makeFakeCdp();
    const buffer = new ConsoleBuffer();
    await buffer.attach(cdp as any);
    expect(cdp.send).toHaveBeenCalledWith('Runtime.enable');
    expect(cdp.handlers['Runtime.consoleAPICalled']).toBeDefined();
    expect(cdp.handlers['Runtime.exceptionThrown']).toBeDefined();
  });

  it('records consoleAPICalled with joined args', async () => {
    const cdp = makeFakeCdp();
    const buffer = new ConsoleBuffer();
    await buffer.attach(cdp as any);
    cdp.handlers['Runtime.consoleAPICalled']({
      type: 'error',
      args: [{ type: 'string', value: 'fetch failed:' }, { type: 'number', value: 500 }],
    });
    expect(buffer.since(0)).toEqual([
      { kind: 'console', level: 'error', text: 'fetch failed: 500' },
    ]);
  });

  it('records exceptionThrown with description', async () => {
    const cdp = makeFakeCdp();
    const buffer = new ConsoleBuffer();
    await buffer.attach(cdp as any);
    cdp.handlers['Runtime.exceptionThrown']({
      exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: x is not a function' } },
    });
    expect(buffer.since(0)).toEqual([
      { kind: 'exception', level: 'error', text: 'TypeError: x is not a function' },
    ]);
  });

  it('since(cursor) returns only entries after the cursor', () => {
    const buffer = new ConsoleBuffer();
    buffer.push({ kind: 'console', level: 'error', text: 'old' });
    const cursor = buffer.cursor;
    buffer.push({ kind: 'console', level: 'error', text: 'new' });
    expect(buffer.since(cursor)).toEqual([{ kind: 'console', level: 'error', text: 'new' }]);
  });

  it('evicts oldest beyond 100 entries and keeps cursor math correct', () => {
    const buffer = new ConsoleBuffer();
    for (let i = 0; i < 105; i++) {
      buffer.push({ kind: 'console', level: 'log', text: `msg${i}` });
    }
    const all = buffer.since(0);
    expect(all).toHaveLength(100);
    expect(all[0].text).toBe('msg5');
    expect(buffer.since(103)).toEqual([
      { kind: 'console', level: 'log', text: 'msg103' },
      { kind: 'console', level: 'log', text: 'msg104' },
    ]);
  });

  it('truncates long messages to 300 chars', async () => {
    const cdp = makeFakeCdp();
    const buffer = new ConsoleBuffer();
    await buffer.attach(cdp as any);
    cdp.handlers['Runtime.consoleAPICalled']({
      type: 'error',
      args: [{ type: 'string', value: 'x'.repeat(500) }],
    });
    expect(buffer.since(0)[0].text).toHaveLength(300);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/console-log.test.ts`
Expected: FAIL — `Cannot find module '../src/console-log.js'`

- [ ] **Step 3: 구현**

`src/console-log.ts` 생성:

```ts
import { CdpClient } from './cdp.js';

export interface ConsoleEntry {
  kind: 'console' | 'exception';
  level: string;
  text: string;
}

const MAX_ENTRIES = 100;
const MAX_TEXT_LENGTH = 300;

interface RemoteObject {
  type?: string;
  value?: unknown;
  description?: string;
}

function formatArgs(args: RemoteObject[]): string {
  return args
    .map((a) =>
      a.value !== undefined
        ? typeof a.value === 'object'
          ? JSON.stringify(a.value)
          : String(a.value)
        : (a.description ?? a.type ?? ''),
    )
    .join(' ')
    .slice(0, MAX_TEXT_LENGTH);
}

export class ConsoleBuffer {
  private entries: ConsoleEntry[] = [];
  private total = 0;

  /** 지금까지 push된 누적 개수. flow 시작 시점 저장 → since()로 그 이후분만 조회. */
  get cursor(): number {
    return this.total;
  }

  push(entry: ConsoleEntry): void {
    this.entries.push(entry);
    this.total += 1;
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }

  since(cursor: number): ConsoleEntry[] {
    const firstKept = this.total - this.entries.length;
    return this.entries.slice(Math.max(0, cursor - firstKept));
  }

  async attach(cdp: CdpClient): Promise<void> {
    cdp.on('Runtime.consoleAPICalled', (params) => {
      const p = params as { type?: string; args?: RemoteObject[] };
      this.push({ kind: 'console', level: p.type ?? 'log', text: formatArgs(p.args ?? []) });
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      const p = params as {
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      };
      const d = p.exceptionDetails;
      const text = (d?.exception?.description ?? d?.text ?? 'Unknown exception').slice(
        0,
        MAX_TEXT_LENGTH,
      );
      this.push({ kind: 'exception', level: 'error', text });
    });
    await cdp.send('Runtime.enable');
  }
}
```

`src/state.ts` 수정:

```ts
import { CdpClient } from './cdp.js';
import { ConsoleBuffer } from './console-log.js';
import { pickDevice, pickSocket } from './discovery.js';
import { forwardPort } from './adb.js';

export interface ConnectionState {
  cdp: CdpClient | null;
  deviceId: string | null;
  forwardedPort: number | null;
  socketName: string | null;
  console: ConsoleBuffer | null;
}

export const state: ConnectionState = {
  cdp: null,
  deviceId: null,
  forwardedPort: null,
  socketName: null,
  console: null,
};

export function resetState(): void {
  state.cdp = null;
  state.deviceId = null;
  state.forwardedPort = null;
  state.socketName = null;
  state.console = null;
}

/** 콘솔 수집은 비필수 — 실패해도 연결 자체는 유지. */
export async function attachConsole(cdp: CdpClient): Promise<void> {
  try {
    const buffer = new ConsoleBuffer();
    await buffer.attach(cdp);
    state.console = buffer;
  } catch {
    state.console = null;
  }
}
```

`autoDiscoverAndConnect`와 `ensureConnected`의 재연결 경로에서 `state.cdp = cdp;` 직후 각각 `await attachConsole(cdp);` 호출:

```ts
async function autoDiscoverAndConnect(): Promise<CdpClient> {
  const device = await pickDevice();
  const socket = await pickSocket(device.id);
  const port = await forwardPort(socket.socketName, device.id);
  const cdp = new CdpClient();
  await cdp.connect(port);
  state.cdp = cdp;
  state.deviceId = device.id;
  state.forwardedPort = port;
  state.socketName = socket.socketName;
  await attachConsole(cdp);
  return cdp;
}

export async function ensureConnected(): Promise<CdpClient> {
  if (isConnected()) return state.cdp!;

  if (state.forwardedPort && state.socketName) {
    try {
      const cdp = new CdpClient();
      await cdp.connect(state.forwardedPort);
      state.cdp = cdp;
      await attachConsole(cdp);
      return cdp;
    } catch {
      // fall through to auto-discover
    }
  }

  return await autoDiscoverAndConnect();
}
```

`src/tools/connect.ts` 수정 — import에 `attachConsole` 추가, `state.socketName = socket.socketName;` 다음 줄에:

```ts
    await attachConsole(cdp);
```

(import 라인: `import { state, resetState, attachConsole } from "../state.js";`)

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/console-log.test.ts tests/state.test.ts tests/tools/connect.test.ts`
Expected: PASS. state/connect 기존 테스트가 fake cdp에 `on`이 없어 깨지면, 해당 fake에 `on: vi.fn()` 추가. (attachConsole은 try/catch라 대부분 그대로 통과)

- [ ] **Step 5: 사용자 승인 후 커밋**

```bash
git add src/console-log.ts src/state.ts src/tools/connect.ts tests/console-log.test.ts
git commit -m "feat(console): collect console/exception events into ring buffer on connect"
```

---

### Task 3: flow 결과에 콘솔 에러 첨부

flow 실행 중 발생한 `error`/`warning` 레벨 엔트리만 결과에 `console` 필드로 첨부한다. 실행 전 로그는 제외(cursor 사용).

**Files:**
- Modify: `src/tools/flow.ts`
- Test: `tests/tools/flow.test.ts`

**Interfaces:**
- Consumes: `state.console: ConsoleBuffer | null`, `buffer.cursor`, `buffer.since(cursor)` (Task 2).
- Produces: flow 결과 JSON에 `console?: ConsoleEntry[]` (에러/경고 있을 때만).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/tools/flow.test.ts`에 import 추가:

```ts
import { ConsoleBuffer } from '../../src/console-log.js';
```

describe 블록 추가:

```ts
describe('flowHandler — console attachment', () => {
  beforeEach(() => { vi.clearAllMocks(); stateModule.resetState(); });

  it('attaches error/warning logs emitted during the flow', async () => {
    const buffer = new ConsoleBuffer();
    buffer.push({ kind: 'console', level: 'error', text: 'before flow' }); // 실행 전 로그 — 제외돼야 함
    stateModule.state.console = buffer;

    const fakeReturn = { marks: [{ i: 0, kind: 'sleep', ok: true, ms: 1 }], totalMs: 1 };
    stateModule.state.cdp = {
      connected: true,
      send: vi.fn().mockImplementation((method: string) => {
        if (method === 'Runtime.evaluate') {
          buffer.push({ kind: 'exception', level: 'error', text: 'TypeError: boom' });
          buffer.push({ kind: 'console', level: 'log', text: 'verbose noise' }); // log 레벨 — 제외
          return Promise.resolve({ result: { value: fakeReturn } });
        }
        return Promise.resolve({});
      }),
    } as any;

    const result = await flowHandler({ steps: [{ sleep: 1 }] });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.console).toEqual([{ kind: 'exception', level: 'error', text: 'TypeError: boom' }]);
  });

  it('omits console field when no errors occurred', async () => {
    stateModule.state.console = new ConsoleBuffer();
    const fakeReturn = { marks: [{ i: 0, kind: 'sleep', ok: true, ms: 1 }], totalMs: 1 };
    stateModule.state.cdp = makeFakeCdp(fakeReturn) as any;

    const result = await flowHandler({ steps: [{ sleep: 1 }] });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.console).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/tools/flow.test.ts`
Expected: FAIL — `parsed.console`이 undefined (첫 테스트)

- [ ] **Step 3: 구현**

`src/tools/flow.ts`:

import 추가:

```ts
import { ConsoleEntry } from '../console-log.js';
```

`SegmentResult` 아래에 결과 타입 확장 (merged에 쓰기 위함):

```ts
interface FlowResult extends SegmentResult {
  console?: ConsoleEntry[];
}
```

`flowHandler` 안 — `const cdp = await ensureConnected();` 다음 줄에:

```ts
    const consoleBuffer = state.console;
    const consoleCursor = consoleBuffer ? consoleBuffer.cursor : 0;
```

`const merged: SegmentResult = ...` 부분을 `FlowResult`로 바꾸고, `snapshot` 병합 다음에:

```ts
    const merged: FlowResult = { marks: allMarks, totalMs };
    if (captured !== undefined) merged.captured = captured;
    if (failedAt !== undefined) merged.failedAt = failedAt;
    if (snapshot !== undefined) merged.snapshot = snapshot;

    const consoleLogs =
      consoleBuffer
        ?.since(consoleCursor)
        .filter((e) => e.level === 'error' || e.level === 'warning') ?? [];
    if (consoleLogs.length > 0) merged.console = consoleLogs;
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/tools/flow.test.ts`
Expected: PASS (기존 osTap 테스트 포함)

- [ ] **Step 5: 사용자 승인 후 커밋**

```bash
git add src/tools/flow.ts tests/tools/flow.test.ts
git commit -m "feat(flow): attach console errors/warnings captured during flow run"
```

---

### Task 4: scroll step (페이지 내 스크롤)

JS로 충분한 스크롤: 요소로 스크롤(`to`) 또는 픽셀 단위 스크롤(`by`, 컨테이너 선택 가능).

**Files:**
- Modify: `src/flow-compiler.ts`
- Test: `tests/flow-compiler.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ScrollStep {
    scroll:
      | { to: Selector; block?: 'start' | 'center' | 'end' | 'nearest' }
      | { by: { x?: number; y?: number }; container?: string };
  }
  ```
  `FlowStep` union에 추가. mark kind는 `'scroll'`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/flow-compiler.test.ts`에 describe 추가:

```ts
describe("compileFlow — scroll", () => {
  it("scroll to selector calls scrollIntoView and records ok", async () => {
    const result = (await evalFlow('<div id="target">bottom</div>', [
      { scroll: { to: "#target" } },
    ])) as { marks: { kind: string; ok: boolean }[] };
    expect(result.marks[0]).toMatchObject({ kind: "scroll", ok: true });
  });

  it("scroll to missing selector fails with SELECTOR_NOT_FOUND", async () => {
    const result = (await evalFlow("<div></div>", [
      { scroll: { to: "#missing" } },
    ])) as { marks: { ok: boolean; error?: string }[]; failedAt?: number };
    expect(result.marks[0].error).toBe("SELECTOR_NOT_FOUND");
    expect(result.failedAt).toBe(0);
  });

  it("scroll by delta on window records ok", async () => {
    const result = (await evalFlow("<div></div>", [
      { scroll: { by: { y: 500 } } },
    ])) as { marks: { kind: string; ok: boolean }[] };
    expect(result.marks[0]).toMatchObject({ kind: "scroll", ok: true });
  });

  it("scroll by delta with missing container fails", async () => {
    const result = (await evalFlow("<div></div>", [
      { scroll: { by: { y: 100 }, container: "#list" } },
    ])) as { marks: { ok: boolean; error?: string }[]; failedAt?: number };
    expect(result.marks[0].error).toBe("SELECTOR_NOT_FOUND");
    expect(result.failedAt).toBe(0);
  });
});
```

주의: happy-dom이 `scrollIntoView`/`scrollBy`를 미구현이면 첫/셋째 테스트가 `not a function`으로 깨질 수 있다. 그 경우 evalFlow 헬퍼 밑에서 window에 폴리필을 심는다 (테스트 파일 상단 evalFlow 안, performance 폴리필 옆):

```ts
  // happy-dom 미구현 API 폴리필 (동작 검증이 아니라 컴파일 결과 검증이 목적)
  window.eval(`
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {};
    if (!Element.prototype.scrollBy) Element.prototype.scrollBy = function () {};
    if (!window.scrollBy) window.scrollBy = function () {};
  `);
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/flow-compiler.test.ts`
Expected: FAIL — scroll step이 `INVALID_STEP`으로 떨어짐

- [ ] **Step 3: 구현**

`src/flow-compiler.ts`:

인터페이스 추가 (OsTapStep 아래):

```ts
export interface ScrollStep {
  /** 페이지 내 JS 스크롤. to: 요소로 scrollIntoView / by: 픽셀 단위 (container 없으면 window). */
  scroll:
    | { to: Selector; block?: "start" | "center" | "end" | "nearest" }
    | { by: { x?: number; y?: number }; container?: string };
}
```

`FlowStep` union에 `| ScrollStep` 추가.

`compileStep`의 `if ("osTap" in step)` 아래에:

```ts
  if ("scroll" in step) {
    return compileScroll(step.scroll, index);
  }
```

함수 추가 (compileOsTap 아래):

```ts
function compileScroll(spec: ScrollStep["scroll"], index: number): string {
  if ("to" in spec) {
    const sel = selectorSnippet(spec.to);
    const block = JSON.stringify(spec.block ?? "center");
    return `
      const __t = performance.now();
      const __el = ${sel};
      if (!__el) {
        const __sim = ${fuzzyCandidatesSnippet()};
        marks.push({ i: ${index}, kind: 'scroll', ok: false, ms: Math.round(performance.now() - __t), error: 'SELECTOR_NOT_FOUND', similar: __sim });
        return { failed: ${index} };
      }
      __el.scrollIntoView({ block: ${block}, behavior: 'instant' });
      marks.push({ i: ${index}, kind: 'scroll', ok: true, ms: Math.round(performance.now() - __t) });
    `;
  }
  const x = spec.by.x ?? 0;
  const y = spec.by.y ?? 0;
  if (spec.container) {
    return `
      const __t = performance.now();
      const __c = document.querySelector(${escJson(spec.container)});
      if (!__c) {
        marks.push({ i: ${index}, kind: 'scroll', ok: false, ms: Math.round(performance.now() - __t), error: 'SELECTOR_NOT_FOUND' });
        return { failed: ${index} };
      }
      __c.scrollBy({ left: ${x}, top: ${y}, behavior: 'instant' });
      marks.push({ i: ${index}, kind: 'scroll', ok: true, ms: Math.round(performance.now() - __t) });
    `;
  }
  return `
    const __t = performance.now();
    window.scrollBy({ left: ${x}, top: ${y}, behavior: 'instant' });
    marks.push({ i: ${index}, kind: 'scroll', ok: true, ms: Math.round(performance.now() - __t) });
  `;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/flow-compiler.test.ts`
Expected: PASS

- [ ] **Step 5: 사용자 승인 후 커밋**

```bash
git add src/flow-compiler.ts tests/flow-compiler.test.ts
git commit -m "feat(flow): add scroll step (scrollIntoView / scrollBy)"
```

---

### Task 5: adb inputSwipe / inputKeyEvent

osSwipe·osKey step이 쓸 ADB 프리미티브 2개.

**Files:**
- Modify: `src/adb.ts`
- Test: `tests/adb.test.ts`

**Interfaces:**
- Produces:
  - `inputSwipe(x1: number, y1: number, x2: number, y2: number, durationMs: number, deviceId?: string): Promise<void>` → `adb shell input swipe x1 y1 x2 y2 duration`
  - `inputKeyEvent(key: string, deviceId?: string): Promise<void>` — `'BACK'`이든 `'KEYCODE_BACK'`이든 받아서 `KEYCODE_` 접두사로 정규화. `/^KEYCODE_[A-Z0-9_]+$/` 불일치 시 throw.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/adb.test.ts` — import에 `inputSwipe, inputKeyEvent` 추가 후 describe 추가:

```ts
describe('inputSwipe', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs adb shell input swipe with rounded coords and duration', async () => {
    setupExecFile('');
    await inputSwipe(100.4, 200.6, 100.4, 800.2, 300);
    expect(mockExecFile).toHaveBeenCalledWith(
      'adb',
      ['shell', 'input', 'swipe', '100', '201', '100', '800', '300'],
      expect.any(Function),
    );
  });

  it('targets specific device with -s', async () => {
    setupExecFile('');
    await inputSwipe(0, 0, 0, 100, 250, 'DEV1');
    expect(mockExecFile).toHaveBeenCalledWith(
      'adb',
      ['-s', 'DEV1', 'shell', 'input', 'swipe', '0', '0', '0', '100', '250'],
      expect.any(Function),
    );
  });
});

describe('inputKeyEvent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizes bare key name to KEYCODE_ prefix', async () => {
    setupExecFile('');
    await inputKeyEvent('back');
    expect(mockExecFile).toHaveBeenCalledWith(
      'adb',
      ['shell', 'input', 'keyevent', 'KEYCODE_BACK'],
      expect.any(Function),
    );
  });

  it('passes through already-prefixed keycode', async () => {
    setupExecFile('');
    await inputKeyEvent('KEYCODE_ENTER', 'DEV1');
    expect(mockExecFile).toHaveBeenCalledWith(
      'adb',
      ['-s', 'DEV1', 'shell', 'input', 'keyevent', 'KEYCODE_ENTER'],
      expect.any(Function),
    );
  });

  it('rejects invalid keycode strings', async () => {
    await expect(inputKeyEvent('BACK; rm -rf /')).rejects.toThrow('유효하지 않은 keycode');
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/adb.test.ts`
Expected: FAIL — `inputSwipe`/`inputKeyEvent` export 없음

- [ ] **Step 3: 구현**

`src/adb.ts` 끝에 추가:

```ts
export async function inputSwipe(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs: number,
  deviceId?: string,
): Promise<void> {
  const coords = [x1, y1, x2, y2].map((v) => Math.round(v).toString());
  const swipeArgs = ['shell', 'input', 'swipe', ...coords, Math.round(durationMs).toString()];
  const args = deviceId ? ['-s', deviceId, ...swipeArgs] : swipeArgs;
  await execFile('adb', args);
}

export async function inputKeyEvent(key: string, deviceId?: string): Promise<void> {
  const keycode = key.startsWith('KEYCODE_') ? key : `KEYCODE_${key.toUpperCase()}`;
  if (!/^KEYCODE_[A-Z0-9_]+$/.test(keycode)) {
    throw new Error(`유효하지 않은 keycode: ${key}`);
  }
  const keyArgs = ['shell', 'input', 'keyevent', keycode];
  const args = deviceId ? ['-s', deviceId, ...keyArgs] : keyArgs;
  await execFile('adb', args);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/adb.test.ts`
Expected: PASS

- [ ] **Step 5: 사용자 승인 후 커밋**

```bash
git add src/adb.ts tests/adb.test.ts
git commit -m "feat(adb): add inputSwipe and inputKeyEvent primitives"
```

---

### Task 6: control 채널 일반화 + osSwipe step

osTap 전용이던 "Node 레이어 실행 신호"를 `control: { type, i, ... }`로 일반화하고, 그 위에 osSwipe를 얹는다. **기존 osTap 계약이 바뀌므로 관련 테스트도 함께 갱신.**

**Files:**
- Modify: `src/flow-compiler.ts`, `src/tools/flow.ts`
- Test: `tests/flow-compiler.test.ts`, `tests/tools/flow.test.ts`

**Interfaces:**
- Produces (컴파일 결과 → flowHandler 계약):
  ```ts
  // flow-compiler가 반환하는 세그먼트 결과의 control 필드
  type ControlSignal =
    | { type: 'osTap'; i: number; x: number; y: number; selector: unknown }
    | { type: 'osSwipe'; i: number; x1: number; y1: number; x2: number; y2: number; durationMs: number };
  // (Task 7에서 osKey, Task 8에서 nav 추가)
  ```
  ```ts
  export interface OsSwipeStep {
    osSwipe: {
      direction: 'up' | 'down' | 'left' | 'right'; // 손가락 이동 방향 (up = 콘텐츠 아래로 스크롤)
      distance?: number;   // CSS px. 기본: 해당 축 viewport의 40%
      durationMs?: number; // 기본 300
      from?: Selector;     // 시작점 요소. 기본: viewport 중앙
    };
  }
  ```
- Consumes: Task 5의 `inputSwipe`.

- [ ] **Step 1: 실패하는 테스트 작성 (compiler)**

`tests/flow-compiler.test.ts`의 기존 osTap 테스트에서 결과 필드를 `osTap` → `control`로 바꾼다. 기존 osTap describe를 확인해 `result.osTap`을 참조하는 단언을 아래 형태로 수정:

```ts
    expect(result.control).toMatchObject({ type: "osTap", i: 0 });
```

osSwipe describe 추가:

```ts
describe("compileFlow — osSwipe", () => {
  it("returns control signal with dpr-scaled coords for direction up", async () => {
    const result = (await evalFlow("<div></div>", [
      { osSwipe: { direction: "up", distance: 200, durationMs: 250 } },
    ])) as {
      marks: { kind: string; ok: boolean }[];
      control?: { type: string; x1: number; y1: number; x2: number; y2: number; durationMs: number };
    };
    expect(result.marks[0]).toMatchObject({ kind: "osSwipe", ok: true });
    expect(result.control?.type).toBe("osSwipe");
    expect(result.control?.durationMs).toBe(250);
    // up = 손가락이 위로 → y2 < y1, x 동일
    expect(result.control!.y2).toBeLessThan(result.control!.y1);
    expect(result.control!.x2).toBe(result.control!.x1);
    expect(result.control!.y1 - result.control!.y2).toBe(200); // dpr=1 가정 (happy-dom)
  });

  it("fails with SELECTOR_NOT_FOUND when from selector missing", async () => {
    const result = (await evalFlow("<div></div>", [
      { osSwipe: { direction: "down", from: "#missing" } },
    ])) as { marks: { error?: string }[]; failedAt?: number };
    expect(result.marks[0].error).toBe("SELECTOR_NOT_FOUND");
    expect(result.failedAt).toBe(0);
  });

  it("steps after osSwipe are not executed in the same segment", async () => {
    const result = (await evalFlow('<button id="x">Hi</button>', [
      { osSwipe: { direction: "up" } },
      { click: "#x" },
    ])) as { marks: unknown[]; control?: unknown };
    expect(result.marks).toHaveLength(1);
    expect(result.control).toBeDefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/flow-compiler.test.ts`
Expected: FAIL — osTap 수정 테스트(`control` undefined) + osSwipe 테스트(`INVALID_STEP`)

- [ ] **Step 3: compiler 구현**

`src/flow-compiler.ts`:

1. `OsSwipeStep` 인터페이스 추가 (위 Interfaces 블록 그대로, 큰따옴표 스타일로) + `FlowStep` union에 `| OsSwipeStep` 추가.

2. `compileOsTap`의 마지막 return 줄 교체:

```ts
    return { control: { type: 'osTap', i: ${index}, x: __cx, y: __cy, selector: ${JSON.stringify(selector)} } };
```

3. `compileStep`에 분기 추가 (`"scroll"` 분기 아래):

```ts
  if ("osSwipe" in step) {
    return compileOsSwipe(step.osSwipe, index);
  }
```

4. 함수 추가:

```ts
function compileOsSwipe(spec: OsSwipeStep["osSwipe"], index: number): string {
  const durationMs = spec.durationMs ?? 300;
  const fromSnippet = spec.from ? selectorSnippet(spec.from) : "null";
  const distExpr =
    spec.distance !== undefined
      ? String(spec.distance)
      : `(__axis === 'left' || __axis === 'right' ? __vw : __vh) * 0.4`;
  return `
    const __t = performance.now();
    const __from = ${fromSnippet};
    ${
      spec.from
        ? `if (!__from) { marks.push({ i: ${index}, kind: 'osSwipe', ok: false, ms: Math.round(performance.now() - __t), error: 'SELECTOR_NOT_FOUND' }); return { failed: ${index} }; }`
        : ""
    }
    const __vw = window.innerWidth, __vh = window.innerHeight;
    let __sx = __vw / 2, __sy = __vh / 2;
    if (__from) { const __r = __from.getBoundingClientRect(); __sx = __r.x + __r.width / 2; __sy = __r.y + __r.height / 2; }
    const __axis = ${JSON.stringify(spec.direction)};
    const __dist = ${distExpr};
    let __ex = __sx, __ey = __sy;
    if (__axis === 'up') __ey = __sy - __dist;
    else if (__axis === 'down') __ey = __sy + __dist;
    else if (__axis === 'left') __ex = __sx - __dist;
    else __ex = __sx + __dist;
    const __dpr = window.devicePixelRatio || 1;
    marks.push({ i: ${index}, kind: 'osSwipe', ok: true, ms: Math.round(performance.now() - __t) });
    return { control: { type: 'osSwipe', i: ${index}, x1: Math.round(__sx * __dpr), y1: Math.round(__sy * __dpr), x2: Math.round(__ex * __dpr), y2: Math.round(__ey * __dpr), durationMs: ${durationMs} } };
  `;
}
```

5. `compileFlow` 래퍼의 osTap 변수를 control로 일반화:

```ts
  const stepsCode = input.steps
    .map(
      (step, i) =>
        `await (async () => { ${compileStep(step, i + startIndex)} })().then((r) => {
          if (r && r.failed !== undefined) failed = r.failed;
          if (r && r.control !== undefined) control = r.control;
        });
        if (control !== null) return;
${bail === "on-error" ? `if (failed !== null) return;` : ""}`,
    )
    .join("\n");

  return `(async () => {
    const __t0 = performance.now();
    const marks = [];
    let captured = null;
    let failed = null;
    let control = null;
    await (async () => {
      ${stepsCode}
    })();
    const result = { marks, totalMs: Math.round(performance.now() - __t0) };
    if (captured !== null) result.captured = captured;
    if (control !== null) result.control = control;
    if (failed !== null) {
      result.failedAt = failed;
      result.snapshot = ${SNAPSHOT_JS};
    }
    return result;
  })()`;
```

`CompileFlowOptions`의 startIndex 주석에서 "osTap 후" → "control step(osTap/osSwipe 등) 후"로 갱신.

- [ ] **Step 4: compiler 테스트 통과 확인**

Run: `npx vitest run tests/flow-compiler.test.ts`
Expected: PASS

- [ ] **Step 5: 실패하는 테스트 작성 (handler)**

`tests/tools/flow.test.ts`:

1. adb mock에 `inputSwipe` 추가:

```ts
vi.mock('../../src/adb.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/adb.js')>();
  return {
    ...actual,
    inputTap: vi.fn().mockResolvedValue(undefined),
    inputSwipe: vi.fn().mockResolvedValue(undefined),
    inputKeyEvent: vi.fn().mockResolvedValue(undefined),
  };
});
```

2. 기존 osTap 오케스트레이션 테스트의 fake 세그먼트를 새 계약으로 교체 — `osTap: { i: 1, x: 100, y: 200, selector: '#btn' }` → `control: { type: 'osTap', i: 1, x: 100, y: 200, selector: '#btn' }` (두 테스트 모두). 마지막 단언도 `expect(parsed.control).toBeUndefined();`로 교체.

3. osSwipe 테스트 추가:

```ts
  it('executes adb inputSwipe and resumes remaining steps', async () => {
    const segment1 = {
      marks: [{ i: 0, kind: 'osSwipe', ok: true, ms: 1 }],
      totalMs: 1,
      control: { type: 'osSwipe', i: 0, x1: 540, y1: 1200, x2: 540, y2: 400, durationMs: 300 },
    };
    const segment2 = {
      marks: [{ i: 1, kind: 'capture', ok: true, ms: 1 }],
      totalMs: 1,
      captured: { url: '/list' },
    };
    stateModule.state.cdp = makeFakeCdpQueue([segment1, segment2]) as any;
    stateModule.state.deviceId = 'TESTDEV';

    const result = await flowHandler({
      steps: [{ osSwipe: { direction: 'up' } }, { capture: { url: true } }] as any,
    });

    expect(adbModule.inputSwipe).toHaveBeenCalledWith(540, 1200, 540, 400, 300, 'TESTDEV');
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.marks.map((m: any) => m.kind)).toEqual(['osSwipe', 'capture']);
    expect(parsed.captured?.url).toBe('/list');
  });
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run tests/tools/flow.test.ts`
Expected: FAIL — flowHandler가 `segment.control`을 몰라서 osTap/osSwipe 모두 미실행

- [ ] **Step 7: handler 구현**

`src/tools/flow.ts`:

import 교체:

```ts
import { inputTap, inputSwipe, inputKeyEvent } from '../adb.js';
```

`SegmentResult` 교체:

```ts
type ControlSignal =
  | { type: 'osTap'; i: number; x: number; y: number; selector: unknown }
  | { type: 'osSwipe'; i: number; x1: number; y1: number; x2: number; y2: number; durationMs: number };

interface SegmentResult {
  marks: unknown[];
  totalMs: number;
  captured?: Record<string, unknown>;
  control?: ControlSignal;
  failedAt?: number;
  snapshot?: unknown;
}
```

루프 안의 `if (segment.osTap) { ... }` 블록 교체:

```ts
      if (segment.control) {
        const c = segment.control;
        if (c.type === 'osTap') {
          await inputTap(c.x, c.y, state.deviceId ?? undefined);
        } else if (c.type === 'osSwipe') {
          await inputSwipe(c.x1, c.y1, c.x2, c.y2, c.durationMs, state.deviceId ?? undefined);
        }
        const consumedCount = c.i - startIndex + 1;
        remainingSteps = remainingSteps.slice(consumedCount);
        startIndex = c.i + 1;
        continue;
      }
```

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run tests/tools/flow.test.ts tests/flow-compiler.test.ts`
Expected: PASS

- [ ] **Step 9: 사용자 승인 후 커밋**

```bash
git add src/flow-compiler.ts src/tools/flow.ts tests/flow-compiler.test.ts tests/tools/flow.test.ts
git commit -m "feat(flow): generalize control channel + add osSwipe step"
```

---

### Task 7: osKey step (Back/Enter 등 OS 키 이벤트)

**Files:**
- Modify: `src/flow-compiler.ts`, `src/tools/flow.ts`
- Test: `tests/flow-compiler.test.ts`, `tests/tools/flow.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface OsKeyStep {
    /** ADB keyevent. 'BACK', 'ENTER', 'HOME' 또는 'KEYCODE_BACK' 형식. */
    osKey: string;
  }
  ```
  ControlSignal에 `{ type: 'osKey'; i: number; key: string }` 추가.
- Consumes: Task 5의 `inputKeyEvent`, Task 6의 control 채널.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/flow-compiler.test.ts`:

```ts
describe("compileFlow — osKey", () => {
  it("returns osKey control signal and halts segment", async () => {
    const result = (await evalFlow("<div></div>", [
      { osKey: "BACK" },
      { sleep: 1 },
    ])) as { marks: { kind: string; ok: boolean }[]; control?: { type: string; key: string } };
    expect(result.marks).toHaveLength(1);
    expect(result.marks[0]).toMatchObject({ kind: "osKey", ok: true });
    expect(result.control).toMatchObject({ type: "osKey", key: "BACK", i: 0 });
  });
});
```

`tests/tools/flow.test.ts`:

```ts
  it('executes adb inputKeyEvent for osKey control', async () => {
    const segment1 = {
      marks: [{ i: 0, kind: 'osKey', ok: true, ms: 0, key: 'BACK' }],
      totalMs: 0,
      control: { type: 'osKey', i: 0, key: 'BACK' },
    };
    const segment2 = { marks: [{ i: 1, kind: 'sleep', ok: true, ms: 1 }], totalMs: 1 };
    stateModule.state.cdp = makeFakeCdpQueue([segment1, segment2]) as any;
    stateModule.state.deviceId = 'TESTDEV';

    const result = await flowHandler({ steps: [{ osKey: 'BACK' }, { sleep: 1 }] as any });

    expect(adbModule.inputKeyEvent).toHaveBeenCalledWith('BACK', 'TESTDEV');
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.marks.map((m: any) => m.kind)).toEqual(['osKey', 'sleep']);
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/flow-compiler.test.ts tests/tools/flow.test.ts`
Expected: FAIL — osKey가 INVALID_STEP / inputKeyEvent 미호출

- [ ] **Step 3: 구현**

`src/flow-compiler.ts`:

```ts
export interface OsKeyStep {
  /** ADB keyevent. 'BACK', 'ENTER', 'HOME' 또는 'KEYCODE_BACK' 형식. flowHandler가 ADB로 실행. */
  osKey: string;
}
```

`FlowStep` union에 `| OsKeyStep` 추가. `compileStep`에 분기:

```ts
  if ("osKey" in step) {
    return `
      marks.push({ i: ${index}, kind: 'osKey', ok: true, ms: 0, key: ${JSON.stringify(step.osKey)} });
      return { control: { type: 'osKey', i: ${index}, key: ${JSON.stringify(step.osKey)} } };
    `;
  }
```

`src/tools/flow.ts` — `ControlSignal`에 추가:

```ts
  | { type: 'osKey'; i: number; key: string }
```

control 분기에 추가:

```ts
        } else if (c.type === 'osKey') {
          await inputKeyEvent(c.key, state.deviceId ?? undefined);
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/flow-compiler.test.ts tests/tools/flow.test.ts`
Expected: PASS

- [ ] **Step 5: 사용자 승인 후 커밋**

```bash
git add src/flow-compiler.ts src/tools/flow.ts tests/flow-compiler.test.ts tests/tools/flow.test.ts
git commit -m "feat(flow): add osKey step for OS key events (Back/Enter/...)"
```

---

### Task 8: goto 확장 — 진짜 네비게이션 (Page.navigate / Page.reload)

`{ goto: '/path' }`(문자열)는 기존 SPA 라우팅 그대로. `{ goto: { url, reload?, timeout? } }`(객체)는 CDP `Page.navigate`/`Page.reload`로 실제 네비게이션 후 `document.readyState === 'complete'`까지 폴링 대기.

**Files:**
- Modify: `src/flow-compiler.ts`, `src/tools/flow.ts`
- Test: `tests/flow-compiler.test.ts`, `tests/tools/flow.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GotoStep {
    goto: string | { url?: string; reload?: boolean; timeout?: number };
  }
  ```
  ControlSignal에 `{ type: 'nav'; i: number; url: string; reload: boolean; timeoutMs: number }` 추가. url은 페이지 안에서 `new URL(url, location.href).href`로 절대화되어 넘어옴.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/flow-compiler.test.ts`:

```ts
describe("compileFlow — goto object (real navigation)", () => {
  it("string goto keeps SPA pushState behavior", async () => {
    const result = (await evalFlow("<div></div>", [{ goto: "/next" }])) as {
      marks: { kind: string; ok: boolean }[];
      control?: unknown;
    };
    expect(result.marks[0]).toMatchObject({ kind: "goto", ok: true });
    expect(result.control).toBeUndefined();
  });

  it("object goto with url returns nav control with absolutized url", async () => {
    const result = (await evalFlow("<div></div>", [
      { goto: { url: "/deep/link", timeout: 5000 } },
    ])) as { control?: { type: string; url: string; reload: boolean; timeoutMs: number } };
    expect(result.control).toMatchObject({
      type: "nav",
      url: "http://localhost:3000/deep/link",
      reload: false,
      timeoutMs: 5000,
    });
  });

  it("object goto with reload only returns nav control with reload=true", async () => {
    const result = (await evalFlow("<div></div>", [
      { goto: { reload: true } },
    ])) as { control?: { type: string; reload: boolean; url: string } };
    expect(result.control).toMatchObject({ type: "nav", reload: true });
  });

  it("object goto without url and reload fails as INVALID_STEP", async () => {
    const result = (await evalFlow("<div></div>", [{ goto: {} }])) as {
      marks: { error?: string }[];
      failedAt?: number;
    };
    expect(result.marks[0].error).toBe("INVALID_STEP");
    expect(result.failedAt).toBe(0);
  });
});
```

`tests/tools/flow.test.ts`:

```ts
  it('nav control triggers Page.navigate then polls readyState and resumes', async () => {
    const segment1 = {
      marks: [{ i: 0, kind: 'goto', ok: true, ms: 0, nav: 'http://x.test/a' }],
      totalMs: 0,
      control: { type: 'nav', i: 0, url: 'http://x.test/a', reload: false, timeoutMs: 5000 },
    };
    const segment2 = { marks: [{ i: 1, kind: 'sleep', ok: true, ms: 1 }], totalMs: 1 };
    // Runtime.evaluate 순서: segment1 → readyState 폴링('complete') → segment2
    const cdp = makeFakeCdpQueue([segment1, 'complete', segment2]);
    stateModule.state.cdp = cdp as any;

    const result = await flowHandler({
      steps: [{ goto: { url: 'http://x.test/a' } }, { sleep: 1 }] as any,
    });

    expect(cdp.send).toHaveBeenCalledWith('Page.navigate', { url: 'http://x.test/a' });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.marks.map((m: any) => m.kind)).toEqual(['goto', 'sleep']);
  }, 10_000);

  it('nav control with reload triggers Page.reload', async () => {
    const segment1 = {
      marks: [{ i: 0, kind: 'goto', ok: true, ms: 0 }],
      totalMs: 0,
      control: { type: 'nav', i: 0, url: 'http://x.test/', reload: true, timeoutMs: 5000 },
    };
    const cdp = makeFakeCdpQueue([segment1, 'complete']);
    stateModule.state.cdp = cdp as any;

    await flowHandler({ steps: [{ goto: { reload: true } }] as any });

    expect(cdp.send).toHaveBeenCalledWith('Page.reload', {});
  }, 10_000);
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/flow-compiler.test.ts tests/tools/flow.test.ts`
Expected: FAIL — 객체 goto가 컴파일 타임 타입/INVALID_STEP 처리 안 됨, Page.navigate 미호출

- [ ] **Step 3: 구현**

`src/flow-compiler.ts`:

`GotoStep` 교체:

```ts
export interface GotoStep {
  /** 문자열: SPA 클라이언트 라우팅 (pushState). 객체: 실제 네비게이션 (CDP Page.navigate / Page.reload). */
  goto: string | { url?: string; reload?: boolean; timeout?: number };
}
```

`compileStep`의 goto 분기 교체:

```ts
  if ("goto" in step) {
    if (typeof step.goto === "string") {
      return `
      const __t = performance.now();
      history.pushState({}, '', ${escJson(step.goto)});
      window.dispatchEvent(new PopStateEvent('popstate'));
      marks.push({ i: ${index}, kind: 'goto', ok: true, ms: Math.round(performance.now() - __t) });
    `;
    }
    return compileNav(step.goto, index);
  }
```

함수 추가:

```ts
function compileNav(
  spec: { url?: string; reload?: boolean; timeout?: number },
  index: number,
): string {
  const timeoutMs = spec.timeout ?? 10_000;
  if (!spec.url && !spec.reload) {
    return `marks.push({ i: ${index}, kind: 'goto', ok: false, error: 'INVALID_STEP', detail: 'goto 객체는 url 또는 reload가 필요합니다' }); return { failed: ${index} };`;
  }
  const urlExpr = spec.url
    ? `new URL(${escJson(spec.url)}, location.href).href`
    : "location.href";
  const reload = spec.reload && !spec.url ? "true" : "false";
  return `
    const __url = ${urlExpr};
    marks.push({ i: ${index}, kind: 'goto', ok: true, ms: 0, nav: __url });
    return { control: { type: 'nav', i: ${index}, url: __url, reload: ${reload}, timeoutMs: ${timeoutMs} } };
  `;
}
```

`src/tools/flow.ts`:

import에 errors 추가:

```ts
import { FlowError, ErrorCode } from '../errors.js';
```

`ControlSignal`에 추가:

```ts
  | { type: 'nav'; i: number; url: string; reload: boolean; timeoutMs: number }
```

파일 하단에 헬퍼 추가:

```ts
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
```

control 분기에 추가:

```ts
        } else if (c.type === 'nav') {
          if (c.reload) {
            await cdp.send('Page.reload', {});
          } else {
            await cdp.send('Page.navigate', { url: c.url });
          }
          await waitForPageLoad(cdp, c.timeoutMs);
```

(waitForPageLoad가 던지는 FlowError는 기존 catch 블록이 `[WAIT_TIMEOUT]` 포맷으로 처리)

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/flow-compiler.test.ts tests/tools/flow.test.ts`
Expected: PASS

- [ ] **Step 5: 사용자 승인 후 커밋**

```bash
git add src/flow-compiler.ts src/tools/flow.ts tests/flow-compiler.test.ts tests/tools/flow.test.ts
git commit -m "feat(flow): real navigation via goto object (Page.navigate / Page.reload)"
```

---

### Task 9: 앱 이름(패키지명)으로 WebView 선택

pid → 패키지명은 `/proc/<pid>/cmdline`으로 조회. `webview_connect`에 `app` 파라미터(부분 일치) 추가, 성공 응답에 앱 이름 표시.

**Files:**
- Modify: `src/adb.ts`, `src/discovery.ts`, `src/tools/connect.ts`
- Test: `tests/adb.test.ts`, `tests/discovery.test.ts`, `tests/tools/connect.test.ts`

**Interfaces:**
- Produces:
  - `getProcessName(pid: string, deviceId?: string): Promise<string | null>` — cmdline의 첫 null-terminated 토큰. 실패 시 null (throw 안 함).
  - `pickSocket(deviceId: string, index?: number, app?: string): Promise<Socket>` — app 지정 시 이름 부분 일치 필터, 0건이면 `NO_WEBVIEW` + extras에 후보 목록.
  - connect 툴 입력에 `app?: string`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/adb.test.ts` — import에 `getProcessName` 추가:

```ts
describe('getProcessName', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads package name from /proc/<pid>/cmdline', async () => {
    setupExecFile('com.huray.healthapp\0');
    const name = await getProcessName('12345');
    expect(name).toBe('com.huray.healthapp');
    expect(mockExecFile).toHaveBeenCalledWith(
      'adb',
      ['shell', 'cat', '/proc/12345/cmdline'],
      expect.any(Function),
    );
  });

  it('returns null when cmdline read fails', async () => {
    setupExecFileError('No such file');
    expect(await getProcessName('99999')).toBeNull();
  });
});
```

`tests/discovery.test.ts` — 기존 adb mock 방식을 확인하고 `getProcessName`을 mock에 추가한 뒤:

```ts
describe('pickSocket — app filter', () => {
  it('picks the socket whose process name contains app', async () => {
    vi.mocked(adb.findWebViewSockets).mockResolvedValue([
      { pid: '111', socketName: 'webview_devtools_remote_111' },
      { pid: '222', socketName: 'webview_devtools_remote_222' },
    ]);
    vi.mocked(adb.getProcessName).mockImplementation(async (pid) =>
      pid === '111' ? 'com.other.app' : 'com.huray.healthapp',
    );
    const socket = await pickSocket('DEV1', undefined, 'huray');
    expect(socket.pid).toBe('222');
  });

  it('throws NO_WEBVIEW with candidates when no app matches', async () => {
    vi.mocked(adb.findWebViewSockets).mockResolvedValue([
      { pid: '111', socketName: 'webview_devtools_remote_111' },
    ]);
    vi.mocked(adb.getProcessName).mockResolvedValue('com.other.app');
    await expect(pickSocket('DEV1', undefined, 'huray')).rejects.toMatchObject({
      code: 'NO_WEBVIEW',
      extras: { sockets: [{ index: 0, pid: '111', app: 'com.other.app' }] },
    });
  });
});
```

(주의: discovery.test.ts가 `vi.mock('../src/adb.js', ...)` factory 방식이면 factory 반환 객체에 `getProcessName: vi.fn()`을 추가한다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/adb.test.ts tests/discovery.test.ts`
Expected: FAIL — `getProcessName` 없음 / pickSocket 3번째 인자 무시

- [ ] **Step 3: 구현**

`src/adb.ts` 끝에:

```ts
export async function getProcessName(pid: string, deviceId?: string): Promise<string | null> {
  const catArgs = ['shell', 'cat', `/proc/${pid}/cmdline`];
  const args = deviceId ? ['-s', deviceId, ...catArgs] : catArgs;
  try {
    const stdout = await execFile('adb', args);
    const name = stdout.split('\0')[0].trim();
    return name || null;
  } catch {
    return null;
  }
}
```

`src/discovery.ts`:

import 갱신:

```ts
import { getConnectedDevices, findWebViewSockets, getProcessName } from "./adb.js";
```

`pickSocket` 교체:

```ts
export async function pickSocket(
  deviceId: string,
  index?: number,
  app?: string,
): Promise<Socket> {
  const sockets = (await findWebViewSockets(deviceId)) as Socket[];
  if (sockets.length === 0) {
    throw new FlowError(ErrorCode.NO_WEBVIEW);
  }
  if (app !== undefined) {
    const names = await Promise.all(sockets.map((s) => getProcessName(s.pid, deviceId)));
    const matchedIdx = names.findIndex((n) => n?.includes(app));
    if (matchedIdx === -1) {
      throw new FlowError(
        ErrorCode.NO_WEBVIEW,
        `앱 "${app}"에 해당하는 WebView가 없습니다.`,
        {
          sockets: sockets.map((s, i) => ({ index: i, pid: s.pid, app: names[i] })),
        },
      );
    }
    return sockets[matchedIdx];
  }
  if (sockets.length === 1) return sockets[0];
  if (index !== undefined) {
    // ... 기존 index 분기 그대로 ...
  }
  // Multiple sockets but no explicit index: default to 0.
  // 대부분 첫 socket이 메인 WebView. 다른 걸 원하면 socketIndex 또는 app으로 명시.
  return sockets[0];
}
```

`src/tools/connect.ts`:

- import에 `getProcessName` 추가 (`from "../adb.js"`).
- inputSchema properties에 추가:

```ts
      app: {
        type: "string",
        description:
          '패키지명(부분 일치)으로 WebView 선택. 예: "com.huray" 또는 "huray". socketIndex보다 우선.',
      },
```

- `ConnectArgs`에 `app?: string;` 추가.
- `pickSocket` 호출 교체: `const socket = await pickSocket(device.id, args.socketIndex, args.app);`
- 성공 응답에 앱 이름 표시 — eval 아래에:

```ts
    const appName = await getProcessName(socket.pid, device.id);
```

  응답 text의 `PID: ${socket.pid}` 줄을 다음으로 교체:

```ts
          text: `연결 성공\n기기: ${device.id}\nPID: ${socket.pid}${appName ? ` (${appName})` : ""}\nCDP 포트: ${port}\n현재 URL: ${evalResult.result.value}`,
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/adb.test.ts tests/discovery.test.ts tests/tools/connect.test.ts`
Expected: PASS. connect.test.ts가 adb mock factory를 쓰면 `getProcessName: vi.fn().mockResolvedValue(null)` 추가 필요할 수 있음.

- [ ] **Step 5: 사용자 승인 후 커밋**

```bash
git add src/adb.ts src/discovery.ts src/tools/connect.ts tests/adb.test.ts tests/discovery.test.ts tests/tools/connect.test.ts
git commit -m "feat(connect): select WebView by app package name"
```

---

### Task 10: webview_run_script에 args 주입

스크립트 복제 없이 "계정 A로 로그인" 같은 변형 실행. `globalThis.__args`로 주입 — 스크립트는 `__args.userId`처럼 참조.

**Files:**
- Modify: `src/tools/run-script.ts`
- Test: `tests/tools/run-script.test.ts`

**Interfaces:**
- Produces: run_script 입력에 `args?: Record<string, unknown>`. 실행 expression은 `globalThis.__args = <json>;\n` + 스크립트 원문. args 미지정 시 `{}` 주입 (스크립트가 항상 `__args`를 참조 가능).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/tools/run-script.test.ts`의 기존 mock 패턴(state.cdp fake + 스크립트 파일 fixture)을 확인하고, 같은 방식으로 추가:

```ts
  it('injects args as globalThis.__args before the script source', async () => {
    // 기존 테스트의 스크립트 파일 준비 패턴 재사용 (fixture 생성 or fs mock)
    const cdp = { connected: true, send: vi.fn().mockResolvedValue({ result: { value: 'ok' } }) };
    stateModule.state.cdp = cdp as any;

    await handler({ name: 'existing-fixture-name', args: { userId: 'yoon', retry: 2 } } as any);

    const expr = cdp.send.mock.calls[0][1].expression as string;
    expect(expr.startsWith('globalThis.__args = {"userId":"yoon","retry":2};\n')).toBe(true);
  });

  it('injects empty object when args omitted', async () => {
    const cdp = { connected: true, send: vi.fn().mockResolvedValue({ result: { value: 'ok' } }) };
    stateModule.state.cdp = cdp as any;

    await handler({ name: 'existing-fixture-name' });

    const expr = cdp.send.mock.calls[0][1].expression as string;
    expect(expr.startsWith('globalThis.__args = {};\n')).toBe(true);
  });
```

(`'existing-fixture-name'`은 기존 테스트가 쓰는 스크립트 fixture 이름으로 교체. 기존 테스트에 fixture가 없으면 그 파일의 성공 케이스 준비 방식을 그대로 따른다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/tools/run-script.test.ts`
Expected: FAIL — expression이 스크립트 원문 그대로 시작

- [ ] **Step 3: 구현**

`src/tools/run-script.ts`:

inputSchema properties에 추가:

```ts
      args: {
        type: 'object',
        description:
          '스크립트에 주입할 파라미터 객체. 스크립트 안에서 __args로 참조. 예: { "userId": "a@b.c" } → __args.userId',
      },
```

handler 시그니처와 실행부 수정:

```ts
export async function handler(args: { name: string; args?: Record<string, unknown> }) {
```

`const cdp = await ensureConnected();` 위(source 읽기 성공 후)에:

```ts
    const expression = `globalThis.__args = ${JSON.stringify(args.args ?? {})};\n${source}`;
```

`cdp.send('Runtime.evaluate', ...)`의 `expression: source` → `expression,`으로 교체.

description(툴 설명)도 한 줄 보강:

```ts
  description:
    '저장된 매크로 스크립트(.webview-scripts/{name}.webview.js)를 WebView에서 실행합니다. 긴 스크립트를 매번 토큰으로 보낼 필요 없이 이름만으로 실행합니다. args로 파라미터를 넘기면 스크립트에서 __args로 참조할 수 있습니다.',
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/tools/run-script.test.ts`
Expected: PASS

- [ ] **Step 5: 사용자 승인 후 커밋**

```bash
git add src/tools/run-script.ts tests/tools/run-script.test.ts
git commit -m "feat(run-script): parameterize macros via args (__args injection)"
```

---

### Task 11: 툴 설명·INSTRUCTIONS 갱신 + 최종 검증

새 기능이 MCP 클라이언트(LLM)에게 보이도록 설명 문자열을 갱신하고 전체 검증.

**Files:**
- Modify: `src/tools/flow.ts` (definition.description / steps description), `src/index.ts` (INSTRUCTIONS)

**Interfaces:** 없음 (문서 문자열만).

- [ ] **Step 1: flow definition 갱신**

`src/tools/flow.ts`의 `definition.description` 끝에 추가:

```
스크롤은 scroll(JS)/osSwipe(ADB), OS 키는 osKey, 실제 네비게이션(새로고침/딥링크)은 goto 객체 형태 사용. flow 중 발생한 console error/warning은 결과의 console 필드에 자동 첨부.
```

`steps` property description의 step 나열을 다음으로 교체:

```
FlowStep 배열. 각 요소는 click/type/waitFor/sleep/goto/capture/raw/assert/inspect/osTap/scroll/osSwipe/osKey 중 하나.
```

그리고 예시 추가 (기존 inspect/osTap 예시 문장 뒤):

```
scroll 예: `{ scroll: { to: '#footer' } }` 또는 `{ scroll: { by: { y: 500 }, container: '#list' } }`. osSwipe 예: `{ osSwipe: { direction: 'up' } }` (손가락 방향, ADB input swipe). osKey 예: `{ osKey: 'BACK' }` (ADB keyevent). 실제 네비게이션 예: `{ goto: { url: '/deep/link' } }` 또는 `{ goto: { reload: true } }` — SPA 라우팅은 기존처럼 문자열 `{ goto: '/path' }`.
```

- [ ] **Step 2: INSTRUCTIONS 갱신**

`src/index.ts`의 INSTRUCTIONS에 섹션 추가 — `## 2-2` 뒤에:

```
## 2-3. 스크롤 — scroll(JS) vs osSwipe(ADB)
- 요소가 DOM에 이미 있고 스크롤만 필요 → \`{ scroll: { to: '#target' } }\` 또는 \`{ scroll: { by: { y: 500 } } }\` (container 옵션으로 내부 스크롤 영역 지정).
- 무한스크롤/pull-to-refresh/네이티브 제스처가 필요 → \`{ osSwipe: { direction: 'up' } }\` (ADB input swipe, direction은 손가락 이동 방향 — up이면 아래 콘텐츠가 드러남).

## 2-4. OS 키 이벤트는 osKey step
Android Back 버튼 검증, 검색 Enter 제출 등: \`{ osKey: 'BACK' }\`, \`{ osKey: 'ENTER' }\` (type step 뒤에). ADB keyevent로 실행되므로 진짜 OS 이벤트.

## 2-5. 네비게이션 — goto 문자열 vs 객체
- SPA 클라이언트 라우팅(같은 앱 내 이동): \`{ goto: '/path' }\` (pushState, 기존 동작).
- 새로고침/딥링크/다른 origin: \`{ goto: { url: '...', timeout?: 10000 } }\` 또는 \`{ goto: { reload: true } }\` — CDP Page.navigate/reload 후 load 완료까지 자동 대기.

## 2-6. flow 실패 진단은 console 필드부터
flow 결과에 \`console\` 필드가 있으면 실행 중 발생한 JS 에러/console.error/warning 목록입니다. 실패 원인의 절반은 DOM이 아니라 JS 에러 — snapshot보다 먼저 확인하세요.
```

`## 6. 디바이스 선택 절차` 섹션에 한 줄 추가:

```
WebView가 여러 개면 socketIndex(숫자) 대신 \`webview_connect({ app: 'com.huray' })\`처럼 패키지명 부분 일치로 선택 가능.
```

매크로 관련 언급이 있으면 (없으면 ## 5 앞에 짧게) run_script args 한 줄:

```
매크로 변형 실행은 스크립트 복제 대신 \`webview_run_script({ name, args: {...} })\` — 스크립트에서 __args로 참조.
```

- [ ] **Step 3: 전체 검증**

Run: `npm test && npm run build`
Expected: 모든 테스트 PASS + tsc 에러 없음

- [ ] **Step 4: 사용자 승인 후 커밋**

```bash
git add src/tools/flow.ts src/index.ts
git commit -m "docs(instructions): document scroll/osSwipe/osKey/nav/app/args capabilities"
```

---

## Self-Review 결과

- **Spec coverage:** 6건 모두 매핑 — 콘솔 수집(Task 1~3), 스크롤/스와이프(Task 4~6), 키 이벤트(Task 5, 7), 진짜 네비게이션(Task 8), 앱 이름 선택(Task 9), 매크로 args(Task 10). 문서화(Task 11).
- **알려진 리스크:**
  - happy-dom의 `scrollIntoView`/`scrollBy` 미구현 가능성 → Task 4 Step 1에 폴리필 fallback 명시.
  - 기존 테스트 파일(discovery/connect/run-script)의 mock 세부가 계획 가정과 다를 수 있음 → 각 Task에 "기존 패턴 확인 후 동일 방식" 지침 포함.
  - `tests/cdp.test.ts`의 fetch mock이 배열이 아닌 객체를 반환하는 등 baseline이 red일 가능성 → Global Constraints의 baseline 확인 단계에서 걸러냄.
- **Type consistency:** `ControlSignal`의 네 타입(osTap/osSwipe/osKey/nav)은 Task 6에서 도입, 7·8에서 확장 — 필드명(`i`, `x1/y1/x2/y2`, `key`, `url/reload/timeoutMs`)이 compiler 산출물과 handler 소비부에서 동일한지 교차 확인 완료.
