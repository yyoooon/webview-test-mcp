export declare class CdpClient {
    private ws;
    private messageId;
    private pending;
    private _connected;
    private eventHandlers;
    /** connect 시 선택된 page 타겟의 committed URL (/json 응답 기준). 에러 페이지면 'chrome-error://...'. */
    private _pageUrl;
    get connected(): boolean;
    /** /json 타겟이 보고하는 실제 committed URL. location.href는 에러 페이지에서 의도한 URL을 반환하지만, 이 값은 chrome-error://를 그대로 노출한다. */
    get pageUrl(): string | null;
    on(method: string, handler: (params: Record<string, unknown>) => void): void;
    off(method: string, handler: (params: Record<string, unknown>) => void): void;
    connect(port: number): Promise<void>;
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
    close(): void;
}
