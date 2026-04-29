const PREFIX_LEN = 500;
const SUFFIX_LEN = 200;
const TRUNC_MARKER = ' ...[truncated]... ';

function byteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
}

function truncateString(s: string): string {
  if (s.length <= PREFIX_LEN + SUFFIX_LEN + TRUNC_MARKER.length) return s;
  return s.slice(0, PREFIX_LEN) + TRUNC_MARKER + s.slice(s.length - SUFFIX_LEN);
}

interface FieldEntry {
  path: string[];
  size: number;
  ref: { container: Record<string, unknown> | unknown[]; key: string | number };
  value: string;
}

function collectStringFields(
  obj: unknown,
  path: string[] = [],
  out: FieldEntry[] = [],
): FieldEntry[] {
  if (obj === null || obj === undefined) return out;
  if (typeof obj === 'string') return out;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => {
      if (typeof v === 'string') {
        out.push({
          path: [...path, String(i)],
          size: Buffer.byteLength(v, 'utf8'),
          ref: { container: obj, key: i },
          value: v,
        });
      } else {
        collectStringFields(v, [...path, String(i)], out);
      }
    });
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === 'string') {
        out.push({
          path: [...path, k],
          size: Buffer.byteLength(v, 'utf8'),
          ref: { container: obj as Record<string, unknown>, key: k },
          value: v,
        });
      } else {
        collectStringFields(v, [...path, k], out);
      }
    }
  }
  return out;
}

export function applyPayloadGuard(
  payload: unknown,
  maxBytes: number,
): unknown {
  if (byteSize(payload) <= maxBytes) return payload;
  if (payload === null || typeof payload !== 'object') return payload;

  const cloned = JSON.parse(JSON.stringify(payload)) as unknown;
  const fields = collectStringFields(cloned).sort((a, b) => b.size - a.size);
  const truncated: string[] = [];
  for (const f of fields) {
    if (byteSize(cloned) <= maxBytes) break;
    const newVal = truncateString(f.value);
    if (newVal === f.value) continue;
    if (Array.isArray(f.ref.container)) {
      f.ref.container[f.ref.key as number] = newVal;
    } else {
      f.ref.container[f.ref.key as string] = newVal;
    }
    truncated.push(f.path.join('.'));
  }
  if (typeof cloned === 'object' && cloned !== null && !Array.isArray(cloned)) {
    (cloned as Record<string, unknown>).__truncated = {
      fields: truncated,
      originalBytes: byteSize(payload),
    };
  }
  return cloned;
}
