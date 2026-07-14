const PREFIX_LEN = 500;
const SUFFIX_LEN = 200;
const TRUNC_MARKER = ' ...[truncated]... ';
function byteSize(value) {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
}
function truncateString(s) {
    if (s.length <= PREFIX_LEN + SUFFIX_LEN + TRUNC_MARKER.length)
        return s;
    return s.slice(0, PREFIX_LEN) + TRUNC_MARKER + s.slice(s.length - SUFFIX_LEN);
}
function collectStringFields(obj, path = [], out = []) {
    if (obj === null || obj === undefined)
        return out;
    if (typeof obj === 'string')
        return out;
    if (Array.isArray(obj)) {
        obj.forEach((v, i) => {
            if (typeof v === 'string') {
                out.push({
                    path: [...path, String(i)],
                    size: Buffer.byteLength(v, 'utf8'),
                    ref: { container: obj, key: i },
                    value: v,
                });
            }
            else {
                collectStringFields(v, [...path, String(i)], out);
            }
        });
        return out;
    }
    if (typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
            if (typeof v === 'string') {
                out.push({
                    path: [...path, k],
                    size: Buffer.byteLength(v, 'utf8'),
                    ref: { container: obj, key: k },
                    value: v,
                });
            }
            else {
                collectStringFields(v, [...path, k], out);
            }
        }
    }
    return out;
}
export function applyPayloadGuard(payload, maxBytes) {
    if (byteSize(payload) <= maxBytes)
        return payload;
    if (payload === null || typeof payload !== 'object')
        return payload;
    const cloned = JSON.parse(JSON.stringify(payload));
    const fields = collectStringFields(cloned).sort((a, b) => b.size - a.size);
    const truncated = [];
    for (const f of fields) {
        if (byteSize(cloned) <= maxBytes)
            break;
        const newVal = truncateString(f.value);
        if (newVal === f.value)
            continue;
        if (Array.isArray(f.ref.container)) {
            f.ref.container[f.ref.key] = newVal;
        }
        else {
            f.ref.container[f.ref.key] = newVal;
        }
        truncated.push(f.path.join('.'));
    }
    if (typeof cloned === 'object' && cloned !== null && !Array.isArray(cloned)) {
        cloned.__truncated = {
            fields: truncated,
            originalBytes: byteSize(payload),
        };
    }
    return cloned;
}
//# sourceMappingURL=payload-guard.js.map