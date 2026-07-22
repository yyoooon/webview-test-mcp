import WebSocket from 'ws';
export function wrapForTarget(targetId, msg) {
    return {
        id: msg.id,
        method: 'Target.sendMessageToTarget',
        params: { targetId, message: JSON.stringify(msg) },
    };
}
export function unwrapFromTarget(raw) {
    const method = raw.method;
    const params = (raw.params ?? {});
    if (method === 'Target.dispatchMessageFromTarget') {
        const msg = JSON.parse(params.message);
        return { kind: 'message', msg };
    }
    if (method === 'Target.targetCreated') {
        const info = (params.targetInfo ?? {});
        return { kind: 'targetCreated', targetId: info.targetId, type: info.type };
    }
    if (method === 'Target.targetDestroyed') {
        return { kind: 'targetDestroyed', targetId: params.targetId };
    }
    return { kind: 'other' };
}
export class RawTransport {
    wsUrl;
    ws = null;
    messageCb = () => { };
    closeCb = () => { };
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
    }
    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.wsUrl);
            this.ws.on('open', () => resolve());
            this.ws.on('message', (data) => {
                this.messageCb(JSON.parse(data.toString()));
            });
            this.ws.on('close', () => this.closeCb());
            this.ws.on('error', (err) => { this.closeCb(); reject(err); });
        });
    }
    send(msg) {
        this.ws.send(JSON.stringify(msg));
    }
    onMessage(cb) { this.messageCb = cb; }
    onClose(cb) { this.closeCb = cb; }
    close() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
export class IosTargetTransport {
    wsUrl;
    ws = null;
    messageCb = () => { };
    closeCb = () => { };
    pageTargetId = null;
    onPageReady = null;
    announceTimer = null;
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
    }
    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.wsUrl);
            this.announceTimer = setTimeout(() => reject(new Error('iOS page target announce 타임아웃 (맥 웹 인스펙터 창을 닫으세요)')), 5000);
            this.onPageReady = () => {
                if (this.announceTimer)
                    clearTimeout(this.announceTimer);
                this.announceTimer = null;
                resolve();
            };
            this.ws.on('message', (data) => {
                const raw = JSON.parse(data.toString());
                const u = unwrapFromTarget(raw);
                if (u.kind === 'targetCreated' && u.type === 'page') {
                    this.pageTargetId = u.targetId;
                    this.onPageReady?.();
                    this.onPageReady = null;
                }
                else if (u.kind === 'message') {
                    this.messageCb(u.msg);
                }
                // targetDestroyed / other → 무시
            });
            this.ws.on('close', () => this.closeCb());
            this.ws.on('error', (err) => {
                if (this.announceTimer)
                    clearTimeout(this.announceTimer);
                this.announceTimer = null;
                this.closeCb();
                reject(err);
            });
        });
    }
    send(msg) {
        if (!this.pageTargetId)
            throw new Error('iOS page target 미확보');
        this.ws.send(JSON.stringify(wrapForTarget(this.pageTargetId, msg)));
    }
    onMessage(cb) { this.messageCb = cb; }
    onClose(cb) { this.closeCb = cb; }
    close() {
        if (this.announceTimer) {
            clearTimeout(this.announceTimer);
            this.announceTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
//# sourceMappingURL=transport.js.map