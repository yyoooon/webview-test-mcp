import { describe, it, expect } from 'vitest';
import { wrapForTarget, unwrapFromTarget } from '../src/transport.js';

describe('wrapForTarget', () => {
  it('wraps a CDP command into Target.sendMessageToTarget with stringified inner message', () => {
    const wrapped = wrapForTarget('page-1', { id: 7, method: 'Runtime.evaluate', params: { expression: '1+1' } });
    expect(wrapped.method).toBe('Target.sendMessageToTarget');
    expect(wrapped.params!.targetId).toBe('page-1');
    expect(JSON.parse(wrapped.params!.message as string)).toEqual({
      id: 7, method: 'Runtime.evaluate', params: { expression: '1+1' },
    });
  });
});

describe('unwrapFromTarget', () => {
  it('extracts inner CDP message from Target.dispatchMessageFromTarget', () => {
    const inner = { id: 7, result: { result: { value: 2 } } };
    const res = unwrapFromTarget({
      method: 'Target.dispatchMessageFromTarget',
      params: { targetId: 'page-1', message: JSON.stringify(inner) },
    });
    expect(res).toEqual({ kind: 'message', msg: inner });
  });

  it('recognizes a page targetCreated', () => {
    const res = unwrapFromTarget({
      method: 'Target.targetCreated',
      params: { targetInfo: { targetId: 'page-178', type: 'page' } },
    });
    expect(res).toEqual({ kind: 'targetCreated', targetId: 'page-178', type: 'page' });
  });

  it('recognizes targetDestroyed', () => {
    const res = unwrapFromTarget({ method: 'Target.targetDestroyed', params: { targetId: 'page-178' } });
    expect(res).toEqual({ kind: 'targetDestroyed', targetId: 'page-178' });
  });

  it('classifies an envelope ack (no method) as other', () => {
    expect(unwrapFromTarget({ id: 100, result: {} })).toEqual({ kind: 'other' });
  });
});
