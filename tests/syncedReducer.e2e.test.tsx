import { act, render, screen } from "@testing-library/react";
import WS from "jest-websocket-mock";
import React from "react";
import {
  DefaultSessionContext,
  Session,
  useObserved,
  useSynced,
  useSyncedReducer,
} from "../src";
import { createToastMock } from "./utils/mocks";

// Use fake timers where reconnection/backoff could interfere
afterEach(() => {
  jest.clearAllMocks();
  WS.clean();
});

function CounterView({ label }: { label: string }) {
  type S = { count: number };
  const reducer = (
    draft: S,
    action: any,
    sync: () => void,
    delegate: (a?: any) => void
  ) => {
    switch (action.type) {
      case "INC":
        draft.count += action.by ?? 1;
        sync();
        break;
      case "REMOTE":
        delegate();
        break;
    }
  };

  const [state, dispatch] = useSyncedReducer<S>(
    label,
    reducer as any,
    { count: 0 },
    null,
    false
  );

  return (
    <div>
      <div data-testid={`count-${label}`}>{state.count}</div>
      <button onClick={() => dispatch({ type: "INC", by: 2 })}>inc</button>
    </div>
  );
}

describe("synced reducer e2e with real Session + mocked ws", () => {
  test("remote _SET and _PATCH update state and cause re-render", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const toast = createToastMock();
    const session = new Session({ url: "ws://localhost", label: "Srv", toast });

    render(
      <DefaultSessionContext.Provider value={session}>
        <CounterView label="E2E" />
      </DefaultSessionContext.Provider>
    );

    // establish websocket
    const cleanup = session.connect();
    await server.connected;

    // Remote _SET should overwrite and render
    act(() => {
      server.send({ type: "_SET:E2E", data: { count: 10 } });
    });
    expect(screen.getByTestId("count-E2E").textContent).toBe("10");

    // Remote _PATCH should apply json-patch and render
    act(() => {
      server.send({
        type: "_PATCH:E2E",
        data: [{ op: "replace", path: "/count", value: 3 }],
      });
    });
    expect(screen.getByTestId("count-E2E").textContent).toBe("3");
    cleanup?.();
  });

  test("local dispatch triggers patch send; remote _ACTION routes through reducer", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const toast = createToastMock();
    const session = new Session({ url: "ws://localhost", label: "Srv", toast });

    render(
      <DefaultSessionContext.Provider value={session}>
        <CounterView label="E2E2" />
      </DefaultSessionContext.Provider>
    );

    const cleanup = session.connect();
    await server.connected;

    // Click inc button -> reducer drafts count+=2, sync() flushes patches
    act(() => {
      screen.getByText("inc").click();
    });

    // Last frame should be a _PATCH:E2E2 with replace /count
    const last = (await server.nextMessage) as any;
    expect(last.type).toBe("_PATCH:E2E2");
    expect(Array.isArray(last.data)).toBe(true);
    expect(last.data[0].op).toBe("replace");
    expect(last.data[0].path).toBe("/count");

    // Remote action should route through reducer and update state
    act(() => {
      server.send({ type: "_ACTION:E2E2", data: { type: "INC", by: 5 } });
    });
    expect(screen.getByTestId("count-E2E2").textContent).toBe("7");

    cleanup?.();
  });
});

function SyncedObjView() {
  const state = useSynced<{ count: number; label: string }>("SYNCED", {
    count: 0,
    label: "x",
  });

  return (
    <div>
      <div data-testid="count-synced">{state.count}</div>
      <div data-testid="label-synced">{state.label}</div>
      <button onClick={() => state.setCount(state.count + 1)}>setCount</button>
      <button onClick={() => state.setLabel(state.label + "!")}>
        setLabel
      </button>
      <button onClick={() => state.syncCount(state.count + 2)}>
        syncCount
      </button>
      <button onClick={() => state.syncLabel(state.label + "?")}>
        syncLabel
      </button>
      <button
        onClick={() => {
          state.setLabel("z");
          state.syncCount(5);
        }}
      >
        mixSetLabelSyncCount
      </button>
    </div>
  );
}

