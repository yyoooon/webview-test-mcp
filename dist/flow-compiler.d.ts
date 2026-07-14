import { Selector } from "./selector.js";
export interface ClickStep {
    click: Selector;
}
export interface TypeStep {
    type: {
        selector: Selector;
        text: string;
    };
}
export interface WaitForStep {
    waitFor: WaitCond;
    timeout?: number;
}
export interface SleepStep {
    sleep: number;
}
export interface GotoStep {
    /** 문자열: SPA 클라이언트 라우팅 (pushState). 객체: 실제 네비게이션 (CDP Page.navigate / Page.reload). */
    goto: string | {
        url?: string;
        reload?: boolean;
        timeout?: number;
    };
}
export interface CaptureStep {
    capture: CaptureSpec;
}
export interface RawStep {
    raw: string;
}
export interface AssertStep {
    assert: {
        kind: "text-visible" | "url-equals" | "no-dialog";
        value?: string;
    };
}
export interface InspectTargetSpec {
    selector: string;
    /** getComputedStyle 프로퍼티 이름 배열. 예: ['fontSize', 'fontWeight', 'lineHeight', 'marginTop', 'gap'] */
    style?: string[];
    /** true면 textContent 포함 */
    text?: boolean;
    /** true면 classList 배열 포함 */
    classList?: boolean;
    /** true면 width/height/x/y 포함, 또는 ['width','height'] 같은 부분 선택 */
    rect?: boolean | string[];
    /** HTML 속성 이름 배열. 예: ['data-state', 'aria-label'] */
    attr?: string[];
}
export interface InspectStep {
    /** Figma spec 비교용. 한 콜에 여러 selector의 computed style/text/classList/rect 뽑기.
     *  키는 자유롭게 지정 (예: title, badge, ctaButton). 결과는 같은 키로 평탄하게 반환. */
    inspect: Record<string, InspectTargetSpec>;
}
export interface OsTapStep {
    /** OS-level tap via ADB. WebView가 합성 click 이벤트로 띄우지 못하는 키보드/네이티브 인풋 같은 케이스에 사용.
     *  실제 ADB shell input tap은 flowHandler가 좌표를 받은 뒤 Node 레이어에서 실행. */
    osTap: Selector | {
        selector: Selector;
        offsetX?: number;
        offsetY?: number;
    };
}
export interface ScrollStep {
    /** 페이지 내 JS 스크롤. to: 요소로 scrollIntoView / by: 픽셀 단위 (container 없으면 window). */
    scroll: {
        to: Selector;
        block?: "start" | "center" | "end" | "nearest";
    } | {
        by: {
            x?: number;
            y?: number;
        };
        container?: string;
    };
}
export interface OsSwipeStep {
    osSwipe: {
        direction: "up" | "down" | "left" | "right";
        distance?: number;
        durationMs?: number;
        from?: Selector;
    };
}
export interface OsKeyStep {
    /** ADB keyevent. 'BACK', 'ENTER', 'HOME' 또는 'KEYCODE_BACK' 형식. flowHandler가 ADB로 실행. */
    osKey: string;
}
export type FlowStep = ClickStep | TypeStep | WaitForStep | SleepStep | GotoStep | CaptureStep | RawStep | AssertStep | InspectStep | OsTapStep | ScrollStep | OsSwipeStep | OsKeyStep;
export type WaitCond = {
    selector: string;
} | {
    text: string;
    within?: string;
} | {
    role: string;
} | {
    gone: string;
} | {
    url: string;
} | {
    network: string | {
        method?: string;
        url: string;
    };
    timeout?: number;
} | {
    appearsThenGone: string;
    windowMs?: number;
};
export interface CaptureSpec {
    url?: boolean;
    scenario?: boolean;
    dialog?: {
        buttons?: boolean;
        text?: boolean;
        headings?: boolean;
    };
    toast?: boolean;
    storage?: {
        session?: string[];
        local?: string[];
    };
    custom?: Record<string, string>;
}
export interface FlowInput {
    steps: FlowStep[];
    bail?: "on-error" | "continue";
    outputMaxBytes?: number;
}
export interface CompileFlowOptions {
    /** 0이 아니면 stepsCode의 step 인덱스를 startIndex 만큼 오프셋해서 컴파일. flowHandler가 control step(osTap/osSwipe 등) 후 잔여 step을 재컴파일할 때 사용. */
    startIndex?: number;
}
export declare function compileFlow(input: FlowInput, options?: CompileFlowOptions): string;
