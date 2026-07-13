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