describe("useSynced e2e setters vs syncers", () => {
  test("setters update UI without emitting network; syncers emit _PATCH", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const toast = createToastMock();
    const session = new Session({ url: "ws://localhost", label: "Srv", toast });

    render(
      <DefaultSessionContext.Provider value={session}>
        <SyncedObjView />
      </DefaultSessionContext.Provider>
    );

    const cleanup = session.connect();
    await server.connected;

    // Setters only -> no network traffic but UI updates
    act(() => {
      screen.getByText("setCount").click();
      screen.getByText("setLabel").click();
    });
    expect(screen.getByTestId("count-synced").textContent).toBe("1");
    expect(screen.getByTestId("label-synced").textContent).toBe("x!");
    // shortly wait and then expect no messages
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server).toHaveReceivedMessages([]);

    // Syncers -> emit _PATCH frames
    act(() => {
      screen.getByText("syncCount").click();
    });
    const last = (await server.nextMessage) as any;
    expect(last.type).toBe("_PATCH:SYNCED");
    expect(last.data[0]).toEqual({ op: "replace", path: "/count", value: 3 });
    expect(screen.getByTestId("count-synced").textContent).toBe("3");

    act(() => {
      screen.getByText("syncLabel").click();
    });
    const last2 = (await server.nextMessage) as any;
    expect(last2.type).toBe("_PATCH:SYNCED");
    expect(last2.data[0]).toEqual({
      op: "replace",
      path: "/label",
      value: "x!?",
    });
    expect(screen.getByTestId("label-synced").textContent).toBe("x!?");

    cleanup?.();
  });

  test("mixing set and sync sends only synced field patch", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const toast = createToastMock();
    const session = new Session({ url: "ws://localhost", label: "Srv", toast });

    render(
      <DefaultSessionContext.Provider value={session}>
        <SyncedObjView />
      </DefaultSessionContext.Provider>
    );

    const cleanup = session.connect();
    await server.connected;

    // Mix: set label locally, then sync count -> only count patch emitted
    act(() => {
      screen.getByText("mixSetLabelSyncCount").click();
    });

    const last = (await server.nextMessage) as any;
    expect(last.type).toBe("_PATCH:SYNCED");
    expect(last.data).toEqual([{ op: "replace", path: "/count", value: 5 }]);
    // UI reflects both local set and synced count
    expect(screen.getByTestId("label-synced").textContent).toBe("z");
    expect(screen.getByTestId("count-synced").textContent).toBe("5");

    cleanup?.();
  });
});

