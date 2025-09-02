import { act, render, screen } from "@testing-library/react";
import React from "react";
import {
  DefaultSessionContext,
  Session,
  useObserved,
  useSynced,
  useSyncedReducer,
} from "../src";
import {
  MockWebSocket,
  createToastMock,
  installMockWebSocket,
  resetMockWebSocket,
  restoreMockWebSocket,
} from "./utils/mocks";

// Use fake timers where reconnection/backoff could interfere
jest.useFakeTimers();

// Attach mock WebSocket globally for real Session usage
beforeAll(() => {
  installMockWebSocket();
});

afterAll(() => {
  restoreMockWebSocket();
});

afterEach(() => {
  jest.clearAllMocks();
  resetMockWebSocket();
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
  test("remote _SET and _PATCH update state and cause re-render", () => {
    const toast = createToastMock();
    const session = new Session("ws://localhost", "Srv", toast);

    render(
      <DefaultSessionContext.Provider value={session}>
        <CounterView label="E2E" />
      </DefaultSessionContext.Provider>
    );

    // establish websocket
    const cleanup = session.connect();
    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.open();
    });

    // Remote _SET should overwrite and render
    act(() => {
      ws.receive(JSON.stringify({ type: "_SET:E2E", data: { count: 10 } }));
    });
    expect(screen.getByTestId("count-E2E").textContent).toBe("10");

    // Remote _PATCH should apply json-patch and render
    act(() => {
      ws.receive(
        JSON.stringify({
          type: "_PATCH:E2E",
          data: [{ op: "replace", path: "/count", value: 3 }],
        })
      );
    });
    expect(screen.getByTestId("count-E2E").textContent).toBe("3");
    cleanup?.();
  });

  test("local dispatch triggers patch send; remote _ACTION routes through reducer", () => {
    const toast = createToastMock();
    const session = new Session("ws://localhost", "Srv", toast);

    render(
      <DefaultSessionContext.Provider value={session}>
        <CounterView label="E2E2" />
      </DefaultSessionContext.Provider>
    );

    const cleanup = session.connect();
    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.open();
    });

    // Click inc button -> reducer drafts count+=2, sync() flushes patches
    act(() => {
      screen.getByText("inc").click();
    });

    // Last frame should be a _PATCH:E2E2 with replace /count
    const sent = ws.sent
      .filter((s) => typeof s === "string")
      .map((s) => JSON.parse(s as string));
    const last = sent[sent.length - 1];
    expect(last.type).toBe("_PATCH:E2E2");
    expect(Array.isArray(last.data)).toBe(true);
    expect(last.data[0].op).toBe("replace");
    expect(last.data[0].path).toBe("/count");

    // Remote action should route through reducer and update state
    act(() => {
      ws.receive(
        JSON.stringify({ type: "_ACTION:E2E2", data: { type: "INC", by: 5 } })
      );
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
  test("setters update UI without emitting network; syncers emit _PATCH", () => {
    const toast = createToastMock();
    const session = new Session("ws://localhost", "Srv", toast);

    render(
      <DefaultSessionContext.Provider value={session}>
        <SyncedObjView />
      </DefaultSessionContext.Provider>
    );

    const cleanup = session.connect();
    const ws = MockWebSocket.instances[0];
    act(() => ws.open());

    // Setters only -> no network traffic but UI updates
    act(() => {
      screen.getByText("setCount").click();
      screen.getByText("setLabel").click();
    });
    expect(screen.getByTestId("count-synced").textContent).toBe("1");
    expect(screen.getByTestId("label-synced").textContent).toBe("x!");
    expect(ws.sent.length).toBe(0);

    // Syncers -> emit _PATCH frames
    act(() => {
      screen.getByText("syncCount").click();
    });
    const frames = ws.sent
      .filter((s) => typeof s === "string")
      .map((s) => JSON.parse(s as string));
    const last = frames[frames.length - 1];
    expect(last.type).toBe("_PATCH:SYNCED");
    expect(last.data[0]).toEqual({ op: "replace", path: "/count", value: 3 });
    expect(screen.getByTestId("count-synced").textContent).toBe("3");

    act(() => {
      screen.getByText("syncLabel").click();
    });
    const frames2 = ws.sent
      .filter((s) => typeof s === "string")
      .map((s) => JSON.parse(s as string));
    const last2 = frames2[frames2.length - 1];
    expect(last2.type).toBe("_PATCH:SYNCED");
    expect(last2.data[0]).toEqual({
      op: "replace",
      path: "/label",
      value: "x!?",
    });
    expect(screen.getByTestId("label-synced").textContent).toBe("x!?");

    cleanup?.();
  });

  test("mixing set and sync sends only synced field patch", () => {
    const toast = createToastMock();
    const session = new Session("ws://localhost", "Srv", toast);

    render(
      <DefaultSessionContext.Provider value={session}>
        <SyncedObjView />
      </DefaultSessionContext.Provider>
    );

    const cleanup = session.connect();
    const ws = MockWebSocket.instances[0];
    act(() => ws.open());

    // Mix: set label locally, then sync count -> only count patch emitted
    act(() => {
      screen.getByText("mixSetLabelSyncCount").click();
    });

    const sent = ws.sent
      .filter((s) => typeof s === "string")
      .map((s) => JSON.parse(s as string));
    const last = sent[sent.length - 1];
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

  test("without reducer, custom actions are ignored and emit no network", () => {
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

    const session = new Session("ws://localhost");
    render(
      <DefaultSessionContext.Provider value={session}>
        <NoReducerView />
      </DefaultSessionContext.Provider>
    );
    const cleanup = session.connect();
    const ws = MockWebSocket.instances[0];
    act(() => ws.open());

    act(() => {
      screen.getByText("noop").click();
    });
    expect(screen.getByTestId("a-nor").textContent).toBe("1");
    expect(ws.sent.length).toBe(0);

    cleanup?.();
  });

  test("_GET triggers sendState of current snapshot (covers getState path)", () => {
    const session = new Session("ws://localhost");
    render(
      <DefaultSessionContext.Provider value={session}>
        <SyncedObjView />
      </DefaultSessionContext.Provider>
    );
    const cleanup = session.connect();
    const ws = MockWebSocket.instances[0];
    act(() => ws.open());

    // Change local state first
    act(() => {
      screen.getByText("setCount").click(); // count: 1
    });

    act(() => {
      ws.receive(JSON.stringify({ type: "_GET:SYNCED", data: {} }));
    });
    const frames = ws.sent
      .filter((s) => typeof s === "string")
      .map((s) => JSON.parse(s as string));
    const last = frames[frames.length - 1];
    expect(last.type).toBe("_SET:SYNCED");
    expect(last.data).toEqual({ count: 1, label: "x" });

    cleanup?.();
  });

  test("delegate() sends original action via _ACTION (covers delegate effect)", () => {
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

    const session = new Session("ws://localhost");
    render(
      <DefaultSessionContext.Provider value={session}>
        <DelegateView />
      </DefaultSessionContext.Provider>
    );
    const cleanup = session.connect();
    const ws = MockWebSocket.instances[0];
    act(() => ws.open());

    act(() => {
      screen.getByText("go").click();
    });
    const frames = ws.sent
      .filter((s) => typeof s === "string")
      .map((s) => JSON.parse(s as string));
    const last = frames[frames.length - 1];
    expect(last).toEqual({
      type: "_ACTION:DLG",
      data: { type: "DELEG", n: 2 },
    });

    cleanup?.();
  });

  test("sendState method on stateWithSync sends _SET (covers sendState mapping)", () => {
    function SendStateView() {
      const state = useSynced("SS", { a: 0 });
      return (
        <button onClick={() => state.sendState({ a: 9 } as any)}>send</button>
      );
    }

    const session = new Session("ws://localhost");
    render(
      <DefaultSessionContext.Provider value={session}>
        <SendStateView />
      </DefaultSessionContext.Provider>
    );
    const cleanup = session.connect();
    const ws = MockWebSocket.instances[0];
    act(() => ws.open());

    act(() => {
      screen.getByText("send").click();
    });
    const frames = ws.sent
      .filter((s) => typeof s === "string")
      .map((s) => JSON.parse(s as string));
    const last = frames[frames.length - 1];
    expect(last).toEqual({ type: "_SET:SS", data: { a: 9 } });

    cleanup?.();
  });

  test("useObserved e2e: readonly updates and fetchRemoteState emits _GET", () => {
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

    const session = new Session("ws://localhost");
    render(
      <DefaultSessionContext.Provider value={session}>
        <ReadonlyView />
      </DefaultSessionContext.Provider>
    );
    const cleanup = session.connect();
    const ws = MockWebSocket.instances[0];
    act(() => ws.open());

    // Remote patch updates readonly view
    act(() => {
      ws.receive(
        JSON.stringify({
          type: "_PATCH:RO",
          data: [{ op: "replace", path: "/a", value: 5 }],
        })
      );
    });
    expect(screen.getByTestId("ro-a").textContent).toBe("5");

    // fetch emits _GET
    act(() => {
      screen.getByText("fetch").click();
    });
    const frames = ws.sent
      .filter((s) => typeof s === "string")
      .map((s) => JSON.parse(s as string));
    const last = frames[frames.length - 1];
    expect(last).toEqual({ type: "_GET:RO", data: {} });

    cleanup?.();
  });
});
