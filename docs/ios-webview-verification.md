# iOS WebView 지원 — 검증 절차와 결과

> 2026-07-15. `feat/ios-webview-support`에서 Android 전용 → Android + iOS(Safari/WKWebView) 확장.
> 설계: `docs/superpowers/specs/2026-07-15-ios-webview-support-design.md` / 계획: `docs/superpowers/plans/2026-07-15-ios-webview-support.md`

## 무엇이 되나 (실기기 검증 완료)

iPhone(iOS 26.5) 실기기에서 콜드스타트 포함 전 기능 검증됨:

| 기능 | iOS | 비고 |
|------|-----|------|
| `webview_connect` | ✅ | `ios-webkit-debug-proxy` 자동 spawn + CDP `Target` 래핑 |
| `webview_evaluate` | ✅ | |
| `webview_get_dom` | ✅ | |
| `webview_screenshot` | ✅ | `Page.captureScreenshot` 대신 `Page.snapshotRect` |
| 콘솔 로그 수집 | ✅ | `Console.messageAdded` (Chrome은 `Runtime.consoleAPICalled`) |
| `webview_click` / `webview_type` | ✅ | `Input` 도메인 대신 `Runtime.evaluate`로 `elementFromPoint().click()` / value 주입 |
| `webview_flow` | ✅ | iOS는 `awaitPromise` 미지원 → 전역 저장 후 폴링으로 세그먼트 수신 |

## 동작 원리 (Android과 다른 점)

Android는 `adb`로 CDP 소켓에 붙지만, iOS는:

1. **다리**: `ios-webkit-debug-proxy`가 USB(usbmuxd)로 iPhone의 WebKit 인스펙터를 CDP 유사 엔드포인트로 번역. 플러그인이 이 proxy를 자동으로 띄우고 종료 시 정리.
2. **Target 래핑**: iOS 17+ WebKit은 명령을 `Target.sendMessageToTarget`으로 감싸야 받고, 응답/이벤트는 `Target.dispatchMessageFromTarget`으로 감싸서 옴. `IosTargetTransport`가 이 번역을 전담.
3. **명령 차이**: 스크린샷(`snapshotRect`), 콘솔(`Console.messageAdded`), 클릭/입력(`Input` 도메인 없음 → evaluate), flow(`awaitPromise` 무시 → 폴링).

## 사전조건

- **macOS** (proxy가 `usbmuxd` 의존)
- `brew install ios-webkit-debug-proxy` (libimobiledevice 동반 설치)
- iPhone을 **USB로 연결**하고 **개발자 신뢰**(페어링)
- iOS Safari 설정 → 고급 → **웹 인스펙터 ON**
- 검사 대상 페이지가 **열려 있어야** 함 (Safari 탭 또는 앱 웹뷰 foreground)
- ⚠️ **맥의 Safari 웹 인스펙터 창은 닫아둘 것** — iOS는 페이지당 원격 검사기를 하나만 허용. 열려 있으면 proxy 명령이 무응답(타임아웃)

## 사용

```
webview_connect({ platform: "ios" })
```

`platform` 생략 시 자동 감지(Android·iOS 중 연결된 것). 둘 다 연결되어 있으면 `platform`을 명시해야 함(`PLATFORM_AMBIGUOUS`).

WebView가 여러 개면 `socketIndex`(페이지 인덱스) 또는 `app`(iOS는 **페이지 URL 부분일치**, Android는 패키지명 부분일치)으로 선택.

## 알려진 한계 (iOS)

- **`osTap`/`osSwipe`/`osKey`(OS-level 터치·키)** 는 `adb` 의존이라 iOS 미지원. 화면 내 클릭/입력은 `webview_click`/`webview_type`으로 가능(키보드가 필요한 네이티브 IME 상호작용은 불가).
- **iOS 시뮬레이터 미지원** (실기기만; 시뮬레이터는 소켓 경로가 다름 — 후속 과제).
- **Windows/Linux 미지원** (proxy가 macOS 전용).
- proxy가 완전히 종료된 상태의 첫 연결은 기기 인스펙터가 cold라 페이지 열거가 지연될 수 있음 → 플러그인이 페이지가 보일 때까지 폴링(`discoverIosPages`)으로 흡수.

## 재현 절차 (스모크)

사전조건 충족 후, 컴파일된 핸들러를 직접 호출하는 드라이버로 검증:

1. `webview_connect({ platform: "ios" })` → 연결 성공 + 현재 URL
2. `webview_evaluate` → `document.title`
3. `webview_get_dom` → 요소 요약
4. `webview_screenshot` → 이미지(snapshotRect)
5. 콘솔 로그가 있는 페이지에서 로그 수집 확인
6. `webview_click` → 요소 클릭 반영
7. `webview_type` → 입력값 readback 일치
8. `webview_flow` (waitFor + capture) → marks/captured 반환
