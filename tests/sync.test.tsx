import { act, renderHook } from "@testing-library/react";
import React from "react";
import { DefaultSessionContext, useSynced } from "../src";

class MockSession {
  events: Record<string, (data: any) => void> = {};
  inits: Record<string, () => void> = {};
  sent: { event: string; data: any }[] = [];
  send(event: string, data: any) {
    this.sent.push({ event, data });
  }
  sendBinary(event: string, meta: any, data: ArrayBuffer) {
    /* noop */
  }
  registerEvent(ev: string, cb: (data: any) => void) {
    this.events[ev] = cb;
  }
  deregisterEvent(ev: string) {
    delete this.events[ev];
  }
  registerInit(key: string, cb: () => void) {
    this.inits[key] = cb;
  }
  deregisterInit(key: string) {
    delete this.inits[key];
  }
}

describe("useSynced", () => {
  test("local updates and syncing", () => {
    const session = new MockSession();
    const wrapper = ({ children }: any) => (
      <DefaultSessionContext.Provider value={session as any}>
        {children}
      </DefaultSessionContext.Provider>
    );

    const { result: hookResult } = renderHook(
      () => useSynced("COUNTER", { count: 0 }),
      { wrapper }
    );

    act(() => {
      hookResult.current.setCount(1);
    });
    expect(hookResult.current.count).toBe(1);
    expect(session.sent).toHaveLength(0);

    act(() => {
      hookResult.current.syncCount(2);
    });
    expect(hookResult.current.count).toBe(2);
    expect(session.sent).toEqual([
      {
        event: "_PATCH:COUNTER",
        data: [{ op: "replace", path: "/count", value: 2 }],
      },
    ]);

    act(() => {
      hookResult.current.fetchRemoteState();
    });
    expect(session.sent[1]).toEqual({ event: "_GET:COUNTER", data: {} });

    // simulate remote patch
    act(() => {
      session.events["_PATCH:COUNTER"]([
        { op: "replace", path: "/count", value: 5 },
      ]);
    });
    expect(hookResult.current.count).toBe(5);
  });
});
