const MAX_ENTRIES = 100;
const MAX_TEXT_LENGTH = 300;
function formatArgs(args) {
    return args
        .map((a) => a.value !== undefined
        ? typeof a.value === 'object'
            ? JSON.stringify(a.value)
            : String(a.value)
        : (a.description ?? a.type ?? ''))
        .join(' ')
        .slice(0, MAX_TEXT_LENGTH);
}
export class ConsoleBuffer {
    entries = [];
    total = 0;
    /** 지금까지 push된 누적 개수. flow 시작 시점 저장 → since()로 그 이후분만 조회. */
    get cursor() {
        return this.total;
    }
    push(entry) {
        this.entries.push(entry);
        this.total += 1;
        if (this.entries.length > MAX_ENTRIES)
            this.entries.shift();
    }
    since(cursor) {
        const firstKept = this.total - this.entries.length;
        return this.entries.slice(Math.max(0, cursor - firstKept));
    }
    async attach(cdp, platform) {
        cdp.on('Runtime.consoleAPICalled', (params) => {
            const p = params;
            this.push({ kind: 'console', level: p.type ?? 'log', text: formatArgs(p.args ?? []) });
        });
        cdp.on('Runtime.exceptionThrown', (params) => {
            const p = params;
            const d = p.exceptionDetails;
            const text = (d?.exception?.description ?? d?.text ?? 'Unknown exception').slice(0, MAX_TEXT_LENGTH);
            this.push({ kind: 'exception', level: 'error', text });
        });
        if (platform === 'ios') {
            cdp.on('Console.messageAdded', (params) => {
                const p = params;
                this.push({ kind: 'console', level: p.message?.level ?? 'log', text: (p.message?.text ?? '').slice(0, MAX_TEXT_LENGTH) });
            });
        }
        await cdp.send('Runtime.enable');
        if (platform === 'ios') {
            await cdp.send('Console.enable').catch(() => { });
        }
    }
}
//# sourceMappingURL=console-log.js.map