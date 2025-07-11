import React from 'react';
import { renderHook, act } from '@testing-library/react-hooks';
import { useSynced, DefaultSessionContext } from '../src';

class MockSession {
  events: Record<string, (data: any) => void> = {};
  inits: Record<string, () => void> = {};
  sent: {event: string, data: any}[] = [];
  send(event: string, data: any) { this.sent.push({event, data}); }
  sendBinary(event: string, meta: any, data: ArrayBuffer) { /* noop */ }
  registerEvent(ev: string, cb: (data:any)=>void) { this.events[ev] = cb; }
  deregisterEvent(ev: string) { delete this.events[ev]; }
  registerInit(key: string, cb: ()=>void) { this.inits[key] = cb; }
  deregisterInit(key: string) { delete this.inits[key]; }
}

describe('useSynced', () => {
  test('local updates and syncing', () => {
    const session = new MockSession();
    const wrapper = ({children}: any) => (
      <DefaultSessionContext.Provider value={session as any}>{children}</DefaultSessionContext.Provider>
    );

    const { result } = renderHook(() => useSynced('COUNTER', { count: 0 }), { wrapper });

    act(() => { result.current.setCount(1); });
    expect(result.current.count).toBe(1);
    expect(session.sent).toHaveLength(0);

    act(() => { result.current.syncCount(2); });
    expect(result.current.count).toBe(2);
    expect(session.sent).toEqual([
      { event: '_PATCH:COUNTER', data: [{ op: 'replace', path: '/count', value: 2 }] }
    ]);

    act(() => { result.current.fetchRemoteState(); });
    expect(session.sent[1]).toEqual({ event: '_GET:COUNTER', data: {} });

    // simulate remote patch
    act(() => { session.events['_PATCH:COUNTER']([{ op: 'replace', path: '/count', value: 5 }]); });
    expect(result.current.count).toBe(5);
  });
});