describe("additional coverage for synced-reducer.ts", () => {
  test("throws when no Session provided in context or override", () => {
    function BadComp() {
      useSyncedReducer("BAD", undefined as any, { a: 1 } as any);
      return null;
    }
    expect(() => render(<BadComp />)).toThrow(
      "useSyncedReducer requires a Session"
    );
  });

  test("without reducer, custom actions are ignored and emit no network", async () => {
    function NoReducerView() {
      const [state, dispatch] = useSyncedReducer("NOR", undefined, {
        a: 1,
      } as any);
      return (
        <div>
          <div data-testid="a-nor">{(state as any).a}</div>
          <button onClick={() => dispatch({ type: "NOOP" } as any)}>
            noop
          </button>
        </div>
      );
    }

    const session = new Session({ url: "ws://localhost" });
    const server = new WS("ws://localhost", { jsonProtocol: true });
    render(
      <DefaultSessionContext.Provider value={session}>
        <NoReducerView />
      </DefaultSessionContext.Provider>
    );
    const cleanup = session.connect();
    await server.connected;

    act(() => {
      screen.getByText("noop").click();
    });
    expect(screen.getByTestId("a-nor").textContent).toBe("1");
    expect(
      await Promise.race([
        server.nextMessage.then(() => "msg"),
        new Promise((r) => setTimeout(() => r("none"), 30)),
      ])
    ).toBe("none");

    cleanup?.();
  });

  test("_GET triggers sendState of current snapshot (covers getState path)", async () => {
    const session = new Session({ url: "ws://localhost" });
    const server = new WS("ws://localhost", { jsonProtocol: true });
    render(
      <DefaultSessionContext.Provider value={session}>
        <SyncedObjView />
      </DefaultSessionContext.Provider>
    );
    const cleanup = session.connect();
    await server.connected;

    // Change local state first
    act(() => {
      screen.getByText("setCount").click(); // count: 1
    });

    act(() => {
      server.send({ type: "_GET:SYNCED", data: {} });
    });
    const last = (await server.nextMessage) as any;
    expect(last.type).toBe("_SET:SYNCED");
    expect(last.data).toEqual({ count: 1, label: "x" });

    cleanup?.();
  });

  test("delegate() sends original action via _ACTION (covers delegate effect)", async () => {
    function DelegateView() {
      const reducer = (
        draft: { v: number },
        action: any,
        _sync: () => void,
        delegate: (a?: any) => void
      ) => {
        if (action.type === "DELEG") {
          delegate();
        }
      };
      const [, dispatch] = useSyncedReducer("DLG", reducer as any, { v: 0 });
      return (
        <button onClick={() => dispatch({ type: "DELEG", n: 2 })}>go</button>
      );
    }

    const session = new Session({ url: "ws://localhost" });
    const server = new WS("ws://localhost", { jsonProtocol: true });
    render(
      <DefaultSessionContext.Provider value={session}>
        <DelegateView />
      </DefaultSessionContext.Provider>
    );
    const cleanup = session.connect();
    await server.connected;

    act(() => {
      screen.getByText("go").click();
    });
    const last = (await server.nextMessage) as any;
    expect(last).toEqual({
      type: "_ACTION:DLG",
      data: { type: "DELEG", n: 2 },
    });

    cleanup?.();
  });

  test("sendState method on stateWithSync sends _SET (covers sendState mapping)", async () => {
    function SendStateView() {
      const state = useSynced("SS", { a: 0 });
      return (
        <button onClick={() => state.sendState({ a: 9 } as any)}>send</button>
      );
    }

    const session = new Session({ url: "ws://localhost" });
    const server = new WS("ws://localhost", { jsonProtocol: true });
    render(
      <DefaultSessionContext.Provider value={session}>
        <SendStateView />
      </DefaultSessionContext.Provider>
    );
    const cleanup = session.connect();
    await server.connected;

    act(() => {
      screen.getByText("send").click();
    });
    const last = (await server.nextMessage) as any;
    expect(last).toEqual({ type: "_SET:SS", data: { a: 9 } });

    cleanup?.();
  });

  test("useObserved e2e: readonly updates and fetchRemoteState emits _GET", async () => {
    function ReadonlyView() {
      const obs = useObserved("RO", { a: 1, b: 2 } as any);
      return (
        <div>
          <div data-testid="ro-a">{(obs as any).a}</div>
          <div data-testid="ro-b">{(obs as any).b}</div>
          <button onClick={() => obs.fetchRemoteState()}>fetch</button>
        </div>
      );
    }

    const session = new Session({ url: "ws://localhost" });
    const server = new WS("ws://localhost", { jsonProtocol: true });
    render(
      <DefaultSessionContext.Provider value={session}>
        <ReadonlyView />
      </DefaultSessionContext.Provider>
    );
    const cleanup = session.connect();
    await server.connected;

    // Remote patch updates readonly view
    act(() => {
      server.send({
        type: "_PATCH:RO",
        data: [{ op: "replace", path: "/a", value: 5 }],
      });
    });
    expect(screen.getByTestId("ro-a").textContent).toBe("5");

    // fetch emits _GET
    act(() => {
      screen.getByText("fetch").click();
    });
    const last = (await server.nextMessage) as any;
    expect(last).toEqual({ type: "_GET:RO", data: {} });

    cleanup?.();
  });

  test("_PATCH produces new state identity and triggers [state] effect", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const session = new Session({ url: "ws://localhost" });

    type S = { count: number; nested: { v: number } };

    const identityChecks: boolean[] = [];
    const effectCalls: number[] = [];

    function IdentityView() {
      const [state] = useSyncedReducer<S>(
        "IDT",
        undefined as any,
        {
          count: 0,
          nested: { v: 1 },
        } as any
      );

      const prevRef = React.useRef(state);
      React.useEffect(() => {
        identityChecks.push(prevRef.current === state);
        effectCalls.push(1);
        prevRef.current = state;
      }, [state]);

      return (
        <div>
          <div data-testid="count">{(state as any).count}</div>
          <div data-testid="nested">{(state as any).nested.v}</div>
        </div>
      );
    }

    render(
      <DefaultSessionContext.Provider value={session}>
        <IdentityView />
      </DefaultSessionContext.Provider>
    );

    const cleanup = session.connect();
    await server.connected;

    // Remote _SET
    act(() => {
      server.send({ type: "_SET:IDT", data: { count: 10, nested: { v: 2 } } });
    });
    expect(screen.getByTestId("count").textContent).toBe("10");
    expect(screen.getByTestId("nested").textContent).toBe("2");

    // Remote _PATCH on two paths
    act(() => {
      server.send({
        type: "_PATCH:IDT",
        data: [
          { op: "replace", path: "/count", value: 3 },
          { op: "replace", path: "/nested/v", value: 9 },
        ],
      });
    });
    expect(screen.getByTestId("count").textContent).toBe("3");
    expect(screen.getByTestId("nested").textContent).toBe("9");

    // Effects must have run on both _SET and _PATCH, and identityChecks for those should be false
    // First render effect may record true (prev === state on mount); ignore it.
    const checksAfterMount = identityChecks.slice(1); // exclude mount
    expect(checksAfterMount.length).toBeGreaterThanOrEqual(2);
    // For _SET and _PATCH, identity must change
    expect(checksAfterMount.every((x) => x === false)).toBe(true);
    // Effect should have run at least twice after mount
    expect(effectCalls.length).toBeGreaterThanOrEqual(2);

    cleanup?.();
  });

  test("previous snapshot is not mutated by _PATCH (immutability)", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const session = new Session({ url: "ws://localhost" });

    type S = { obj: { a: number; b: number } };

    const prevSnapshots: string[] = [];
    let effectCount = 0;

    function SnapView() {
      const [state] = useSyncedReducer<S>(
        "IMM",
        undefined as any,
        {
          obj: { a: 1, b: 2 },
        } as any
      );

      const prevRef = React.useRef(state);
      React.useEffect(() => {
        // Capture the previous snapshot at the moment of each update
        prevSnapshots.push(JSON.stringify(prevRef.current));
        effectCount += 1;
        prevRef.current = state;
      }, [state]);

      return <div data-testid="a">{(state as any).obj.a}</div>;
    }

    render(
      <DefaultSessionContext.Provider value={session}>
        <SnapView />
      </DefaultSessionContext.Provider>
    );

    const cleanup = session.connect();
    await server.connected;

    // _SET establishes baseline and triggers effect (#2) to capture prev snapshot
    act(() => {
      server.send({ type: "_SET:IMM", data: { obj: { a: 5, b: 6 } } });
    });
    expect(screen.getByTestId("a").textContent).toBe("5");

    // _PATCH should not mutate the captured previous snapshot
    act(() => {
      server.send({
        type: "_PATCH:IMM",
        data: [{ op: "replace", path: "/obj/a", value: 7 }],
      });
    });
    expect(screen.getByTestId("a").textContent).toBe("7");
    // After _PATCH, the effect (#3) runs; the previous snapshot recorded for that effect
    // should be the state from _SET, not mutated by the patch
    expect(effectCount).toBeGreaterThanOrEqual(2);
    const lastPrev = prevSnapshots[prevSnapshots.length - 1];
    expect(lastPrev).toBe(JSON.stringify({ obj: { a: 5, b: 6 } }));

    cleanup?.();
  });
});
