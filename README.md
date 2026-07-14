# webview-test-mcp 소개

> 2026-07-15 기준 (main, v1.4.0). 팀 동료들에게 이 프로젝트를 소개하기 위한 문서로, "이게 뭔지, 왜 필요한지, 어떻게 동작하는지, 다른 도구와 뭐가 다른지"에 전부 답할 수 있는 것을 목표로 한다.
> 변경 이력: [GitHub Releases](https://github.com/yyoooon/webview-test-mcp/releases)

---

## 1. 한 줄 소개

**AI 에이전트(Claude)가 실제 Android 기기의 WebView에 직접 붙어서 UI를 조작·검증할 수 있게 해주는 MCP 서버.**

개발자가 "이 기능 실기기에서 되는지 확인해줘"라고 말하면, Claude가 ADB로 폰을 찾고, Chrome DevTools Protocol(CDP)로 WebView에 접속해서, 클릭·입력·스타일 검사·스크린샷까지 수행하고 결과를 보고한다.

---

## 2. 왜 필요한가 (배경 / 문제 정의)

### 문제 상황
대상 앱(front-care-hub)은 **네이티브 Android 앱의 WebView 안에서 도는 Next.js 웹앱**이고, `window.CareHubBridge` 같은 **네이티브 브릿지에 의존**한다.

이 구조에서 기존 테스트 방식은 전부 구멍이 있다:

| 방식 | 한계 |
|------|------|
| 데스크톱 브라우저 + Playwright | 브릿지 객체가 없음 → 브릿지 의존 기능은 아예 동작 불가. WebView 고유 환경(IME, 뷰포트, 네이티브 제스처)도 재현 안 됨 |
| chrome://inspect 수동 디버깅 | 사람이 직접 클릭해야 함. 느리고 반복 불가능 |
| Appium 등 E2E 프레임워크 | 셋업 무겁고, "개발 중 빠른 확인" 용도에 과함 |

즉, **"실기기 WebView에서, 빠르게, 반복적으로, 자동으로"** 검증할 수단이 없었다.

### 해결
- 네이티브 앱은 이미 `WebView.setWebContentsDebuggingEnabled(true)`가 켜진 디버그 빌드 → CDP 소켓이 노출되어 있음
- ADB 연결 인프라도 이미 사용 중
- 그렇다면 **ADB + CDP만으로 네이티브 앱을 한 줄도 안 고치고** WebView를 원격 조작할 수 있다
- 이것을 MCP 도구로 포장하면 Claude가 직접 쓸 수 있다 → "코드 수정 → 실기기 확인 → 재수정" 루프를 AI가 자율로 돌림

핵심 가치: **개발 중 피드백 루프 단축.** CI 회귀 테스트가 아니라 로컬 개발자 도구다.

---

## 3. 아키텍처

```
┌──────────────┐   MCP (stdio)    ┌───────────────────────┐
│ Claude Code   │ ◄──────────────► │ webview-test-mcp       │
│               │  tools & results │ (Node.js + TypeScript)  │
└──────────────┘                  │                        │
                                  │  ADB 레이어 (adb.ts)     │ ← adb CLI 실행 (execFile)
                                  │  CDP 레이어 (cdp.ts)     │ ← ws WebSocket 클라이언트
                                  │  Tools 레이어 (tools/*)  │ ← MCP 도구 9개
                                  └───────────┬────────────┘
                                              │ adb forward tcp:<port> ↔ localabstract:webview_devtools_remote_<pid>
                                  ┌───────────▼────────────┐
                                  │ Android 실기기            │
                                  │  네이티브 앱 → WebView     │
                                  │  (CDP 소켓 노출)          │
                                  └────────────────────────┘
```

### 3-레이어 구성

1. **ADB 레이어** (`src/adb.ts`) — `adb` CLI를 `execFile`로 감싼 얇은 래퍼
   - 기기 목록 (`adb devices`), WebView 소켓 탐색, 포트 포워딩
   - OS-level 입력: `input tap` / `input swipe` / `input keyevent`
   - PID → 앱 패키지명 역추적 (`cat /proc/<pid>/cmdline`)
2. **CDP 레이어** (`src/cdp.ts`) — 직접 구현한 경량 CDP 클라이언트
   - 외부 라이브러리(`chrome-remote-interface`) 대신 **raw `ws` WebSocket** 사용 (의존성 최소화)
   - request-id 기반 pending map, 요청당 30초 타임아웃, CDP 이벤트 구독(`on`/`off`)
3. **Tools 레이어** (`src/tools/*`) — Claude에게 노출되는 MCP 도구 9개

의존성은 단 2개: `@modelcontextprotocol/sdk`, `ws`. 그 외 전부 직접 구현.

### 연결 흐름 (`webview_connect`)

```
adb devices                          → 기기 확인 (0대: 에러 / 여러 대: Wi-Fi 기기 우선)
adb shell cat /proc/net/unix         → webview_devtools_remote_<pid> 소켓 탐색
  (여러 개면: app 파라미터로 패키지명 부분 일치 선택 > socketIndex > 기본 0번)
adb forward tcp:0 localabstract:...  → OS가 빈 포트 자동 할당 (충돌 방지)
http://127.0.0.1:<port>/json         → page 타입 타겟의 webSocketDebuggerUrl 획득
WebSocket 연결                        → CDP 세션 성립
Runtime.evaluate(location.href)      → 현재 URL 확인 후 "기기/PID/앱/포트/URL" 보고
```

연결 상태는 모듈 전역 싱글턴(`src/state.ts`)에 저장. **모든 도구는 `ensureConnected()`를 거친다** — 살아있으면 재사용, 끊겼으면 기존 포트로 1회 재연결, 그것도 실패하면 자동 재탐색부터 다시. 즉 `webview_connect`를 명시적으로 안 불러도 어떤 도구든 첫 호출 시 자동 연결된다.

---

## 4. 제공 도구 (9개, 최신 코드 기준)

| 도구 | 역할 | 구현 핵심 |
|------|------|-----------|
| `webview_connect` | 기기/WebView 탐색 + CDP 연결 | 위 연결 흐름. `app`(패키지명 부분일치) / `socketIndex` 선택 지원 |
| `webview_get_dom` | 보이는 상호작용 요소 스냅샷 | `Runtime.evaluate`로 DOM 순회. selector 생성 규칙: `id > data-testid > name > 부모경로+nth-of-type`. 최대 50개로 잘라 토큰 절약 |
| `webview_evaluate` | 임의 JS 실행 (escape hatch) | `Runtime.evaluate` + `awaitPromise: true` (async 지원), 30초 타임아웃 |
| `webview_click` | 단발 클릭 | selector/text로 요소 탐색 → 중심좌표 계산 → `Input.dispatchMouseEvent` (mousePressed→mouseReleased). 실패 시 유사 요소 5개 제안 |
| `webview_type` | 단발 입력 | 클릭(포커스) + 기존 value 클리어 → `Input.insertText` |
| `webview_wait_for` | selector 출현 / `gone`(소멸) / `role` 노출 / JS 조건 대기 | **in-page 폴링** — 대기 1회당 CDP 왕복 1회(브라우저 안에서 루프). 기본 타임아웃 10초 |
| `webview_screenshot` | 화면 캡처 | `Page.captureScreenshot`. **기본 JPEG 품질 50** (토큰 절약), `selector` 옵션으로 element-scoped clip 캡처 권장 |
| `webview_flow` | **선언형 multi-step 시나리오를 1콜로 실행** (핵심 도구) | 아래 §5 상세 |
| `webview_run_script` | 저장된 매크로 재생 | `.webview-scripts/<name>.webview.js` 읽어 evaluate 1방. `args` → 스크립트 안에서 `__args`로 참조 |

---

## 5. 핵심 설계: `webview_flow` — 선언형 step을 JS로 컴파일

이 프로젝트에서 가장 공들인 부분. **"MCP 왕복 횟수 = 비용"** 이라는 문제의식에서 나왔다.

### 문제
"클릭 → 다이얼로그 대기 → 확인 클릭 → 닫힘 대기 → 상태 캡처" 를 개별 도구로 하면 5번의 MCP 왕복 + 매번 결과가 대화 컨텍스트에 쌓임. 느리고 토큰도 많이 씀.

### 해결
Claude는 JSON step 배열만 보낸다:

```json
{ "steps": [
  { "click": { "text": "Update My Program" } },
  { "waitFor": { "role": "dialog" } },
  { "click": { "text": "Confirm", "within": "[role=dialog]" } },
  { "waitFor": { "gone": "[role=dialog]" } },
  { "capture": { "url": true, "scenario": true } }
] }
```

서버의 **flow 컴파일러**(`src/flow-compiler.ts`)가 이걸 **하나의 async IIFE JS 문자열로 컴파일**해서 `Runtime.evaluate` **한 번**으로 실행한다. 각 step은 `marks` 배열에 `{ i, kind, ok, ms }` 실행 기록을 남기고, 실패하면 즉시 중단(bail, 기본값)한다.

### Step 종류 (13개)

| 분류 | Step | 설명 |
|------|------|------|
| 인터랙션 | `click` | 가시 요소 클릭 (Selector) |
| | `type` | 입력 + input/change 이벤트 디스패치 |
| | `scroll` | JS 스크롤 — `{ to: 요소 }`(scrollIntoView) 또는 `{ by: 픽셀, container? }` |
| 대기 | `waitFor` | selector/`gone`/text/role/url + **`appearsThenGone`**(transient 관찰 — windowMs 동안 샘플링해 appeared/wentGone/hits 기록, 깜빡임 검증) + **`network`**(요청 응답 수신까지 — Node가 CDP Network 이벤트로 매칭) — 기본 5초 |
| | `sleep` | 고정 대기 |
| 네비게이션 | `goto` (문자열) | SPA 클라이언트 라우팅 (pushState + popstate) |
| | `goto` (객체) | 실제 네비게이션 — CDP `Page.navigate`/`Page.reload` + load 완료 대기 |
| 검증/수집 | `assert` | text-visible / url-equals / no-dialog |
| | `capture` | url, scenario(sessionStorage), toast, dialog 내용, storage, custom JS |
| | `inspect` | **디자인 스펙 검증용** — 여러 selector의 computed style/text/classList/rect/attr을 한 번에 추출 → Figma 수치와 즉시 비교 |
| OS 입력 | `osTap` | ADB `input tap` — 진짜 OS 터치 (키보드/IME 등 합성 이벤트로 안 되는 케이스) |
| | `osSwipe` | ADB `input swipe` — 네이티브 제스처 (무한스크롤, pull-to-refresh) |
| | `osKey` | ADB `keyevent` — Android Back 버튼, Enter 등 |
| 탈출구 | `raw` | 임의 JS 조각 |

### Control Signal 패턴 (기술적으로 가장 흥미로운 부분)

`osTap`/`osSwipe`/`osKey`/실제 `goto`는 **브라우저 JS 안에서 실행할 수 없다** (ADB 셸이나 CDP 명령이 필요하므로 Node 레이어의 일). 그래서:

1. 컴파일된 JS는 해당 step에 도달하면 필요한 정보(예: tap 좌표)만 계산하고 `{ control: { type: 'osTap', x, y, i } }` 를 리턴하며 **flow를 중단**
2. Node의 `flowHandler`가 control을 받아 실제 작업 실행 (ADB tap / `Page.navigate` 등)
3. **남은 step들을 startIndex 오프셋으로 재컴파일**해서 이어서 실행
4. 모든 세그먼트의 `marks`/`captured`를 병합해 하나의 결과로 반환

→ 사용자(Claude) 입장에서는 브라우저 작업과 OS 작업이 섞인 시나리오도 여전히 **1콜**.

좌표 처리 디테일: `getBoundingClientRect()`는 CSS px, ADB tap은 물리 px이므로 `devicePixelRatio`를 곱해 스케일링한다.

### 실패 시 자동 진단 첨부

- 첫 실패 step에서 `snapshot: { url, dialogPresent, visibleButtons(10개), headings(5개) }` 자동 첨부 → Claude가 추가 왕복 없이 "왜 실패했고 지금 화면에 뭐가 있는지" 파악
- selector 실패 시 `similar`: 현재 보이는 버튼/링크 텍스트 5개 제안
- **console 자동 수집**: 연결 시 `Runtime.enable`로 콘솔/예외 이벤트를 링버퍼(최대 100개, 항목당 300자)에 상시 수집. flow 시작 시점의 커서를 기억했다가 **그 flow 동안 발생한 error/warning만** 결과의 `console` 필드로 첨부. "실패 원인의 절반은 DOM이 아니라 JS 에러"라는 통찰의 산물

### Payload Guard (`src/payload-guard.ts`)

flow 결과가 기본 10KB를 넘으면 **가장 큰 문자열 필드부터** 앞 500자 + 뒤 200자만 남기고 잘라냄. 어떤 필드를 잘랐는지 `__truncated` 메타로 표시. → 거대한 capture 결과가 Claude 컨텍스트를 날려버리는 사고 방지.

---

## 6. Selector 시스템 (`src/selector.ts`)

3가지 형태를 받는다:

```ts
type Selector =
  | string                                        // CSS selector
  | { text: string; within?: string; tag?: string } // 텍스트 기반
  | { testId: string }                             // data-testid
```

텍스트 기반 매칭의 디테일 (Testing Library의 철학과 유사):

- **가시 요소만** (getClientRects + display/visibility 체크)
- 같은 텍스트를 가진 자식이 있으면 부모는 제외 → **가장 안쪽(leaf) 요소** 선택
- **인터랙티브 요소(button/a/[role=button]/input) 우선** 정렬
- **완전 일치 > 부분 일치** 우선

→ `{ text: 'Confirm', within: '[role=dialog]' }` 처럼 사람이 화면을 설명하는 방식 그대로 요소를 지정할 수 있다.

---

## 7. 매크로 시스템 (`.webview-scripts/` + `webview_run_script`)

**같은 시나리오를 두 번째 돌릴 때부터의 비용을 0에 가깝게** 만드는 장치.

- 1회차: Claude가 DOM 탐색하며 시나리오 수행 → 성공하면 실행한 JS를 `.webview-scripts/<기능명>.webview.js`로 자동 저장 (단일 async IIFE, self-contained, snapshot 배열 리턴)
- 2회차~: `webview_run_script({ name: 'profile-menu-scenarios' })` 한 방. **긴 스크립트를 매번 토큰으로 보낼 필요 없이 서버가 파일을 읽어 실행**
- 파라미터화: `args: { userId: 'a@b.c' }` → 스크립트에서 `__args.userId` 참조 (변형 시나리오를 위해 스크립트 복제할 필요 없음)
- 스크립트 원칙: assertion 없이 **snapshot만 수집** (판정은 Claude가), 고정 sleep 금지 → 조건 폴링(`waitFor`)
- 보안: 이름 검증 정규식(`^[A-Za-z0-9][A-Za-z0-9_-]*$`)으로 path traversal 차단

---

## 8. 운영 철학 — 서버가 AI의 행동까지 설계한다

이 프로젝트의 독특한 점: **MCP `instructions` 필드에 상세한 사용 원칙을 박아서, 서버가 Claude의 도구 사용 패턴 자체를 가이드**한다 (`src/index.ts`). 도구만 던져주는 게 아니라 "어떻게 써야 싸고 빠른지"를 서버가 가르친다.

핵심 원칙:

1. **multi-step은 `webview_flow` 우선** — 개별 click/screenshot 남발 금지
2. **스타일 검증은 스크린샷 대신 computed value** — `inspect` step으로 fontSize/color 등을 JSON으로. 스크린샷보다 10~100배 빠르고 토큰 거의 안 씀
3. **스크린샷은 최후의 수단** — 시각 회귀(z-index 겹침, 아이콘 누락)나 사람 확인용만. 쓸 때도 element-scoped
4. **실패 시 자동 반복** — 결과가 요구사항과 다르면 코드 수정 → HMR 대기 → 재실행을 2~3회 자율 수행
5. **에러별 진단 가이드** — 에러 코드(`NO_DEVICE`, `NO_WEBVIEW`, `SELECTOR_NOT_FOUND`...)마다 원인과 다음 액션을 표로 제공. 선행조건 문제(ADB 미연결, 디버그 빌드 아님)는 자동 해결 시도 금지, 사용자에게 넘김

에러 처리 전반: 모든 에러는 `FlowError(code, message, extras)` → `isError: true` MCP 응답으로 변환. **서버는 절대 크래시하지 않는다.** 종료 시(SIGINT) CDP 닫고 `adb forward --remove`로 정리.

---

## 9. 다른 도구/라이브러리와의 차이

### vs Playwright / Puppeteer
| | Playwright/Puppeteer | webview-test-mcp |
|---|---|---|
| 실행 환경 | 자기가 띄운 데스크톱 브라우저 | **이미 떠 있는 실기기 WebView에 attach** |
| 네이티브 브릿지 | 없음 (mock 필요) | **실제 브릿지 그대로 동작** |
| OS 입력 | 브라우저 내 합성 이벤트만 | ADB로 **진짜 OS tap/swipe/keyevent** (IME, Back 버튼 검증 가능) |
| 용도 | CI 회귀 테스트 | 개발 중 빠른 검증 루프 |
| 사용 주체 | 개발자가 스크립트 작성 | **AI가 직접 조작** (MCP) |

상호 배타가 아니라 상호 보완 — Playwright는 회귀 스펙, 이건 개발 루프. (설계문서에도 명시)

### vs Appium
Appium은 네이티브+웹 하이브리드 E2E의 표준이지만 서버/드라이버/capability 셋업이 무겁다. 이 도구는 WebView 내부만 다루는 대신 **의존성 2개, 셋업은 adb 연결뿐**. 네이티브 UI(권한 팝업 등)는 못 다루지만 `input tap/keyevent`로 OS-level 입력은 커버.

### vs Maestro
Maestro도 YAML 선언형 flow지만 접근성 트리 기반 블랙박스. 이건 **CDP로 DOM/JS 컨텍스트에 직접 접근** → `getComputedStyle` 검증, sessionStorage 캡처, 브릿지 함수 직접 호출이 가능.

### vs Playwright MCP 같은 범용 브라우저 MCP
방향은 같지만 (1) Android 실기기 WebView 타겟팅(ADB 탐색/포워딩)이 없고, (2) OS-level 입력이 없고, (3) 토큰 절약 장치(flow 컴파일러, payload guard, inspect, 매크로)가 이 도구의 차별점.

### vs chrome-remote-interface
CDP 클라이언트 라이브러리일 뿐. 이 프로젝트는 그 역할(cdp.ts, 126줄)을 직접 구현하고 그 위에 도구·컴파일러·운영 원칙을 얹은 것.

**한 줄 요약: "실기기 WebView × AI 에이전트 × 토큰 효율" 이 세 가지의 교집합을 채우는 도구는 이것뿐.**

---

## 10. 한계 / 전제 조건

- **디버그 빌드 필수** — `setWebContentsDebuggingEnabled(true)` 없이는 CDP 소켓이 안 뜸. 프로덕션 빌드 테스트 불가
- **네이티브 UI는 조작 불가** — WebView 밖(권한 다이얼로그, 네이티브 네비게이션)은 보이지 않음. 좌표 기반 `osTap`으로 우회하는 정도
- **osTap 좌표는 fullscreen WebView 가정** — status bar offset이 있는 레이아웃이면 좌표가 어긋날 수 있음
- **회귀 테스트가 아님** — PASS/FAIL 판정 체계 없음(snapshot을 Claude가 해석), CI 통합 없음. 의도된 스코프
- **단일 세션** — 한 번에 한 기기/한 WebView. 상태는 프로세스 전역 싱글턴
- **selector drift 시 자동 복구 없음** — 의도적 결정. 자동 재탐색은 오탐 위험이 있어 사용자 판단에 맡김

---

## 11. 테스트 전략

- **vitest + happy-dom**: 컴파일러가 생성한 JS를 happy-dom 환경에서 실제 실행해 검증
- ADB/CDP는 mock — `execFile` 호출 인자와 CDP 메시지 형식을 검증
- 소스 파일별 1:1 테스트 파일 (`tests/` 미러 구조), 전체 20개 테스트 파일

---

## 12. 자주 묻는 질문 (FAQ)

**Q. 왜 Playwright 안 쓰고 직접 만들었나?**
A. 대상 앱이 네이티브 브릿지(`window.CareHubBridge`)에 의존해서 데스크톱 브라우저에선 기능이 불완전하다. 실기기 WebView에 attach해야 하는데 Playwright는 그게 안 된다. 또 AI가 쓰는 도구라서 "왕복 횟수·토큰"이 비용인데, 범용 도구엔 그 최적화(flow 컴파일, payload guard)가 없다.

**Q. 앱 코드는 안 고쳤나?**
A. 한 줄도 안 고쳤다. 디버그 빌드에 이미 켜져 있던 CDP 소켓(`webview_devtools_remote_<pid>`)을 `adb forward`로 끌어와 붙었을 뿐이다.

**Q. WebView를 어떻게 찾나?**
A. `adb shell cat /proc/net/unix`에서 `webview_devtools_remote_<pid>` 패턴의 abstract unix socket을 grep. 여러 개면 `/proc/<pid>/cmdline`으로 패키지명을 역추적해 `app` 파라미터 부분 일치로 고른다.

**Q. flow에서 OS 터치가 어떻게 한 콜에 섞이나?**
A. control signal 패턴. 브라우저 JS가 못 하는 step(osTap 등)에 도달하면 좌표만 계산해 리턴하며 중단 → Node가 ADB 실행 → 남은 step을 재컴파일해 이어서 실행 → 결과 병합. 호출자에겐 여전히 1콜.

**Q. 왜 스크린샷을 지양하나?**
A. base64 이미지는 토큰을 크게 먹고 판독도 부정확하다. `getComputedStyle` 값을 JSON으로 뽑으면 10~100배 빠르고 Figma 수치와 정확 비교가 된다. 스크린샷은 style로 안 잡히는 시각 문제(z-index 겹침 등)와 사람 확인용으로만.

**Q. CDP 이벤트는 어디에 쓰나?**
A. 연결 시 `Runtime.enable` 후 `consoleAPICalled`/`exceptionThrown`을 링버퍼에 상시 수집. flow 실행 구간의 error/warning만 커서로 잘라 결과에 자동 첨부한다. 실패 원인의 절반은 DOM이 아니라 JS 에러라서, 진단 왕복을 한 번 줄여준다.

**Q. 결과가 너무 크면?**
A. payload guard가 10KB 초과 시 큰 문자열부터 앞 500자+뒤 200자로 자르고 `__truncated` 메타를 남긴다. AI 컨텍스트 보호 장치.

**Q. 매크로는 왜 파일로 저장하나?**
A. 2회차부터 DOM 탐색·토큰 소비 없이 이름 하나로 재생하기 위해. 서버가 파일을 읽어 evaluate하므로 스크립트 본문이 대화에 다시 실리지 않는다. `__args` 주입으로 변형 실행도 파일 하나로 해결.

**Q. 보안 고려는?**
A. run_script 이름을 정규식으로 검증해 path traversal 차단, ADB keycode도 화이트리스트 정규식 검증, 셸 호출은 전부 `execFile`(문자열 셸 해석 없음), selector 문자열은 escape 처리.

**Q. 한계는?**
A. 디버그 빌드 전제, 네이티브 UI 불가, 회귀 테스트 아님(스코프 밖), 단일 세션. §10 참조.

---

# 부록: 설치 & 설정

## 요구 사항

- Node.js ≥ 18
- ADB (Android Platform Tools)
- 디버그 빌드 Android 앱 (`WebView.setWebContentsDebuggingEnabled(true)`)
- USB 또는 Wi-Fi로 연결된 Android 기기

## 설치 (Claude Code 플러그인 — 권장)

마켓플레이스 추가 후 설치합니다. 설치 시 dist가 함께 clone되므로 별도 빌드가 필요 없습니다.

```bash
claude plugin marketplace add yyoooon/webview-test-mcp
claude plugin install webview-test@webview-test-mcp
```

설치하면 MCP 서버가 자동 등록됩니다(`${CLAUDE_PLUGIN_ROOT}/dist/index.js`). **적용하려면 Claude Code를 재시작**하세요. 툴은 `mcp__plugin_webview-test_webview-test__*` 로 노출됩니다.

> 기존에 로컬 MCP(`mcpServers.webview-test`, 절대경로 실행)로 쓰던 경우, 서버 충돌을 피하려면 `claude mcp remove webview-test`로 먼저 제거하세요.

업데이트:

```bash
claude plugin marketplace update webview-test-mcp
# 재설치 후 Claude Code 재시작
```

## 검증 스크립트 스크래치 (`.webview-scripts/`)

프로젝트에서 검증용 스크립트를 브랜치 단위로 관리한다 (browser-verifier의 `.browser-verifier/`와 동일 방식). 전부 **로컬·gitignored**.

```
<repo>/.webview-scripts/
├── <branch-slug>/   ← 그 브랜치에서 만드는 스크래치 (브랜치 삭제 시 자동 정리)
└── _shared/         ← 브랜치 무관 공용 헬퍼 (스윕 제외)
```

- `<branch-slug>` = 현재 브랜치명의 `/` → `-` (예: `fix/foo` → `fix-foo`). main 작업은 `main/`.
- 플러그인의 **SessionStart 훅**(`hooks/session-start-webview-sweep.sh`)이 세션 시작 때: (1) `.webview-scripts/`가 있으면 `.gitignore`에 자동 등록, (2) git에 없는 브랜치의 `<branch-slug>/` 폴더를 스윕. `_shared/`는 항상 보존.
- 옵트아웃: `touch ~/.webview-test-no-session-check`.

## 개발용 로컬 실행

플러그인 배포 없이 소스를 직접 돌릴 때:

```bash
yarn install   # or npm install
yarn build     # tsc → dist/
```

클라이언트(`.mcp.json` 등)에 직접 등록:

```json
{
  "mcpServers": {
    "webview-test": {
      "command": "node",
      "args": ["/absolute/path/to/webview-test-mcp/dist/index.js"]
    }
  }
}
```

개발 중에는 `command: "tsx"`, `args: ["src/index.ts"]` 로도 실행 가능합니다.
