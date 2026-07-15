# iOS WebView 지원 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** webview-test MCP를 안드로이드 전용에서 안드로이드 + iOS(Safari/WKWebView) 완전 패리티로 확장한다.

**Architecture:** CDP 명령을 wire에 싣는 방식을 `Transport` 인터페이스로 분리한다(B안: Transport seam). 안드로이드는 `RawTransport`(현행 그대로), iOS는 `IosTargetTransport`가 명령을 `Target.sendMessageToTarget`으로 감싸고 `Target.dispatchMessageFromTarget`을 풀어준다. `CdpClient`는 Transport를 팩토리로 주입받아 요청/응답 상관·이벤트 라우팅만 담당한다. iOS 연결은 플러그인이 `ios-webkit-debug-proxy`를 자동 spawn/정리한다.

**Tech Stack:** TypeScript (ESM), `ws`, `@modelcontextprotocol/sdk`, vitest, `ios-webkit-debug-proxy` + `libimobiledevice`(brew, macOS 전용).

## Global Constraints

- ESM 모듈 (`"type": "module"`) — 상대 import는 반드시 `.js` 확장자 사용.
- 안드로이드 런타임 동작 불변 — 기존 vitest 스위트 전부 green 유지가 각 리팩터 태스크의 회귀 게이트.
- 순수 로직(래핑/언래핑/타겟 선택/플랫폼 파싱)은 실기기 없이 단위테스트 — TDD.
- 커밋 메시지: 레포 관행인 `[타입] 핵심` 한 줄 (예: `[기능]`, `[리팩터]`, `[테스트]`). Claude 서명 금지.
- macOS 전용 (proxy가 `usbmuxd` 의존). Windows/Linux·iOS 시뮬레이터는 비목표.
- iOS `Page.captureScreenshot` 미지원 → `Page.snapshotRect` 사용.
- iOS 명령은 `Target.sendMessageToTarget`으로 래핑 필수, 응답/이벤트는 `Target.dispatchMessageFromTarget`으로 래핑되어 옴.

---

## File Structure

| 파일 | 상태 | 책임 |
|------|------|------|
| `src/transport.ts` | 🆕 | `Transport` 인터페이스 + `RawTransport` + `IosTargetTransport` + 순수 헬퍼 `wrapForTarget`/`unwrapFromTarget` |
| `src/cdp.ts` | ✏️ | `CdpClient`가 Transport를 팩토리 주입받도록 리팩터 + `selectTarget` 추가 |
| `src/platform.ts` | 🆕 | `detectPlatform()` — 연결된 android/ios 판별 |
| `src/ios.ts` | 🆕 | `ios-webkit-debug-proxy` 생명주기 + 기기/페이지 탐지 |
| `src/tools/connect.ts` | ✏️ | `platform` 파라미터 + android/ios 라우팅 |
| `src/tools/screenshot.ts` | ✏️ | iOS `snapshotRect` 분기 |
| `src/state.ts` | ✏️ | platform 저장 + 플랫폼별 재연결 |
| `src/console-log.ts` | ✏️ | iOS 콘솔 이벤트 매핑 |
| `src/errors.ts` | ✏️ | `IOS_TOOLING_MISSING`, `PLATFORM_AMBIGUOUS` 코드 추가 |
| `src/index.ts` | ✏️ | SIGINT 정리 시 `stopProxy` 호출 |

---

## Task 1: transport.ts 인터페이스 + 순수 헬퍼

**Files:**
- Create: `src/transport.ts`
- Test: `tests/transport.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  ```ts
  export interface CdpOutbound { id: number; method: string; params?: Record<string, unknown>; }
  export interface CdpInbound {
    id?: number; result?: unknown; error?: { code: number; message: string };
    method?: string; params?: Record<string, unknown>;
  }
  export interface Transport {
    connect(): Promise<void>;
    send(msg: CdpOutbound): void;
    onMessage(cb: (msg: CdpInbound) => void): void;
    onClose(cb: () => void): void;
    close(): void;
  }
  export type Unwrapped =
    | { kind: 'message'; msg: CdpInbound }
    | { kind: 'targetCreated'; targetId: string; type: string }
    | { kind: 'targetDestroyed'; targetId: string }
    | { kind: 'other' };
  export function wrapForTarget(targetId: string, msg: CdpOutbound): CdpOutbound;
  export function unwrapFromTarget(raw: Record<string, unknown>): Unwrapped;
  ```

- [ ] **Step 1: Write the failing test**

`tests/transport.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { wrapForTarget, unwrapFromTarget } from '../src/transport.js';

describe('wrapForTarget', () => {
  it('wraps a CDP command into Target.sendMessageToTarget with stringified inner message', () => {
    const wrapped = wrapForTarget('page-1', { id: 7, method: 'Runtime.evaluate', params: { expression: '1+1' } });
    expect(wrapped.method).toBe('Target.sendMessageToTarget');
    expect(wrapped.params!.targetId).toBe('page-1');
    expect(JSON.parse(wrapped.params!.message as string)).toEqual({
      id: 7, method: 'Runtime.evaluate', params: { expression: '1+1' },
    });
  });
});

