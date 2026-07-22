# iOS WebView 지원 설계

- 작성일: 2026-07-15
- 상태: 설계 승인됨 (구현 계획 대기)
- 범위: webview-test MCP를 안드로이드 전용 → 안드로이드 + iOS(Safari/WKWebView) 지원으로 확장

## 1. 배경 / 목표

현재 webview-test MCP는 `adb`로 안드로이드 WebView에만 붙는다. 이를 **완전 패리티(full parity)** 로 iOS까지 확장한다 — 안드로이드가 하는 모든 것(연결·evaluate·클릭·입력·flow·DOM·스크린샷·**콘솔 이벤트 수집**)을 iOS에서도 동일하게 제공.

### 스파이크로 확인된 사실 (2026-07-15, 실기기 iOS 26.5)

실제 아이폰(`yy의 iPhone`, iOS 26.5)에 붙여 플러그인이 쓰는 CDP 명령을 직접 검증했다.

| CDP 명령 | iOS 26 결과 | 결론 |
|----------|------------|------|
| 기기·페이지 탐지 (`ios-webkit-debug-proxy` `/json`) | ✅ | proxy가 device→page 목록 제공 |
| `Runtime.evaluate` (Target 래핑) | ✅ `{title,href,anchors}` 반환 | evaluate 기반 툴 전부 동작 |
| `DOM.getDocument` (Target 래핑) | ✅ rootNodeId 반환 | DOM 도메인 동작 |
| `Page.captureScreenshot` | ❌ `'Page.captureScreenshot' was not found` | iOS 미지원 |
| `Page.snapshotRect` (Target 래핑) | ✅ dataURL ~1.9MB | 스크린샷 대안 확정 |

**핵심 발견 3가지:**

1. **Target 래핑 필수** — iOS 17+ WebKit은 명령을 날것으로 받지 않는다. `Runtime.evaluate`를 그대로 보내면 `"'Runtime' domain was not found"`. 반드시 `Target.sendMessageToTarget({ targetId, message })`로 포장해야 하고, 응답은 `Target.dispatchMessageFromTarget` 이벤트로 감싸여 온다. `ios-webkit-debug-proxy 1.9.2`는 이 래핑을 자동으로 해주지 않는다.
2. **`type:"page"` 필드 없음** — iOS proxy의 `/json` 타겟에는 안드로이드 CDP에 있는 `type:"page"` 필드가 없다. 현행 `CdpClient.connect()`의 `t.type === 'page'` 필터가 페이지를 못 찾는다.
3. **단일 인스펙터 슬롯** — iOS는 한 페이지에 원격 검사기를 하나만 붙일 수 있다. 맥 Safari 웹 인스펙터 창이 열려 있으면 proxy 명령이 무응답(타임아웃)이 된다.

## 2. 설계 결정 (확정)

| 결정 | 선택 | 함의 |
|------|------|------|
| 범위 | **완전 패리티** | 콘솔 이벤트까지 iOS 지원 → 전송 어댑터가 이벤트도 언래핑해야 함 |
| 플랫폼 선택 | **자동감지 + 명시 override** | connect 시 adb·idevice 스캔; 인자 `platform`으로 강제 가능 |
| proxy 관리 | **플러그인 자동 관리** | connect가 proxy를 spawn(또는 재사용), 종료 시 정리. 포트 충돌 자동 회피 |
| 코드 구조 | **B안: Transport seam** | Target 래핑을 `Transport`로 분리, `CdpClient`는 순수 CDP 유지 |

## 3. 아키텍처

### 3.1 비유

엔진(기능 툴)은 그대로 두고, 연결부에 **iOS용 어댑터**를 하나 더 끼운다. 안드로이드는 기존 경로 그대로 → 회귀 위험 0.

### 3.2 모듈 구성

