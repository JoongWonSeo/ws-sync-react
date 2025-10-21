import { act, renderHook } from "@testing-library/react";
import React from "react";
import {
  DefaultSessionContext,
  useObserved,
  useSynced,
  useSyncedReducer,
} from "../src";

class MockSession {
  events: Record<string, (data: any) => void> = {};
  inits: Record<string, () => void> = {};
  sent: { event: string; data: any }[] = [];
  sentBinary: { event: string; meta: any; data: ArrayBuffer }[] = [];
  send(event: string, data: any) {
    this.sent.push({ event, data });
  }
  sendBinary(event: string, meta: any, data: ArrayBuffer) {
    this.sentBinary.push({ event, meta, data });
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

function withSession(session: any) {
  return ({ children }: any) => (
    <DefaultSessionContext.Provider value={session}>
      {children}
    </DefaultSessionContext.Provider>
  );
}

describe("useSyncedReducer: event wiring and teardown", () => {
  test("registers events and optional init; deregisters on unmount", () => {
    const session = new MockSession();
    const wrapper = withSession(session as any);
    const { unmount } = renderHook(
      () => useSyncedReducer("KEY", (d: any) => d, { a: 1 }, null, true),
      { wrapper }
    );

    expect(Object.keys(session.events).sort()).toEqual(
      ["_ACTION:KEY", "_GET:KEY", "_PATCH:KEY", "_SET:KEY"].sort()
    );
    expect(Object.keys(session.inits)).toEqual(["KEY"]);

    unmount();
    expect(Object.keys(session.events)).toHaveLength(0);
    expect(Object.keys(session.inits)).toHaveLength(0);
  });

  test("init callback sends latest state snapshot when invoked", () => {
    const session = new MockSession();
    const wrapper = withSession(session as any);
    const { result } = renderHook(
      () => useSynced("INIT", { count: 0 }, null, true),
      { wrapper }
    );

    // Change local state before init is invoked
    act(() => {
      result.current.setCount(42);
    });

    // Simulate backend calling init handler
    act(() => {
      session.inits["INIT"]?.();
    });

    // It should send the full state with the latest value
    const last = session.sent.pop();
    expect(last).toEqual({ event: "_SET:INIT", data: { count: 42 } });
  });
});

describe("useSyncedReducer: remote set/patch and local setters/syncers", () => {
  test("applies remote _SET and _PATCH, and exposes setters/syncers", () => {
    const session = new MockSession();
    const wrapper = withSession(session as any);
    const { result } = renderHook(
      () => useSynced("OBJ", { count: 0, label: "x" }),
      { wrapper }
    );

    // Remote set replaces state
    act(() => {
      session.events["_SET:OBJ"]({ count: 10, label: "y" });
    });
    expect(result.current.count).toBe(10);
    expect(result.current.label).toBe("y");

    // Remote patch updates
    act(() => {
      session.events["_PATCH:OBJ"]([
        { op: "replace", path: "/count", value: 2 },
      ]);
    });
    expect(result.current.count).toBe(2);

    // Local setter: no network
    act(() => {
      result.current.setLabel("z");
    });
    expect(result.current.label).toBe("z");
    expect(session.sent).toHaveLength(0);

    // Local syncer: sends patch
    act(() => {
      result.current.syncCount(3);
    });
    expect(result.current.count).toBe(3);
    expect(session.sent.pop()).toEqual({
      event: "_PATCH:OBJ",
      data: [{ op: "replace", path: "/count", value: 3 }],
    });

    // fetchRemoteState
    act(() => {
      result.current.fetchRemoteState();
    });
    expect(session.sent.pop()).toEqual({ event: "_GET:OBJ", data: {} });

    // sendAction/startTask/cancelTask
    act(() => {
      result.current.sendAction({ type: "DO", n: 1 });
      result.current.startTask({ type: "TASK", id: 5 });
      result.current.cancelTask({ type: "TASK" });
    });
    expect(session.sent).toEqual([
      { event: "_ACTION:OBJ", data: { type: "DO", n: 1 } },
      { event: "_TASK_START:OBJ", data: { type: "TASK", id: 5 } },
      { event: "_TASK_CANCEL:OBJ", data: { type: "TASK" } },
    ]);

    // sendBinary
    const buf = new Uint8Array([1, 2]).buffer;
    act(() => {
      result.current.sendBinary({ type: "UPLOAD", file: "a" }, buf);
    });
    expect(session.sentBinary[0]).toEqual({
      event: "_ACTION:OBJ",
      meta: { type: "UPLOAD", file: "a" },
      data: buf,
    });
  });
});

describe("useSyncedReducer: custom reducer sync/delegate behavior", () => {
  type S = { nested: { arr: { x: number }[] } };
  test("sync sends converted patch paths and delegate sends action", () => {
    const session = new MockSession();
    const wrapper = withSession(session as any);
    const reducer = (draft: S, action: any, sync: any, delegate: any) => {
      switch (action.type) {
        case "INC":
          draft.nested.arr[0].x += action.by;
          sync();
          break;
        case "REMOTE":
          delegate();
          break;
        case "LOCAL_ONLY":
          draft.nested.arr[0].x = 999;
          break;
      }
    };

    const { result } = renderHook(
      () =>
        useSyncedReducer<S>(
          "NEST",
          reducer,
          { nested: { arr: [{ x: 1 }] } },
          null,
          false
        ),
      { wrapper }
    );

    // Dispatch INC -> local change and patch sent
    act(() => {
      const [, dispatch] = result.current;
      dispatch({ type: "INC", by: 2 });
    });
    // Effects have run; last send should be _PATCH:NEST
    const last = session.sent[session.sent.length - 1];
    expect(last.event).toBe("_PATCH:NEST");
    expect(Array.isArray(last.data)).toBe(true);
    // Path is a string and has leading slash; target nested/arr/0/x
    const p = last.data[0];
    expect(typeof p.path).toBe("string");
    expect(p.path.startsWith("/")).toBe(true);
    expect(
      p.path.endsWith("nested/arr/0/x") || p.path.endsWith("/nested/arr/0/x")
    ).toBe(true);

    // Dispatch REMOTE -> original action is sent
    act(() => {
      const [, dispatch] = result.current;
      dispatch({ type: "REMOTE", v: 1 });
    });
    const lastAction = session.sent[session.sent.length - 1];
    expect(lastAction).toEqual({
      event: "_ACTION:NEST",
      data: { type: "REMOTE", v: 1 },
    });

    // LOCAL_ONLY -> no network side effect
    const before = session.sent.length;
    act(() => {
      const [, dispatch] = result.current;
      dispatch({ type: "LOCAL_ONLY" });
    });
    expect(session.sent.length).toBe(before);
  });
});

describe("useSyncedReducer: routes remote ACTION through reducer", () => {
  test("remote _ACTION updates state via supplied reducer", () => {
    const session = new MockSession();
    const wrapper = withSession(session as any);
    const reducer = (draft: { v: number }, action: any) => {
      if (action.type === "ADD") {
        draft.v += action.by;
      }
    };

    const { result } = renderHook(
      () => useSyncedReducer("ACT", reducer as any, { v: 1 }),
      { wrapper }
    );

    act(() => {
      session.events["_ACTION:ACT"]({ type: "ADD", by: 3 });
    });
    expect(result.current[0].v).toBe(4);
  });
});

describe("useObserved: exposes readonly state and fetchRemoteState", () => {
  test("returns state subset and fetch method only", () => {
    const session = new MockSession();
    const wrapper = withSession(session as any);
    const { result } = renderHook(() => useObserved("OBS", { a: 1, b: 2 }), {
      wrapper,
    });

    // Should expose only a and b and fetchRemoteState
    expect(result.current.a).toBe(1);
    expect(result.current.b).toBe(2);
    expect(typeof result.current.fetchRemoteState).toBe("function");
    expect((result.current as any).setA).toBeUndefined();

    // Remote patch updates readonly view
    act(() => {
      session.events["_PATCH:OBS"]([{ op: "replace", path: "/a", value: 5 }]);
    });
    expect(result.current.a).toBe(5);

    act(() => {
      result.current.fetchRemoteState();
    });
    expect(session.sent.pop()).toEqual({ event: "_GET:OBS", data: {} });
  });
});
