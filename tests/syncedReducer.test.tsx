import { act, renderHook } from "@testing-library/react";
import React from "react";
import { DefaultSessionContext, useSynced, useSyncedReducer } from "../src";
import { Sync as SyncClass } from "../src/sync";
import { MockSession } from "./utils/mocks";

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

  test("sendAction/startTask/cancelTask and sendBinary work via Sync", () => {
    const session = new MockSession();
    const wrapper = ({ children }: any) => (
      <DefaultSessionContext.Provider value={session as any}>
        {children}
      </DefaultSessionContext.Provider>
    );
    const { result } = renderHook(() => useSynced("KEY2", { x: 0 }), {
      wrapper,
    });

    act(() => {
      result.current.sendAction({ type: "A", p: 1 });
      result.current.startTask({ type: "T", id: 2 });
      result.current.cancelTask({ type: "T" });
    });
    expect(session.sent).toEqual([
      { event: "_ACTION:KEY2", data: { type: "A", p: 1 } },
      { event: "_TASK_START:KEY2", data: { type: "T", id: 2 } },
      { event: "_TASK_CANCEL:KEY2", data: { type: "T" } },
    ]);

    const buf = new Uint8Array([3]).buffer;
    act(() => {
      result.current.sendBinary({ type: "UPLOAD", name: "x" }, buf);
    });
    expect(session.sentBinary[0]).toEqual({
      event: "_ACTION:KEY2",
      meta: { type: "UPLOAD", name: "x" },
      data: buf,
    });
  });
});

describe("useSyncedReducer registerHandlers effect", () => {
  test("registerHandlers is called on mount but NOT every state update", () => {
    const registerSpy = jest.spyOn(SyncClass.prototype, "registerHandlers");

    const session = new MockSession();
    const wrapper = ({ children }: any) => (
      <DefaultSessionContext.Provider value={session as any}>
        {children}
      </DefaultSessionContext.Provider>
    );

    type S = { count: number };
    const reducer = (draft: S, action: any) => {
      if (action.type === "INC") {
        draft.count += 1;
      }
    };

    const { result } = renderHook(
      () =>
        useSyncedReducer<S>(
          "RH",
          reducer as any,
          { count: 0 } as any,
          null,
          false
        ),
      { wrapper }
    );

    // Initial mount -> one registration
    expect(registerSpy).toHaveBeenCalledTimes(1);

    // Each state update should NOT retrigger the effect and re-register handlers
    act(() => {
      result.current[1]({ type: "INC" } as any);
    });
    expect(registerSpy).toHaveBeenCalledTimes(1);

    act(() => {
      result.current[1]({ type: "INC" } as any);
    });
    expect(registerSpy).toHaveBeenCalledTimes(1);

    act(() => {
      result.current[1]({ type: "INC" } as any);
    });
    expect(registerSpy).toHaveBeenCalledTimes(1);

    registerSpy.mockRestore();
  });
});