| 파일 | 상태 | 역할 | 의존 |
|------|------|------|------|
| `src/transport.ts` | 🆕 | `Transport` 인터페이스 + `RawTransport`(안드로이드) + `IosTargetTransport`(iOS). 순수 헬퍼 `wrapForTarget`/`unwrapFromTarget` 포함 | `ws` |
| `src/ios.ts` | 🆕 | `ios-webkit-debug-proxy` 생명주기(spawn/PID추적/stop) + 기기·페이지 탐지 | `child_process`, `fetch` |
| `src/platform.ts` | 🆕 | `detectPlatform()` — adb·idevice 출력 파싱해 `'android'`/`'ios'`/모호/없음 판별 | `adb.ts`, `ios.ts` |
| `src/cdp.ts` | ✏️ | ws 직접 제어 → `Transport`에 위임. 요청/응답 상관·이벤트 라우팅은 유지 | `transport.ts` |
| `src/tools/connect.ts` | ✏️ | `platform` 인자 + android/ios 라우팅 → 맞는 Transport 조립 | `platform.ts`, `ios.ts`, `discovery.ts` |
| `src/tools/screenshot.ts` | ✏️ | iOS → `Page.snapshotRect`, 안드로이드 → `Page.captureScreenshot` 분기 | `state.ts` |
| `src/state.ts` | ✏️ | `platform`·proxy 핸들 보관(정리용) | `ios.ts` |
| `src/console-log.ts` | ✏️ | iOS 콘솔 이벤트(`Console.messageAdded` 추정) 수신 추가 | — |

**손대지 않는 툴:** `evaluate`, `dom`, `interact`(click/type), `wait`, `flow`, `run-script`. 전부 `Runtime.evaluate` 기반이라 Transport가 투명하게 처리.

### 3.3 Transport seam 계약

```ts
interface Transport {
  connect(): Promise<void>;   // ws 열기 + iOS는 여기서 targetId 확보
  send(msg: { id: number; method: string; params?: object }): void;
  onMessage(cb: (msg: CdpInbound) => void): void;  // 응답·이벤트, 이미 언래핑됨
  close(): void;
}
```

- `CdpClient`는 `Transport`를 주입받아 **pending map(id 상관)** 과 **이벤트 핸들러 라우팅**만 담당. ws를 직접 만지지 않는다.
- **RawTransport** (안드로이드): `send` → `ws.send(JSON)`, `onMessage` → ws 메시지 그대로. 현행과 동일 동작.
- **IosTargetTransport** (iOS):
  - `connect()`: ws open 후 `Target.targetCreated`(`targetInfo.type === 'page'`) 이벤트를 기다려 `pageTargetId` 확보.
  - `send(msg)`: `wrapForTarget(pageTargetId, msg)` → `{ id, method:'Target.sendMessageToTarget', params:{ targetId, message: JSON.stringify(msg) } }`.
  - 수신: `Target.dispatchMessageFromTarget`면 `unwrapFromTarget`로 내부 메시지 꺼내 `onMessage`로 전달. `Target.targetCreated`/`Target.targetDestroyed`는 내부 처리(콜백으로 안 넘김).

**순수 헬퍼 (단위테스트 대상, 실기기 불필요):**

```ts
function wrapForTarget(targetId: string, msg: CdpOutbound): CdpOutbound;
function unwrapFromTarget(raw: object):
  | { kind: 'message'; msg: CdpInbound }
  | { kind: 'targetCreated'; targetId: string; type: string }
  | { kind: 'targetDestroyed'; targetId: string }
  | { kind: 'other' };
```

### 3.4 iOS 페이지 타겟 선택 (`/json` 파싱)

`CdpClient.connect()`는 현재 `t.type === 'page'`로 페이지 타겟을 고른다. iOS `/json`엔 `type`이 없으므로 **필터 완화**: `type === 'page'`가 있으면 그걸, 없으면 `webSocketDebuggerUrl`이 있는 첫 타겟. (안드로이드 동작 불변, iOS만 fallback)

## 4. 연결 흐름 (connect 툴)

```
1. platform 결정
   - args.platform 있으면 그것
   - 없으면 detectPlatform(): adb 기기 스캔 + idevice 기기 스캔
       · 정확히 하나 → 그 플랫폼
       · 둘 다 → FlowError(PLATFORM_AMBIGUOUS, "platform 지정")
       · 없음 → FlowError(NO_DEVICE)
2. android → 기존 경로: pickDevice → pickSocket → adb forward → RawTransport
3. ios:
   a. ensureProxy(): 이미 spawn한 proxy 살아있으면 재사용, 아니면 충돌없는 포트로 spawn 후 /json 응답까지 poll
   b. listDevices()(frontend /json) → 대상 기기의 page-list 포트
   c. listPages() → pickPage(socketIndex|app)
   d. IosTargetTransport(wsUrl) 조립 → CdpClient.connect
```

**페이지 선택 파라미터 (안드로이드와 인터페이스 공유):**

- `socketIndex` → iOS에선 페이지 배열 인덱스.
- `app` → iOS에선 **페이지 `url` 부분일치**로 매칭. (iOS는 번들 ID가 `/json`에 깨끗이 안 나오고 `appId:"PID:xxxx"`만 있어, 실용적으로 URL 매칭. 안드로이드는 프로세스명 매칭 — 문서에 차이 명시)