describe('unwrapFromTarget', () => {
  it('extracts inner CDP message from Target.dispatchMessageFromTarget', () => {
    const inner = { id: 7, result: { result: { value: 2 } } };
    const res = unwrapFromTarget({
      method: 'Target.dispatchMessageFromTarget',
      params: { targetId: 'page-1', message: JSON.stringify(inner) },
    });
    expect(res).toEqual({ kind: 'message', msg: inner });
  });

  it('recognizes a page targetCreated', () => {
    const res = unwrapFromTarget({
      method: 'Target.targetCreated',
      params: { targetInfo: { targetId: 'page-178', type: 'page' } },
    });
    expect(res).toEqual({ kind: 'targetCreated', targetId: 'page-178', type: 'page' });
  });

  it('recognizes targetDestroyed', () => {
    const res = unwrapFromTarget({ method: 'Target.targetDestroyed', params: { targetId: 'page-178' } });
    expect(res).toEqual({ kind: 'targetDestroyed', targetId: 'page-178' });
  });

  it('classifies an envelope ack (no method) as other', () => {
    expect(unwrapFromTarget({ id: 100, result: {} })).toEqual({ kind: 'other' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/transport.test.ts`
Expected: FAIL — `wrapForTarget is not a function` (module/exports 미존재)

- [ ] **Step 3: Write minimal implementation**

`src/transport.ts`:
```ts
export interface CdpOutbound {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface CdpInbound {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
  method?: string;
  params?: Record<string, unknown>;
}

export interface Transport {
  connect(): Promise<void>;
  send(msg: CdpOutbound): void;
  onMessage(cb: (msg: CdpInbound) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export type Unwrapped =
  | { kind: 'message'; msg: CdpInbound }
  | { kind: 'targetCreated'; targetId: string; type: string }
  | { kind: 'targetDestroyed'; targetId: string }
  | { kind: 'other' };

export function wrapForTarget(targetId: string, msg: CdpOutbound): CdpOutbound {
  return {
    id: msg.id,
    method: 'Target.sendMessageToTarget',
    params: { targetId, message: JSON.stringify(msg) },
  };
}

export function unwrapFromTarget(raw: Record<string, unknown>): Unwrapped {
  const method = raw.method as string | undefined;
  const params = (raw.params ?? {}) as Record<string, unknown>;
  if (method === 'Target.dispatchMessageFromTarget') {
    const msg = JSON.parse(params.message as string) as CdpInbound;
    return { kind: 'message', msg };
  }
  if (method === 'Target.targetCreated') {
    const info = (params.targetInfo ?? {}) as { targetId: string; type: string };
    return { kind: 'targetCreated', targetId: info.targetId, type: info.type };
  }
  if (method === 'Target.targetDestroyed') {
    return { kind: 'targetDestroyed', targetId: params.targetId as string };
  }
  return { kind: 'other' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/transport.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/transport.ts tests/transport.test.ts
git commit -m "[기능] Transport 인터페이스·Target 래핑 순수 헬퍼"
```

---

## Task 2: RawTransport (안드로이드 wire)

**Files:**
- Modify: `src/transport.ts` (add `RawTransport`)
- Test: `tests/transport.test.ts` (add describe block)

**Interfaces:**
- Consumes: `Transport`, `CdpOutbound`, `CdpInbound` (Task 1)
- Produces: `export class RawTransport implements Transport { constructor(wsUrl: string) }`

- [ ] **Step 1: Write the failing test**

`tests/transport.test.ts`에 상단 import·mock 추가 + describe 추가:
```ts
import { vi } from 'vitest';
import WebSocket from 'ws';
import { RawTransport } from '../src/transport.js';

vi.mock('ws', () => {
  const MockWebSocket = vi.fn().mockImplementation(() => {
    const listeners: Record<string, Function[]> = {};
    return {
      on(event: string, cb: Function) { (listeners[event] ??= []).push(cb); },
      send: vi.fn(),
      close: vi.fn(),
      _emit(event: string, ...args: any[]) { for (const cb of listeners[event] || []) cb(...args); },
    };
  });
  return { default: MockWebSocket };
});

describe('RawTransport', () => {
  it('resolves connect on ws open and forwards parsed messages', async () => {
    const t = new RawTransport('ws://x/1');
    const received: any[] = [];
    t.onMessage((m) => received.push(m));
    const p = t.connect();
    const ws = vi.mocked(WebSocket).mock.results[0].value;
    ws._emit('open');
    await p;
    ws._emit('message', JSON.stringify({ id: 1, result: { ok: true } }));
    expect(received).toEqual([{ id: 1, result: { ok: true } }]);
  });

  it('send serializes the raw CDP message to ws', async () => {
    const t = new RawTransport('ws://x/1');
    const p = t.connect();
    const ws = vi.mocked(WebSocket).mock.results[0].value;
    ws._emit('open');
    await p;
    t.send({ id: 3, method: 'Runtime.evaluate', params: { expression: '2' } });
    expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({ id: 3, method: 'Runtime.evaluate', params: { expression: '2' } });
  });

  it('onClose fires when ws closes', async () => {
    const t = new RawTransport('ws://x/1');
    const closed = vi.fn();
    t.onClose(closed);
    const p = t.connect();
    const ws = vi.mocked(WebSocket).mock.results[0].value;
    ws._emit('open');
    await p;
    ws._emit('close');
    expect(closed).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/transport.test.ts`
Expected: FAIL — `RawTransport is not a constructor`

- [ ] **Step 3: Write minimal implementation**

`src/transport.ts` 상단에 `import WebSocket from 'ws';` 추가 후 클래스 추가:
```ts
export class RawTransport implements Transport {
  private ws: WebSocket | null = null;
  private messageCb: (msg: CdpInbound) => void = () => {};
  private closeCb: () => void = () => {};

  constructor(private wsUrl: string) {}

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('message', (data: WebSocket.Data) => {
        this.messageCb(JSON.parse(data.toString()) as CdpInbound);
      });
      this.ws.on('close', () => this.closeCb());
      this.ws.on('error', (err: Error) => reject(err));
    });
  }

  send(msg: CdpOutbound): void {
    this.ws!.send(JSON.stringify(msg));
  }

  onMessage(cb: (msg: CdpInbound) => void): void { this.messageCb = cb; }
  onClose(cb: () => void): void { this.closeCb = cb; }

  close(): void {
    if (this.ws) { this.ws.close(); this.ws = null; }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/transport.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/transport.ts tests/transport.test.ts
git commit -m "[기능] RawTransport(안드로이드 wire) 추가"
```

---

## Task 3: CdpClient를 Transport 조립형으로 리팩터

**Files:**
- Modify: `src/cdp.ts` (전면 리팩터, 동작 보존)
- Test: `tests/cdp.test.ts` (기존 통과 확인 + selectTarget 테스트 추가)

**Interfaces:**
- Consumes: `Transport`, `CdpInbound`, `CdpOutbound`, `RawTransport` (Task 1·2)
- Produces:
  ```ts
  export type TransportFactory = (wsUrl: string) => Transport;
  export interface SelectOpts { index?: number; urlMatch?: string; }
  export interface RawTarget { type?: string; url?: string; webSocketDebuggerUrl?: string; }
  export function selectTarget(targets: RawTarget[], opts?: SelectOpts): RawTarget | undefined;
  export class CdpClient {
    constructor(makeTransport?: TransportFactory);
    connect(port: number, opts?: SelectOpts): Promise<void>;
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
    on(method: string, handler: (params: Record<string, unknown>) => void): void;
    off(method: string, handler: (params: Record<string, unknown>) => void): void;
    close(): void;
    get connected(): boolean;
    get pageUrl(): string | null;
  }
  ```

- [ ] **Step 1: Write the failing test (selectTarget)**

`tests/cdp.test.ts` 하단에 추가:
```ts
import { selectTarget } from '../src/cdp.js';

describe('selectTarget', () => {
  const android = [
    { type: 'service_worker', webSocketDebuggerUrl: 'ws://a/sw' },
    { type: 'page', url: 'https://app/', webSocketDebuggerUrl: 'ws://a/p' },
  ];
  const ios = [
    { url: 'https://m.naver.com/', webSocketDebuggerUrl: 'ws://i/1' },
    { url: 'https://google.com/', webSocketDebuggerUrl: 'ws://i/2' },
  ];

  it('picks the page target on android (ignores non-page)', () => {
    expect(selectTarget(android)?.webSocketDebuggerUrl).toBe('ws://a/p');
  });
  it('picks first ws target on ios (no type field)', () => {
    expect(selectTarget(ios)?.webSocketDebuggerUrl).toBe('ws://i/1');
  });
  it('urlMatch selects by url substring', () => {
    expect(selectTarget(ios, { urlMatch: 'google' })?.webSocketDebuggerUrl).toBe('ws://i/2');
  });
  it('index selects by position', () => {
    expect(selectTarget(ios, { index: 1 })?.webSocketDebuggerUrl).toBe('ws://i/2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cdp.test.ts`
Expected: FAIL — `selectTarget is not a function`

- [ ] **Step 3: Rewrite `src/cdp.ts`**

전체 교체:
```ts
import { Transport, CdpInbound, RawTransport } from './transport.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type TransportFactory = (wsUrl: string) => Transport;
export interface SelectOpts { index?: number; urlMatch?: string; }
export interface RawTarget { type?: string; url?: string; webSocketDebuggerUrl?: string; }

/** /json 타겟 중 page 선택. android는 type==='page', iOS는 type 필드가 없어 ws 있는 첫 타겟. */
export function selectTarget(targets: RawTarget[], opts?: SelectOpts): RawTarget | undefined {
  const pages = targets.filter(
    (t) => t.webSocketDebuggerUrl && (t.type === undefined || t.type === 'page'),
  );
  if (opts?.urlMatch) {
    const m = pages.find((t) => (t.url ?? '').includes(opts.urlMatch!));
    if (m) return m;
  }
  if (opts?.index !== undefined) return pages[opts.index];
  return pages[0];
}

export class CdpClient {
  private transport: Transport | null = null;
  private messageId = 0;
  private pending = new Map<number, PendingRequest>();
  private _connected = false;
  private eventHandlers = new Map<string, Set<(params: Record<string, unknown>) => void>>();
  private _pageUrl: string | null = null;

  constructor(private makeTransport: TransportFactory = (u) => new RawTransport(u)) {}

  get connected(): boolean { return this._connected; }
  get pageUrl(): string | null { return this._pageUrl; }

  on(method: string, handler: (params: Record<string, unknown>) => void): void {
    if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, new Set());
    this.eventHandlers.get(method)!.add(handler);
  }
  off(method: string, handler: (params: Record<string, unknown>) => void): void {
    this.eventHandlers.get(method)?.delete(handler);
  }

  async connect(port: number, opts?: SelectOpts): Promise<void> {
    const res = await fetch(`http://127.0.0.1:${port}/json`);
    if (!res.ok) throw new Error(`CDP targets endpoint returned ${res.status}`);
    const targets = (await res.json()) as RawTarget[];
    const page = selectTarget(targets, opts);
    if (!page?.webSocketDebuggerUrl) throw new Error('No page target found in CDP targets');
    this._pageUrl = page.url ?? null;

    this.transport = this.makeTransport(page.webSocketDebuggerUrl);
    this.transport.onMessage((msg) => this.handleMessage(msg));
    this.transport.onClose(() => { this._connected = false; });
    await this.transport.connect();
    this._connected = true;
  }

  private handleMessage(msg: CdpInbound): void {
    if (msg.method !== undefined) {
      const handlers = this.eventHandlers.get(msg.method);
      if (handlers) {
        for (const h of handlers) {
          try { h(msg.params ?? {}); } catch { /* 핸들러 예외 격리 */ }
        }
      }
      return;
    }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
    }
  }

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.transport || !this._connected) throw new Error('Not connected');
    const id = ++this.messageId;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.transport!.send({ id, method, params });
    });
  }

  close(): void {
    this.transport?.close();
    this.transport = null;
    this._connected = false;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Connection closed'));
    }
    this.pending.clear();
  }
}
```

- [ ] **Step 4: Run the full test suite (regression gate)**

Run: `npx vitest run`
Expected: PASS — 기존 `cdp.test.ts` 8개 + 신규 selectTarget 4개 포함 전부 green. (`cdp.test.ts`는 `new CdpClient()` 기본 팩토리가 `RawTransport`를 쓰고, mock ws가 그대로 물리므로 수정 없이 통과)

만약 `cdp.test.ts`가 실패하면: mock ws 구조가 Task 2에서 추가한 `transport.test.ts`의 mock과 충돌하지 않는지 확인(각 파일은 독립 모듈 mock). 여전히 실패 시 `cdp.test.ts`의 `client.close()` afterEach가 `transport?.close()` 경로를 타는지 점검.

- [ ] **Step 5: Commit**

```bash
git add src/cdp.ts tests/cdp.test.ts
git commit -m "[리팩터] CdpClient를 Transport 조립형으로 분리"
```

---

## Task 4: IosTargetTransport (iOS wire, Target 래핑)

**Files:**
- Modify: `src/transport.ts` (add `IosTargetTransport`)
- Test: `tests/transport.test.ts` (add describe block)

**Interfaces:**
- Consumes: `Transport`, `wrapForTarget`, `unwrapFromTarget` (Task 1)
- Produces: `export class IosTargetTransport implements Transport { constructor(wsUrl: string) }`

- [ ] **Step 1: Write the failing test**

`tests/transport.test.ts`에 추가:
```ts
import { IosTargetTransport } from '../src/transport.js';

describe('IosTargetTransport', () => {
  it('waits for page targetCreated, then wraps sends and unwraps responses', async () => {
    const t = new IosTargetTransport('ws://ios/1');
    const received: any[] = [];
    t.onMessage((m) => received.push(m));
    const p = t.connect();
    const ws = vi.mocked(WebSocket).mock.results.at(-1)!.value;
    // 페이지 타겟 announce → connect resolve
    ws._emit('message', JSON.stringify({
      method: 'Target.targetCreated', params: { targetInfo: { targetId: 'page-9', type: 'page' } },
    }));
    await p;

    // send는 Target.sendMessageToTarget으로 래핑
    t.send({ id: 5, method: 'Runtime.evaluate', params: { expression: '1' } });
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.method).toBe('Target.sendMessageToTarget');
    expect(sent.params.targetId).toBe('page-9');
    expect(JSON.parse(sent.params.message)).toMatchObject({ id: 5, method: 'Runtime.evaluate' });

    // 응답은 dispatchMessageFromTarget으로 래핑되어 도착 → 언래핑되어 onMessage로
    ws._emit('message', JSON.stringify({
      method: 'Target.dispatchMessageFromTarget',
      params: { targetId: 'page-9', message: JSON.stringify({ id: 5, result: { value: 1 } }) },
    }));
    expect(received).toContainEqual({ id: 5, result: { value: 1 } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/transport.test.ts`
Expected: FAIL — `IosTargetTransport is not a constructor`

- [ ] **Step 3: Write minimal implementation**

`src/transport.ts`에 추가:
```ts
export class IosTargetTransport implements Transport {
  private ws: WebSocket | null = null;
  private messageCb: (msg: CdpInbound) => void = () => {};
  private closeCb: () => void = () => {};
  private pageTargetId: string | null = null;
  private onPageReady: (() => void) | null = null;

  constructor(private wsUrl: string) {}

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      const timer = setTimeout(
        () => reject(new Error('iOS page target announce 타임아웃 (맥 웹 인스펙터 창을 닫으세요)')),
        5000,
      );
      this.onPageReady = () => { clearTimeout(timer); resolve(); };

      this.ws.on('message', (data: WebSocket.Data) => {
        const raw = JSON.parse(data.toString()) as Record<string, unknown>;
        const u = unwrapFromTarget(raw);
        if (u.kind === 'targetCreated' && u.type === 'page') {
          this.pageTargetId = u.targetId;
          this.onPageReady?.();
          this.onPageReady = null;
        } else if (u.kind === 'message') {
          this.messageCb(u.msg);
        }
        // targetDestroyed / other → 무시
      });
      this.ws.on('close', () => this.closeCb());
      this.ws.on('error', (err: Error) => { clearTimeout(timer); reject(err); });
    });
  }

  send(msg: CdpOutbound): void {
    if (!this.pageTargetId) throw new Error('iOS page target 미확보');
    this.ws!.send(JSON.stringify(wrapForTarget(this.pageTargetId, msg)));
  }

  onMessage(cb: (msg: CdpInbound) => void): void { this.messageCb = cb; }
  onClose(cb: () => void): void { this.closeCb = cb; }

  close(): void {
    if (this.ws) { this.ws.close(); this.ws = null; }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/transport.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/transport.ts tests/transport.test.ts
git commit -m "[기능] IosTargetTransport(Target 래핑 wire) 추가"
```

---

## Task 5: errors.ts에 iOS 에러 코드 추가

**Files:**
- Modify: `src/errors.ts`
- Test: `tests/errors.test.ts` (기존 통과 + 신규 코드 기본 메시지 확인)

**Interfaces:**
- Produces: `ErrorCode.IOS_TOOLING_MISSING`, `ErrorCode.PLATFORM_AMBIGUOUS`

- [ ] **Step 1: Write the failing test**

`tests/errors.test.ts`에 추가:
```ts
import { ErrorCode, formatError } from '../src/errors.js';

it('provides default messages for iOS error codes', () => {
  expect(formatError(ErrorCode.IOS_TOOLING_MISSING).message).toContain('ios-webkit-debug-proxy');
  expect(formatError(ErrorCode.PLATFORM_AMBIGUOUS).message).toContain('platform');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/errors.test.ts`
Expected: FAIL — `IOS_TOOLING_MISSING` 미존재

- [ ] **Step 3: Implement**

`src/errors.ts` enum에 추가:
```ts
  IOS_TOOLING_MISSING = 'IOS_TOOLING_MISSING',
  PLATFORM_AMBIGUOUS = 'PLATFORM_AMBIGUOUS',
```
`DEFAULT_MESSAGES`에 추가:
```ts
  [ErrorCode.IOS_TOOLING_MISSING]:
    'iOS 도구가 없습니다. `brew install ios-webkit-debug-proxy`로 설치하세요 (libimobiledevice 포함).',
  [ErrorCode.PLATFORM_AMBIGUOUS]:
    'Android·iOS 기기가 모두 연결되어 있습니다. webview_connect에 platform: "android" 또는 "ios"를 지정하세요.',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/errors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts tests/errors.test.ts
git commit -m "[기능] iOS 에러 코드(IOS_TOOLING_MISSING·PLATFORM_AMBIGUOUS)"
```

---

## Task 6: ios.ts — proxy 생명주기 + 기기/페이지 탐지

**Files:**
- Create: `src/ios.ts`
- Test: `tests/ios.test.ts`

**Interfaces:**
- Consumes: `ErrorCode`, `FlowError` (errors.ts)
- Produces:
  ```ts
  export interface IosPage { url: string; webSocketDebuggerUrl: string; appId?: string; }
  export function parseDeviceList(json: unknown): { deviceId: string; port: number }[];
  export function ensureProxy(): Promise<number>;   // frontend 포트 반환
  export function stopProxy(): void;
  export function getDevicePort(frontPort: number): Promise<number>;  // 첫 기기의 page-list 포트
  export function listPages(devicePort: number): Promise<IosPage[]>;
  export function hasIosTooling(): boolean;
  export function listIosDevices(): string[];        // idevice_id -l 결과
  ```

**설명:** `ensureProxy`는 이미 spawn한 proxy가 살아있으면 재사용, 아니면 충돌 없는 포트(기본 base 9330부터 탐색)로 `ios_webkit_debug_proxy -c null:<front>,:<front+1>-<front+10>`를 spawn하고 `/json` 응답까지 poll한다. 순수 파서(`parseDeviceList`)와 도구 감지(`hasIosTooling`/`listIosDevices`)만 단위테스트하고, spawn/poll은 통합(Task 11)에서 검증.

- [ ] **Step 1: Write the failing test (순수 파서)**

`tests/ios.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseDeviceList } from '../src/ios.js';

describe('parseDeviceList', () => {
  it('maps proxy frontend /json to {deviceId, port}', () => {
    const json = [{ deviceId: 'UDID-1', deviceName: 'iPhone', url: 'localhost:9331' }];
    expect(parseDeviceList(json)).toEqual([{ deviceId: 'UDID-1', port: 9331 }]);
  });
  it('returns [] for empty', () => {
    expect(parseDeviceList([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ios.test.ts`
Expected: FAIL — 모듈/함수 미존재

- [ ] **Step 3: Implement `src/ios.ts`**

```ts
import { execFileSync, spawn, ChildProcess } from 'child_process';
import { createConnection } from 'net';
import { ErrorCode, FlowError } from './errors.js';

export interface IosPage { url: string; webSocketDebuggerUrl: string; appId?: string; }

const PROXY_BIN = 'ios_webkit_debug_proxy';
let proxy: { child: ChildProcess; frontPort: number } | null = null;

export function hasIosTooling(): boolean {
  try {
    execFileSync('which', [PROXY_BIN], { stdio: 'ignore' });
    execFileSync('which', ['idevice_id'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

export function listIosDevices(): string[] {
  try {
    return execFileSync('idevice_id', ['-l'], { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

export function parseDeviceList(json: unknown): { deviceId: string; port: number }[] {
  const arr = Array.isArray(json) ? json : [];
  return arr.map((d: { deviceId: string; url: string }) => ({
    deviceId: d.deviceId,
    port: parseInt(d.url.split(':')[1], 10),
  }));
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: '127.0.0.1' });
    sock.on('connect', () => { sock.destroy(); resolve(false); });
    sock.on('error', () => resolve(true));
  });
}

async function pickFrontPort(): Promise<number> {
  for (let p = 9330; p < 9400; p += 12) {
    if (await portFree(p)) return p;
  }
  throw new FlowError(ErrorCode.CDP_FAILED, 'iOS proxy용 자유 포트를 찾지 못했습니다.');
}

async function waitForJson(frontPort: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${frontPort}/json`);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new FlowError(ErrorCode.CDP_FAILED, 'ios-webkit-debug-proxy 응답 없음.');
}

export async function ensureProxy(): Promise<number> {
  if (proxy && proxy.child.exitCode === null) return proxy.frontPort;
  if (!hasIosTooling()) throw new FlowError(ErrorCode.IOS_TOOLING_MISSING);
  const frontPort = await pickFrontPort();
  const child = spawn(PROXY_BIN, ['-c', `null:${frontPort},:${frontPort + 1}-${frontPort + 10}`], {
    stdio: 'ignore',
  });
  proxy = { child, frontPort };
  await waitForJson(frontPort);
  return frontPort;
}

export function stopProxy(): void {
  if (proxy) { proxy.child.kill(); proxy = null; }
}

export async function getDevicePort(frontPort: number): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${frontPort}/json`);
  const devices = parseDeviceList(await res.json());
  if (devices.length === 0) throw new FlowError(ErrorCode.NO_DEVICE);
  return devices[0].port;
}

export async function listPages(devicePort: number): Promise<IosPage[]> {
  const res = await fetch(`http://127.0.0.1:${devicePort}/json`);
  const pages = (await res.json()) as IosPage[];
  if (!pages || pages.length === 0) throw new FlowError(ErrorCode.NO_WEBVIEW);
  return pages;
}
```

`src/errors.ts`의 `NO_DEVICE`/`NO_WEBVIEW` 기본 메시지는 안드로이드 문구이므로, iOS 경로에서 override로 전달(Task 7에서 처리). 여기서는 코드만 재사용.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ios.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ios.ts tests/ios.test.ts
git commit -m "[기능] ios.ts proxy 생명주기·기기/페이지 탐지"
```

---

## Task 7: platform.ts — 플랫폼 자동감지

**Files:**
- Create: `src/platform.ts`
- Test: `tests/platform.test.ts`

**Interfaces:**
- Consumes: `getConnectedDevices` (adb.ts), `listIosDevices` (ios.ts)
- Produces:
  ```ts
  export type Platform = 'android' | 'ios';
  export function resolvePlatform(androidCount: number, iosCount: number): Platform;  // 순수
  export function detectPlatform(): Promise<Platform>;
  ```
  `resolvePlatform`은 순수 함수(둘 다>0 → PLATFORM_AMBIGUOUS, 안드로만 → android, iOS만 → ios, 없음 → NO_DEVICE). `detectPlatform`은 실제 adb/idevice 조회 후 `resolvePlatform` 호출.

- [ ] **Step 1: Write the failing test**

`tests/platform.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolvePlatform } from '../src/platform.js';
import { ErrorCode } from '../src/errors.js';

describe('resolvePlatform', () => {
  it('android only', () => { expect(resolvePlatform(1, 0)).toBe('android'); });
  it('ios only', () => { expect(resolvePlatform(0, 2)).toBe('ios'); });
  it('both → PLATFORM_AMBIGUOUS', () => {
    expect(() => resolvePlatform(1, 1)).toThrow(ErrorCode.PLATFORM_AMBIGUOUS);
  });
  it('none → NO_DEVICE', () => {
    expect(() => resolvePlatform(0, 0)).toThrow(ErrorCode.NO_DEVICE);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/platform.test.ts`
Expected: FAIL — 모듈 미존재

- [ ] **Step 3: Implement `src/platform.ts`**

```ts
import { getConnectedDevices } from './adb.js';
import { listIosDevices } from './ios.js';
import { ErrorCode, FlowError } from './errors.js';

export type Platform = 'android' | 'ios';

export function resolvePlatform(androidCount: number, iosCount: number): Platform {
  if (androidCount > 0 && iosCount > 0) throw new FlowError(ErrorCode.PLATFORM_AMBIGUOUS);
  if (androidCount > 0) return 'android';
  if (iosCount > 0) return 'ios';
  throw new FlowError(ErrorCode.NO_DEVICE);
}

export async function detectPlatform(): Promise<Platform> {
  const android = await getConnectedDevices().catch(() => []);
  const ios = listIosDevices();
  return resolvePlatform(android.length, ios.length);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/platform.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/platform.ts tests/platform.test.ts
git commit -m "[기능] platform.ts 플랫폼 자동감지"
```

---

## Task 8: state.ts — 플랫폼 저장 + iOS 연결/재연결

**Files:**
- Modify: `src/state.ts`
- Test: `tests/state.test.ts` (기존 통과 유지)

**Interfaces:**
- Consumes: `CdpClient` (cdp.ts), `IosTargetTransport` (transport.ts), `ensureProxy`/`getDevicePort`/`listPages`/`stopProxy` (ios.ts), `selectTarget` opts
- Produces:
  ```ts
  // ConnectionState 확장
  platform: 'android' | 'ios' | null;
  iosDevicePort: number | null;
  iosSelect: { index?: number; urlMatch?: string } | null;
  export function connectIos(select: { index?: number; urlMatch?: string }): Promise<{ cdp: CdpClient; devicePort: number; pageUrl: string | null }>;
  ```

- [ ] **Step 1: state 확장 + connectIos 헬퍼 추가**

`src/state.ts`:
- 상단 import 추가:
  ```ts
  import { IosTargetTransport } from './transport.js';
  import { ensureProxy, getDevicePort, listPages, stopProxy } from './ios.js';
  ```
- `ConnectionState`에 필드 추가: `platform: 'android' | 'ios' | null;`, `iosDevicePort: number | null;`, `iosSelect: { index?: number; urlMatch?: string } | null;`
- `state` 초기값·`resetState`에 위 3개 `null` 반영. `resetState`에서 iOS였으면 `stopProxy()` 호출:
  ```ts
  export function resetState(): void {
    if (state.platform === 'ios') stopProxy();
    state.cdp = null;
    state.deviceId = null;
    state.forwardedPort = null;
    state.socketName = null;
    state.console = null;
    state.platform = null;
    state.iosDevicePort = null;
    state.iosSelect = null;
  }
  ```
- iOS 연결 헬퍼:
  ```ts
  export async function connectIos(
    select: { index?: number; urlMatch?: string },
  ): Promise<{ cdp: CdpClient; devicePort: number; pageUrl: string | null }> {
    const frontPort = await ensureProxy();
    const devicePort = await getDevicePort(frontPort);
    // 페이지 없으면 여기서 NO_WEBVIEW로 조기 throw (cdp.connect의 generic 에러보다 친절)
    await listPages(devicePort);
    const opts: { index?: number; urlMatch?: string } = {};
    if (select.urlMatch) opts.urlMatch = select.urlMatch;
    else if (select.index !== undefined) opts.index = select.index;
    const cdp = new CdpClient((wsUrl) => new IosTargetTransport(wsUrl));
    await cdp.connect(devicePort, opts);
    return { cdp, devicePort, pageUrl: cdp.pageUrl };
  }
  ```
- `ensureConnected`의 iOS 재연결: 함수 상단에 분기 추가:
  ```ts
  export async function ensureConnected(): Promise<CdpClient> {
    if (isConnected()) return state.cdp!;
    if (state.platform === 'ios' && state.iosSelect) {
      const { cdp, devicePort } = await connectIos(state.iosSelect);
      state.cdp = cdp;
      state.iosDevicePort = devicePort;
      await attachConsole(cdp);
      return cdp;
    }
    // ... 기존 android 재연결 로직 그대로 ...
  }
  ```

- [ ] **Step 2: Run the suite (regression)**

Run: `npx vitest run tests/state.test.ts`
Expected: PASS — 기존 android 상태 테스트 불변. (신규 필드는 optional 초기화)

state.test.ts가 `ConnectionState` 완전 리터럴을 assert하면 신규 필드 3개를 기대값에 추가.

- [ ] **Step 3: Commit**

```bash
git add src/state.ts tests/state.test.ts
git commit -m "[기능] state에 플랫폼·iOS 재연결 추가"
```

---

## Task 9: connect.ts — platform 파라미터 + 라우팅

**Files:**
- Modify: `src/tools/connect.ts`

**Interfaces:**
- Consumes: `detectPlatform` (platform.ts), `connectIos` (state.ts), 기존 android 경로
- Produces: `webview_connect`가 `platform?: 'android' | 'ios'` 인자 수용

- [ ] **Step 1: connect.ts 수정**

- import 추가:
  ```ts
  import { detectPlatform, Platform } from '../platform.js';
  import { connectIos } from '../state.js';
  import { ErrorCode } from '../errors.js';
  ```
- `definition.inputSchema.properties`에 추가:
  ```ts
      platform: {
        type: 'string',
        enum: ['android', 'ios'],
        description: '연결 대상 플랫폼. 생략 시 자동감지(둘 다 연결 시 지정 필요).',
      },
  ```
- `ConnectArgs`에 `platform?: Platform;` 추가.
- `handler` 본문: reset 이후 플랫폼 분기:
  ```ts
    const platform: Platform = args.platform ?? (await detectPlatform());

    if (platform === 'ios') {
      const select = { index: args.socketIndex, urlMatch: args.app };
      const { cdp, devicePort, pageUrl } = await connectIos(select);
      const href = ((await cdp.send('Runtime.evaluate', {
        expression: 'window.location.href', returnByValue: true,
      })) as { result: { value: string } }).result.value;
      const committed = pageUrl ?? href;
      state.cdp = cdp;
      state.platform = 'ios';
      state.iosDevicePort = devicePort;
      state.iosSelect = select;
      await attachConsole(cdp);
      return {
        content: [{ type: 'text' as const,
          text: `연결 성공 (iOS)\nCDP 포트: ${devicePort}\n현재 URL: ${committed}` }],
      };
    }

    // ---- android (기존 경로) ----
    const device = await pickDevice();
    // ... 기존 코드 그대로 ...
    state.platform = 'android';   // 성공 저장 블록에 추가
  ```
  (주의: iOS `Runtime.evaluate`는 `returnByValue: true` 필요 — 안드로이드 기존 호출에는 없지만 iOS WebKit은 객체 반환 시 필요. android 기존 호출은 건드리지 않음.)

- [ ] **Step 2: Build 확인 (타입 체크)**

Run: `npx tsc --noEmit`
Expected: 타입 에러 없음

- [ ] **Step 3: 전체 유닛 회귀**

Run: `npx vitest run`
Expected: PASS (전 스위트)

- [ ] **Step 4: Commit**

```bash
git add src/tools/connect.ts
git commit -m "[기능] webview_connect platform 파라미터·iOS 라우팅"
```

---

## Task 10: screenshot.ts — iOS snapshotRect 분기

**Files:**
- Modify: `src/tools/screenshot.ts`
- Test: `tests/tools/` (스크린샷 순수 분기 헬퍼가 있으면 테스트; 없으면 통합에서 검증)

**Interfaces:**
- Consumes: `state.platform` (state.ts), `CdpClient`
- Produces: iOS면 `Page.snapshotRect`, android면 `Page.captureScreenshot`

- [ ] **Step 1: screenshot.ts 수정**

`handler` 내 캡처 부분 교체:
```ts
    import { state } from '../state.js';  // 상단 import에 state 추가

    // ... rect 계산까지 동일 ...

    let data: string;
    let mime: 'image/jpeg' | 'image/png';
    if (state.platform === 'ios') {
      // iOS: Page.captureScreenshot 미지원 → snapshotRect (dataURL 반환)
      const rect = (params.clip as Rect | undefined) ?? (await getViewportRect(cdp));
      const res = (await cdp.send('Page.snapshotRect', {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        coordinateSystem: 'Viewport',
      })) as { dataURL: string };
      const comma = res.dataURL.indexOf(',');
      data = res.dataURL.slice(comma + 1);
      mime = res.dataURL.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
    } else {
      const res = (await cdp.send('Page.captureScreenshot', params)) as { data: string };
      data = res.data;
      mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    }

    return { content: [{ type: 'image' as const, data, mimeType: mime }] };
```
`getViewportRect` 헬퍼 추가(풀스크린 시 뷰포트 크기):
```ts
async function getViewportRect(cdp: CdpClient): Promise<Rect> {
  const res = (await cdp.send('Runtime.evaluate', {
    expression: 'JSON.stringify({x:0,y:0,width:window.innerWidth,height:window.innerHeight})',
    returnByValue: true,
  })) as { result: { value: string } };
  return JSON.parse(res.result.value) as Rect;
}
```

- [ ] **Step 2: 타입 체크 + 회귀**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/tools/screenshot.ts
git commit -m "[기능] iOS 스크린샷 snapshotRect 분기"
```

---

## Task 11: console-log.ts — iOS 콘솔 이벤트 매핑 (실측 후 구현)

**Files:**
- Modify: `src/console-log.ts`
- Verify script: `scratchpad/ios-console-probe.mjs`(임시)

**미해결 항목 해소:** WebKit 콘솔 이벤트 이름이 Chrome과 다르다(`Console.messageAdded` 추정). 실기기로 실제 이벤트를 찍어 확정한 뒤 매핑한다.

- [ ] **Step 1: 실기기 프로브 — 실제 콘솔 이벤트 이름 확인**

프로브 스크립트(아래)를 실기기 연결 상태(Safari에 `console.log('probe-XYZ')` 실행하는 페이지)에서 돌려, `Target.dispatchMessageFromTarget`으로 들어오는 이벤트의 `method`를 수집:
```js
// scratchpad/ios-console-probe.mjs — ios-spike4.mjs 구조 재사용
// 연결 후 Console.enable / Runtime.enable 각각 시도하고,
// 5초간 도착하는 모든 inner 메시지의 method를 출력.
```
Run: `node scratchpad/ios-console-probe.mjs`
Expected: `Console.messageAdded` 또는 `Runtime.consoleAPICalled` 중 실제 도착하는 이름 확인 → 아래 Step에서 그 이름·페이로드 shape로 확정.

- [ ] **Step 2: ConsoleBuffer.attach에 iOS 이벤트 구독 추가**

프로브 결과가 `Console.messageAdded`인 경우(WebKit 표준) — `attach`에 추가 구독:
```ts
    // WebKit(iOS): Console.messageAdded — { message: { level, text } }
    cdp.on('Console.messageAdded', (params) => {
      const p = params as { message?: { level?: string; text?: string } };
      this.push({ kind: 'console', level: p.message?.level ?? 'log', text: (p.message?.text ?? '').slice(0, MAX_TEXT_LENGTH) });
    });
    await cdp.send('Console.enable').catch(() => {});
```
기존 `Runtime.consoleAPICalled`/`Runtime.exceptionThrown`/`Runtime.enable` 구독은 유지(android용). 두 구독을 동시에 걸어도 각 플랫폼은 자기 이벤트만 발생시키므로 중복 없음.

(프로브 결과가 `Runtime.consoleAPICalled`로 나오면 이 Task는 no-op — 기존 코드로 이미 동작. 그 사실만 커밋 메시지·docs에 기록.)

- [ ] **Step 3: 단위 테스트 추가**

`tests/console-log.test.ts`에 `Console.messageAdded` push 확인 케이스 추가(기존 mock cdp 패턴 재사용).

Run: `npx vitest run tests/console-log.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/console-log.ts tests/console-log.test.ts
git commit -m "[기능] iOS 콘솔 이벤트(Console.messageAdded) 수집"
```

---

## Task 12: index.ts — 종료 시 proxy 정리 + 빌드

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: SIGINT 정리에 stopProxy 추가**

`src/index.ts` 상단 import에 `import { stopProxy } from './ios.js';` 추가. SIGINT 핸들러 수정:
```ts
process.on('SIGINT', async () => {
  if (state.cdp) state.cdp.close();
  if (state.forwardedPort) await removeForward(state.forwardedPort).catch(() => {});
  stopProxy();
  process.exit(0);
});
```

- [ ] **Step 2: 빌드 + 전체 회귀**

Run: `npm run build && npx vitest run`
Expected: 빌드 성공, 전 테스트 PASS

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "[기능] 종료 시 ios proxy 정리"
```

---

## Task 13: 실기기 통합 검증 + 문서

**Files:**
- Create: `docs/ios-webview-verification.md`
- Modify: `README.md` (iOS 지원·사전조건 섹션)

- [ ] **Step 1: 실기기 end-to-end 검증**

사전조건: iPhone USB 연결, Safari '웹 인스펙터' ON, **맥 웹 인스펙터 창 닫힘**, Safari에 테스트 페이지 열림.

빌드된 서버로 아래 순서 검증(실패 시 해당 단계 기록):
1. `webview_connect({ platform: 'ios' })` → 연결 성공 + 현재 URL 출력
2. `webview_evaluate` → `document.title` 반환
3. `webview_get_dom` → DOM 요약
4. `webview_click` (evaluate 기반) → 요소 클릭 반영
5. `webview_screenshot` → 이미지 반환(snapshotRect)
6. 콘솔 로그가 있는 페이지에서 콘솔 수집 확인
7. `webview_flow` 다단계 시나리오 1건

- [ ] **Step 2: 회귀 — 안드로이드 스모크**

안드로이드 기기 연결 상태에서 `webview_connect`(platform 생략, 자동감지 android) → flow 1건. 기존 동작 불변 확인.

- [ ] **Step 3: 검증 문서 작성**

`docs/ios-webview-verification.md`에 사전조건·재현 절차·알려진 제약(단일 인스펙터 슬롯, macOS 전용, 시뮬레이터 미지원) 기록. `README.md`에 iOS 지원 + `brew install ios-webkit-debug-proxy` 안내 추가.

- [ ] **Step 4: Commit**

```bash
git add docs/ios-webview-verification.md README.md
git commit -m "[문서] iOS 웹뷰 지원 검증 절차·사전조건"
```

---

## Self-Review

**Spec coverage:**
- Transport seam(§3.3) → Task 1·2·3·4 ✅
- iOS 페이지 타겟 선택 fallback(§3.4) → Task 3 `selectTarget` ✅
- 연결 흐름·플랫폼 감지(§4) → Task 7·9 ✅
- proxy 생명주기(§5) → Task 6·12 ✅
- 스크린샷 분기(§6) → Task 10 ✅
- 에러 처리(§7) → Task 5(코드) + Task 9(override 전달) ✅
- 미해결 콘솔 이벤트(§8) → Task 11(프로브 후 구현) ✅
- 검증 전략(§9) → 각 Task 유닛 + Task 13 통합 ✅
- 비목표(§10) → Task 13 문서에 명시 ✅

**Placeholder scan:** 코드 스텝 전부 실제 코드 포함. Task 11만 실측 의존이나 프로브 절차 + 두 결과별 구현을 명시(placeholder 아님).

**Type consistency:** `CdpOutbound`/`CdpInbound`/`Transport`/`SelectOpts`/`selectTarget`/`connectIos` 시그니처가 Task 1·3·8·9 간 일치. `wrapForTarget`/`unwrapFromTarget` 반환형 `Unwrapped`가 Task 1·4 간 일치.

**주의:** Task 3는 `cdp.test.ts` 무수정 통과가 목표지만, 실제 실행 시 mock 충돌이 나면 mock을 파일-로컬로 유지(각 test 파일이 자체 `vi.mock('ws')`)하는 것으로 해결. Task 9의 iOS `Runtime.evaluate`는 `returnByValue: true` 필수(WebKit).

---
---

# 실기기 검증 후속 수정 (Task 13 통합검증에서 발견)

Task 13 실기기 검증 결과 핵심(connect/evaluate/dom/screenshot/console)은 작동하나, 완전 파서티를 위해 3건 수정 필요. 원인은 전부 실기기로 확정됨.

## Task 14: iOS 콜드스타트 레이스 수정 (P1)

**문제(실측):** `ios-webkit-debug-proxy`가 완전히 종료된 상태에서 새로 spawn하면, 기기 인스펙터가 cold라 첫 `listPages`가 빈 목록을 받아 `NO_WEBVIEW`로 실패한다(재현율 높음, connect flaky). 아무 proxy나 살아있으면 warm. 재시도가 없는 게 원인.

**해결:** ios.ts에 페이지가 실제로 열거될 때까지 폴링하는 `discoverIosPages`를 추가하고, `connectIos`가 이를 쓰도록 교체.

**Files:**
- Modify: `src/ios.ts` (add `discoverIosPages`)
- Modify: `src/state.ts` (`connectIos`가 `discoverIosPages` 사용)
- Test: `tests/ios.test.ts` (fetch 목으로 빈→채워짐 폴링 검증)

**Interfaces:**
- Produces: `export async function discoverIosPages(frontPort: number, timeoutMs?: number): Promise<{ devicePort: number; pages: IosPage[] }>;`

- [ ] **Step 1: Write the failing test**

`tests/ios.test.ts`에 추가:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { discoverIosPages } from '../src/ios.js';

describe('discoverIosPages', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('polls until pages appear', async () => {
    let deviceCall = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('9330')) {
        return { ok: true, json: async () => [{ deviceId: 'D', url: '127.0.0.1:9331' }] };
      }
      // device port: 첫 호출 빈 목록, 두 번째부터 페이지 있음
      deviceCall += 1;
      return { ok: true, json: async () => (deviceCall >= 2
        ? [{ url: 'https://x/', webSocketDebuggerUrl: 'ws://x/1' }]
        : []) };
    }));
    const { devicePort, pages } = await discoverIosPages(9330, 3000);
    expect(devicePort).toBe(9331);
    expect(pages).toHaveLength(1);
    expect(deviceCall).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ios.test.ts`
Expected: FAIL — `discoverIosPages is not a function`

- [ ] **Step 3: Implement**

`src/ios.ts`에 추가:
```ts
/** proxy 갓 spawn 시 기기 인스펙터가 cold라 첫 listPages가 빈 목록일 수 있음 → 페이지 열거까지 폴링. */
export async function discoverIosPages(
  frontPort: number,
  timeoutMs = 8000,
): Promise<{ devicePort: number; pages: IosPage[] }> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const devicePort = await getDevicePort(frontPort);
      const pages = await listPages(devicePort);
      if (pages.length) return { devicePort, pages };
    } catch (e) {
      lastErr = e; // NO_DEVICE/NO_WEBVIEW → 재시도
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  // 타임아웃: 마지막 시도로 적절한 FlowError 전파
  const devicePort = await getDevicePort(frontPort);
  return { devicePort, pages: await listPages(devicePort) };
  void lastErr;
}
```
(`void lastErr;`는 도달 불가 — 제거하고 lastErr 변수도 빼도 됨. 구현자 판단으로 미사용 변수 없이 정리.)

- [ ] **Step 4: `connectIos`가 `discoverIosPages` 사용하도록 교체**

`src/state.ts`의 `connectIos`에서 `getDevicePort` + `listPages` 두 호출을 `discoverIosPages`로 교체:
```ts
export async function connectIos(
  select: { index?: number; urlMatch?: string },
): Promise<{ cdp: CdpClient; devicePort: number; pageUrl: string | null }> {
  const frontPort = await ensureProxy();
  const { devicePort } = await discoverIosPages(frontPort); // 콜드스타트 레이스 방어(폴링)
  const opts: { index?: number; urlMatch?: string } = {};
  if (select.urlMatch) opts.urlMatch = select.urlMatch;
  else if (select.index !== undefined) opts.index = select.index;
  const cdp = new CdpClient((wsUrl) => new IosTargetTransport(wsUrl));
  await cdp.connect(devicePort, opts);
  return { cdp, devicePort, pageUrl: cdp.pageUrl };
}
```
`src/state.ts` 상단 import를 `import { ensureProxy, discoverIosPages, stopProxy } from './ios.js';`로 갱신(더 이상 `getDevicePort`/`listPages` 직접 사용 안 함).

- [ ] **Step 5: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전체 green (신규 discoverIosPages 테스트 포함), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/ios.ts src/state.ts tests/ios.test.ts
git commit -m "[수정] iOS 콜드스타트 레이스 — 페이지 열거까지 폴링"
```

---

## Task 15: iOS click/type 구현 (P2)

**문제(실측):** iOS WebKit엔 `Input` 도메인이 없어 `Input.dispatchMouseEvent`/`Input.insertText`가 `'Input' domain was not found`로 실패. `webview_click`/`webview_type`이 iOS에서 동작 안 함.

**해결:** 좌표 찾기(`buildFindScript`)는 그대로 재사용하고, **액션만** 플랫폼 분기. iOS는 `Runtime.evaluate`로 `document.elementFromPoint(x,y)`에 `.click()`/value 주입(evaluate는 iOS 작동 확인됨). Android 경로는 무변경.

**Files:**
- Modify: `src/tools/interact.ts`
- Test: `tests/tools/interact.test.ts` (iOS 분기: Input.* 대신 evaluate 사용 확인)

- [ ] **Step 1: Write the failing test**

`tests/tools/interact.test.ts`에 iOS 케이스 추가(기존 mock cdp 패턴 재사용; `state.platform='ios'` 설정). 핵심 단언:
- iOS click: `cdp.send`가 `Input.dispatchMouseEvent`로 호출되지 **않고**, 좌표 찾기 후 `Runtime.evaluate`(expression에 `elementFromPoint`)가 호출됨.
- iOS type: `Input.insertText` 미호출, 대신 `Runtime.evaluate`로 value 주입.
(정확한 mock 형태는 기존 interact.test.ts 스타일을 따르되, iOS일 때 `Input.*` send가 0회임을 assert.)

- [ ] **Step 2: Run → fail** (`npx vitest run tests/tools/interact.test.ts`)

- [ ] **Step 3: Implement**

`src/tools/interact.ts`:
- import에 `state` 추가: `import { ensureConnected } from '../state.js';` → `import { ensureConnected, state } from '../state.js';`
- `findAndClick`를 "좌표 찾기"와 "액션"으로 분리. 좌표 찾는 부분(`buildFindScript`→evaluate→parse→not_found 처리)을 `resolveCoords(cdp, selector, text, clearValue)`로 추출(coords 또는 에러 응답 반환). 그런 다음:

```ts
const IOS_CLICK = (x: number, y: number) => `(() => {
  const el = document.elementFromPoint(${x}, ${y});
  if (!el) return JSON.stringify({ error: 'no_element' });
  el.click();
  return JSON.stringify({ ok: true });
})()`;

const IOS_TYPE = (x: number, y: number, value: string) => `(() => {
  const el = document.elementFromPoint(${x}, ${y});
  if (!el) return JSON.stringify({ error: 'no_element' });
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
  if (setter) setter.call(el, ${JSON.stringify(value)}); else el.value = ${JSON.stringify(value)};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return JSON.stringify({ ok: true });
})()`;
```

`clickHandler`:
```ts
export async function clickHandler(args: { selector?: string; text?: string }) {
  try {
    const cdp = await ensureConnected();
    const coords = await resolveCoords(cdp, args.selector, args.text);
    if ('errorResponse' in coords) return coords.errorResponse;
    if (state.platform === 'ios') {
      await cdp.send('Runtime.evaluate', { expression: IOS_CLICK(coords.x, coords.y), returnByValue: true });
    } else {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
    }
    return { content: [{ type: 'text' as const, text: `클릭 완료 (${Math.round(coords.x)}, ${Math.round(coords.y)})` }] };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: 'text' as const, text: `클릭 실패: ${msg}` }] };
  }
}
```

`typeHandler`:
```ts
export async function typeHandler(args: { selector?: string; text?: string; value?: string }) {
  try {
    if (!args.value) return { isError: true, content: [{ type: 'text' as const, text: 'value는 필수입니다.' }] };
    const cdp = await ensureConnected();
    const coords = await resolveCoords(cdp, args.selector, args.text, true);
    if ('errorResponse' in coords) return coords.errorResponse;
    if (state.platform === 'ios') {
      await cdp.send('Runtime.evaluate', { expression: IOS_TYPE(coords.x, coords.y, args.value), returnByValue: true });
    } else {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.insertText', { text: args.value });
    }
    return { content: [{ type: 'text' as const, text: `입력 완료: "${args.value}"` }] };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: 'text' as const, text: `입력 실패: ${msg}` }] };
  }
}
```

`resolveCoords` (findAndClick에서 추출, 액션 제거):
```ts
async function resolveCoords(cdp: CdpClient, selector?: string, text?: string, clearValue = false):
  Promise<{ x: number; y: number } | { errorResponse: { isError: true; content: { type: 'text'; text: string }[] } }> {
  const script = buildFindScript(selector, text, clearValue);
  if (!script) return { errorResponse: { isError: true, content: [{ type: 'text' as const, text: 'selector 또는 text 중 하나는 필수입니다.' }] } };
  const evalResult = (await cdp.send('Runtime.evaluate', { expression: script, returnByValue: true })) as { result: { value: string } };
  const coords = JSON.parse(evalResult.result.value);
  if (coords.error === 'not_found') {
    const hint = coords.similar?.length ? '\n유사한 요소:\n' + coords.similar.map((s: any) => `  <${s.tag}> "${s.text}"`).join('\n') : '';
    return { errorResponse: { isError: true, content: [{ type: 'text' as const, text: `요소를 찾을 수 없습니다.${hint}` }] } };
  }
  return { x: coords.x, y: coords.y };
}
```
기존 `findAndClick`는 제거(clickHandler/typeHandler가 직접 조합). Android 동작(같은 finder + 같은 Input.* 호출)은 그대로 보존.

- [ ] **Step 4: Verify** — `npx vitest run && npx tsc --noEmit` (전체 green, 기존 android interact 테스트 유지)

- [ ] **Step 5: Commit**

```bash
git add src/tools/interact.ts tests/tools/interact.test.ts
git commit -m "[수정] iOS click/type — Input 도메인 대신 evaluate"
```

---

## Task 16: iOS flow awaitPromise 폴백 (P3)

**문제(실측):** iOS WebKit의 `Runtime.evaluate`는 `awaitPromise: true`를 무시하고 Promise를 `{}`로 반환. flow는 async 표현식을 컴파일해 `awaitPromise`로 결과를 받으므로 iOS에서 `segment`가 `{}` → `segment.marks` undefined로 크래시. (동기 객체 `returnByValue`는 iOS 정상.)

**해결:** iOS일 때만 `awaitPromise` 대신 "전역에 결과 저장 → 폴링" 패턴으로 SegmentResult를 얻는다. Android 경로는 무변경. (flow의 click/type은 컴파일된 in-page JS라 이미 iOS 작동 — 이 수정은 promise 결과 수신만 고침.)

**Files:**
- Modify: `src/tools/flow.ts`
- Test: `tests/tools/flow.test.ts` (iOS 분기: 폴링으로 segment 수신 확인)

- [ ] **Step 1: Write the failing test**

`tests/tools/flow.test.ts`에 iOS 케이스 추가(기존 mock cdp 패턴; `state.platform='ios'`): mock cdp.send가 iOS 폴백 경로에서 (1) kickoff evaluate, (2) 폴링 evaluate에 `JSON.stringify({done:true,value:{marks:[],totalMs:1}})` 반환하도록 설정 → flowHandler가 정상 완료(에러 없이 marks 포함 결과 반환)하는지 assert.

- [ ] **Step 2: Run → fail** (`npx vitest run tests/tools/flow.test.ts`)

- [ ] **Step 3: Implement**

`src/tools/flow.ts`의 세그먼트 실행부(현재 line 147-162, `awaitPromise` evaluate → `const segment = evalResult.result.value;`)를 플랫폼 분기로 교체:

```ts
const expr = compileFlow({ steps: remainingSteps, bail }, { startIndex });

let segment: SegmentResult;
if (state.platform === 'ios') {
  // iOS WebKit은 awaitPromise 미지원 → 전역 저장 후 폴링
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
  if (polled.error) {
    return { isError: true, content: [{ type: 'text' as const, text: `[JS_ERROR] flow 실행 중 예외: ${polled.error}` }] };
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
    return { isError: true, content: [{ type: 'text' as const, text: `[JS_ERROR] flow 실행 중 예외: ${desc}` }] };
  }
  segment = evalResult.result.value;
}

allMarks.push(...segment.marks);
```
(이하 `totalMs += segment.totalMs;` 등 기존 로직 그대로.)

**iOS 한계 문서화 대상:** flow의 `osTap`/`osSwipe`/`osKey`(control 타입)는 adb 의존이라 iOS 미지원 — Task 13 문서에 명시(별도 코드 변경 없음, 사용 시 adb 에러).

- [ ] **Step 4: Verify** — `npx vitest run && npx tsc --noEmit` (전체 green, 기존 android flow 테스트 유지)

- [ ] **Step 5: Commit**

```bash
git add src/tools/flow.ts tests/tools/flow.test.ts
git commit -m "[수정] iOS flow — awaitPromise 대신 전역 폴링"
```

---

## Task 17: transport error→onClose 정리 (누적 Minor fix 웨이브) + 실기기 재검증 + 문서 + dist 빌드

**Files:**
- Modify: `src/transport.ts` (RawTransport·IosTargetTransport의 `error`(및 iOS close-before-announce) 시 `closeCb`/타이머 정리)
- Create: `docs/ios-webview-verification.md`; Modify: `README.md`
- Build: `dist/` 재생성 + 커밋

- [ ] **Step 1: transport error→onClose 정리**

리뷰 누적 Minor: 성공 연결 후 소켓 `error` 시 `closeCb` 미호출로 `connected=true` 잔류. RawTransport와 IosTargetTransport 모두 `ws.on('error')`에서 (connect 성공 이후라면) `closeCb()`도 호출하도록 보완. IosTargetTransport는 connect 전 close 시 타이머 정리도 추가. TDD로 회귀 테스트 1개(연결 후 error → onClose 발화) 추가.

- [ ] **Step 2: 빌드 + 전체 회귀** — `npm run build && npx vitest run` (전체 green)

- [ ] **Step 3: 실기기 재검증** — 통합 드라이버 재실행(콜드스타트 포함)해서 connect 안정성(P1)·click/type(P2)·flow(P3) 통과 확인. 결과를 `docs/ios-webview-verification.md`에 기록.

- [ ] **Step 4: 문서** — `README.md`에 iOS 지원 + `brew install ios-webkit-debug-proxy` + 사전조건(USB·웹인스펙터·맥 인스펙터 닫기) + 한계(osTap 계열 adb 의존 iOS 미지원, macOS 전용, 시뮬레이터 미지원) 명시.

- [ ] **Step 5: dist 커밋** — `npm run build` 후 `git add dist && git commit`으로 컴파일 산출물 동기화(플러그인이 dist로 실행). 문서/소스와 함께 커밋.
