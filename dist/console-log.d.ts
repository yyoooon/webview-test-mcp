import { CdpClient } from './cdp.js';
export interface ConsoleEntry {
    kind: 'console' | 'exception';
    level: string;
    text: string;
}
export declare class ConsoleBuffer {
    private entries;
    private total;
    /** 지금까지 push된 누적 개수. flow 시작 시점 저장 → since()로 그 이후분만 조회. */
    get cursor(): number;
    push(entry: ConsoleEntry): void;
    since(cursor: number): ConsoleEntry[];
    attach(cdp: CdpClient, platform?: 'android' | 'ios' | null): Promise<void>;
}