## 5. proxy 생명주기 (`src/ios.ts`)

- **spawn 커맨드**: `ios_webkit_debug_proxy -c null:<front>,:<front+1>-<front+10>`. 디버그 플래그(`-d`)는 로그 스팸이라 미사용.
- **포트 선택**: 기존 dev Chrome(9222/9223 등)과 충돌 회피. 기본 base(예: 9330)에서 시작해 사용 중이면 증가하며 free 포트 탐색.
- **핸들 추적**: 모듈 스코프에 `{ child, frontPort }` 보관. `ensureProxy`는 살아있으면 재사용.
- **정리**: `stopProxy()`를 (1) connect 재연결 시 reset 경로, (2) 서버 종료 시(`index.ts`의 기존 `removeForward` 정리 지점 옆)에서 호출.

## 6. 스크린샷 분기 (`src/tools/screenshot.ts`)

selector→clip rect 계산 로직은 공유. 마지막 캡처 명령만 분기:

- 안드로이드: `Page.captureScreenshot({ format, quality, clip })` → `data`(base64).
- iOS: `Page.snapshotRect({ x, y, width, height, coordinateSystem:'Viewport' })` → `dataURL`(`data:image/...;base64,` 접두 제거 후 반환).

풀스크린(selector 생략) 시 iOS는 뷰포트 크기를 `Runtime.evaluate`로 얻어 rect 지정.

## 7. 에러 처리

| 상황 | 코드 | 메시지 핵심 |
|------|------|-------------|
| proxy/libimobiledevice 미설치 | `IOS_TOOLING_MISSING`(신규) | `brew install ios-webkit-debug-proxy` |
| iOS 기기 없음 | `NO_DEVICE`(재사용) | USB 연결·개발자 신뢰·Safari '웹 인스펙터' 켜기 |
| 페이지 없음 | `NO_WEBVIEW`(재사용) | Safari 탭 열거나 대상 앱 웹뷰 foreground |
| 플랫폼 모호(둘 다 연결) | `PLATFORM_AMBIGUOUS`(신규) | `platform: 'ios'|'android'` 지정 |
| 명령 타임아웃 | 기존 timeout | 힌트: 맥 웹 인스펙터 창 닫기(단일 슬롯 충돌) |

## 8. 미해결 항목 (구현 첫 단계에서 실측)

**iOS 콘솔 이벤트 이름 확정.** `console-log.ts`는 현재 Chrome 이벤트(`Runtime.consoleAPICalled` / `Log.entryAdded` 추정)를 듣는다. WebKit은 `Console.messageAdded`(+ `Console.enable`)일 가능성이 높다. **실기기로 실제 이벤트 이름·페이로드 형태를 찍어 확정**한 뒤 iOS 분기 추가. 페이로드 shape가 다르면 정규화 필요.

## 9. 검증 전략

### 단위 (실기기 불필요, vitest)
- `transport.ts`: `wrapForTarget`/`unwrapFromTarget` 왕복, `targetCreated` 파싱, 이벤트 언래핑, 알 수 없는 프레임 → `other`.
- `platform.ts`: adb/idevice 출력 문자열 목킹 → 판별 로직(하나/둘/없음).
- 페이지 타겟 선택 fallback(`type` 없는 `/json`).

### 통합 (실기기, 반자동)
스파이크 스크립트를 `docs/`의 재현 절차로 정식화:
- connect(ios) → evaluate(title/href) → dom → click(evaluate 기반) → screenshot(snapshotRect) → **콘솔 이벤트 캡처** → flow 시나리오.
- 사전조건: USB 연결, 웹 인스펙터 ON, 맥 인스펙터 창 닫힘, Safari에 페이지 열림.

### 회귀 (안드로이드)
- 기존 vitest 스위트 그대로 통과(안드로이드 경로 불변 확인).
- 실기기 안드로이드 connect→flow 1회 스모크.

## 10. 비목표 (Non-goals)

- Windows/Linux에서 iOS 지원 (proxy가 macOS `usbmuxd` 의존 — macOS 전용).
- iOS 시뮬레이터 지원 (1차는 실기기. 시뮬레이터는 소켓 경로가 달라 후속).
- WebDriver 기반 자동화(`WIRAutomation…`) — CDP-over-WebKit만 사용.
- 픽셀 단위 시각 diff.
