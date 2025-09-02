import { act, render, screen } from "@testing-library/react";
import WS from "jest-websocket-mock";
import React from "react";
import { create } from "zustand";
import { Session } from "../src/session";
import { synced } from "../src/zustand/synced-store";
import { createToastMock } from "./utils/mocks";

afterEach(() => {
  jest.clearAllMocks();
  WS.clean();
});

describe("synced-store e2e with real Session + mocked ws", () => {
  test("remote _SET and _PATCH update state in store", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const toast = createToastMock();
    const session = new Session("ws://localhost", "Srv", toast);

    type S = { count: number };
    const store = create<S>()(
      synced(
        () => ({
          count: 0,
        }),
        { key: "ZEE", session }
      )
    );

    function View() {
      const count = store((s: S) => s.count);
      const rendersRef = React.useRef(0);
      rendersRef.current += 1;
      return (
        <div>
          <span data-testid="count">{count}</span>
          <span data-testid="renders">{rendersRef.current}</span>
        </div>
      );
    }

    const cleanup = session.connect();
    await server.connected;

    render(<View />);
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(screen.getByTestId("renders").textContent).toBe("1");

    act(() => {
      server.send({ type: "_SET:ZEE", data: { count: 10 } });
    });
    expect(store.getState().count).toBe(10);
    expect(screen.getByTestId("count").textContent).toBe("10");
    expect(screen.getByTestId("renders").textContent).toBe("2");

    act(() => {
      server.send({
        type: "_PATCH:ZEE",
        data: [{ op: "replace", path: "/count", value: 3 }],
      });
    });
    expect(store.getState().count).toBe(3);
    expect(screen.getByTestId("count").textContent).toBe("3");
    expect(screen.getByTestId("renders").textContent).toBe("3");

    cleanup?.();
  });

  test("local set + sync emits _PATCH and updates state", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const session = new Session("ws://localhost");
    type S = { count: number; inc: (by: number) => void };
    const store = create<S>()(
      synced(
        (set, get, st) => ({
          count: 0,
          inc: (by: number) => {
            set((s) => ({ count: s.count + by }));
            st.sync();
          },
        }),
        { key: "ZEE2", session }
      )
    );

    function View() {
      const count = store((s: S) => s.count);
      const rendersRef = React.useRef(0);
      rendersRef.current += 1;
      return (
        <div>
          <span data-testid="count">{count}</span>
          <span data-testid="renders">{rendersRef.current}</span>
        </div>
      );
    }

    const cleanup = session.connect();
    await server.connected;

    render(<View />);
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(screen.getByTestId("renders").textContent).toBe("1");

    act(() => {
      store.getState().inc(2);
    });

    const last = (await server.nextMessage) as any;
    expect(last.type).toBe("_PATCH:ZEE2");
    expect(last.data[0]).toEqual({ op: "replace", path: "/count", value: 2 });
    expect(store.getState().count).toBe(2);
    expect(screen.getByTestId("count").textContent).toBe("2");
    // state changed once -> exactly 2 renders (mount + update)
    expect(screen.getByTestId("renders").textContent).toBe("2");

    cleanup?.();
  });

  test("remote _ACTION routes to named handler on store", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const session = new Session("ws://localhost");
    type S = { count: number; INC: (p: { by: number }) => void };
    const store = create<S>()(
      synced(
        (set) => ({
          count: 0,
          INC: ({ by }) => set((s) => ({ count: s.count + (by ?? 1) })),
        }),
        { key: "ACT", session }
      )
    );

    const cleanup = session.connect();
    await server.connected;

    act(() => {
      server.send({ type: "_ACTION:ACT", data: { type: "INC", by: 5 } });
    });
    expect(store.getState().count).toBe(5);

    cleanup?.();
  });

  test("delegate helper sends original action via _ACTION", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const session = new Session("ws://localhost");
    type S = { noop: () => void };
    const store = create<S>()(
      synced(
        (_set, _get, st) => ({
          noop: () => {
            st.sync.delegate.PING({ n: 7 });
          },
        }),
        { key: "DLGZ", session }
      )
    );

    const cleanup = session.connect();
    await server.connected;

    act(() => {
      store.getState().noop();
    });

    const last = (await server.nextMessage) as any;
    expect(last).toEqual({
      type: "_ACTION:DLGZ",
      data: { type: "PING", n: 7 },
    });

    cleanup?.();
  });

  test("fetchRemoteState emits _GET and sendState sends _SET", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const session = new Session("ws://localhost");
    type S = { a: number };
    const store = create<S>()(synced(() => ({ a: 1 }), { key: "FS", session }));

    const cleanup = session.connect();
    await server.connected;

    act(() => {
      store.sync.fetchRemoteState();
    });
    const first = (await server.nextMessage) as any;
    expect(first).toEqual({ type: "_GET:FS", data: {} });

    act(() => {
      store.sync.sendState({ a: 9 });
    });
    const second = (await server.nextMessage) as any;
    expect(second).toEqual({ type: "_SET:FS", data: { a: 9 } });

    cleanup?.();
  });

  test("local set without sync emits no network but updates state", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const session = new Session("ws://localhost");
    type S = { count: number; setOnly: (by: number) => void };
    const store = create<S>()(
      synced(
        (set, _get, _st) => ({
          count: 0,
          setOnly: (by: number) => set((s) => ({ count: s.count + by })),
        }),
        { key: "NOSYNC", session }
      )
    );

    const cleanup = session.connect();
    await server.connected;

    act(() => {
      store.getState().setOnly(3);
    });
    expect(store.getState().count).toBe(3);
    await new Promise((r) => setTimeout(r, 50));
    expect(server).toHaveReceivedMessages([]);

    cleanup?.();
  });

  test("multiple local sets before sync flush combine into one _PATCH frame", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const session = new Session("ws://localhost");
    type S = { count: number; bump: () => void; flush: () => void };
    const store = create<S>()(
      synced(
        (set, _get, st) => ({
          count: 0,
          bump: () => set((s) => ({ count: s.count + 1 })),
          flush: () => st.sync(),
        }),
        { key: "MULTI", session }
      )
    );

    const cleanup = session.connect();
    await server.connected;

    act(() => {
      store.getState().bump();
      store.getState().bump();
      store.getState().flush();
    });

    const last = (await server.nextMessage) as any;
    expect(last.type).toBe("_PATCH:MULTI");
    expect(Array.isArray(last.data)).toBe(true);
    expect(last.data.length).toBe(2);
    expect(last.data[0]).toEqual({ op: "replace", path: "/count", value: 1 });
    expect(last.data[1]).toEqual({ op: "replace", path: "/count", value: 2 });
    expect(store.getState().count).toBe(2);

    cleanup?.();
  });

  test("remote _GET triggers _SET with current local snapshot", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const session = new Session("ws://localhost");
    type S = { a: number; setA: (v: number) => void };
    const store = create<S>()(
      synced(
        (set) => ({
          a: 1,
          setA: (v: number) => set({ a: v }),
        }),
        { key: "SNAP", session }
      )
    );

    const cleanup = session.connect();
    await server.connected;

    act(() => {
      store.getState().setA(4); // local-only update (no sync call)
    });

    act(() => {
      server.send({ type: "_GET:SNAP", data: {} });
    });
    const msg = (await server.nextMessage) as any;
    expect(msg).toEqual({ type: "_SET:SNAP", data: { a: 4 } });

    cleanup?.();
  });

  test("remote _ACTION without handler is ignored and does not throw", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const session = new Session("ws://localhost");
    type S = { a: number };
    const store = create<S>()(
      synced(() => ({ a: 1 }), { key: "NOHDL", session })
    );

    const cleanup = session.connect();
    await server.connected;

    act(() => {
      server.send({ type: "_ACTION:NOHDL", data: { type: "NOOP", x: 1 } });
    });
    expect(store.getState().a).toBe(1);

    cleanup?.();
  });

  test("sync() with no pending patches emits nothing", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const session = new Session("ws://localhost");
    type S = { a: number };
    const store = create<S>()(
      synced(() => ({ a: 0 }), { key: "NOP", session })
    );

    const cleanup = session.connect();
    await server.connected;

    act(() => {
      store.sync();
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(server).toHaveReceivedMessages([]);

    cleanup?.();
  });

  test("startTask and cancelTask send task events", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const session = new Session("ws://localhost");
    type S = { a: number };
    const store = create<S>()(
      synced(() => ({ a: 0 }), { key: "TASK", session })
    );

    const cleanup = session.connect();
    await server.connected;

    act(() => {
      store.sync.startTask({ type: "RUN", id: 7 });
    });
    const first = (await server.nextMessage) as any;
    expect(first).toEqual({
      type: "_TASK_START:TASK",
      data: { type: "RUN", id: 7 },
    });

    act(() => {
      store.sync.cancelTask({ type: "RUN" });
    });
    const second = (await server.nextMessage) as any;
    expect(second).toEqual({
      type: "_TASK_CANCEL:TASK",
      data: { type: "RUN" },
    });

    cleanup?.();
  });

  test("shallow set object then sync emits correct replace patch", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const session = new Session("ws://localhost");
    type S = {
      count: number;
      setCount: (v: number) => void;
      flush: () => void;
    };
    const store = create<S>()(
      synced(
        (set, _get, st) => ({
          count: 0,
          setCount: (v: number) => set({ count: v }),
          flush: () => st.sync(),
        }),
        { key: "SHAL", session }
      )
    );

    const cleanup = session.connect();
    await server.connected;

    act(() => {
      store.getState().setCount(5);
      store.getState().flush();
    });

    const last = (await server.nextMessage) as any;
    expect(last.type).toBe("_PATCH:SHAL");
    expect(last.data).toEqual([{ op: "replace", path: "/count", value: 5 }]);
    expect(store.getState().count).toBe(5);

    cleanup?.();
  });

  test("action handler error is swallowed and logs error", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const session = new Session("ws://localhost");
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    type S = { ERR: () => void };
    const store = create<S>()(
      synced(
        () => ({
          ERR: (_p?: any): void => {
            throw new Error("boom");
          },
        }),
        { key: "ERRZ", session }
      )
    );

    const cleanup = session.connect();
    await server.connected;

    act(() => {
      server.send({ type: "_ACTION:ERRZ", data: { type: "ERR" } });
    });
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
    cleanup?.();
  });

  test("nested objects/arrays/records: immer-style set, selector rerenders only on value change", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const session = new Session("ws://localhost");
    type User = { id: string; name: string; tags: string[] };
    type S = {
      value: { nested: { arr: { x: number }[]; rec: Record<string, User> } };
      setX: (i: number, v: number) => void;
      addUser: (u: User) => void;
      renameUser: (id: string, name: string) => void;
      syncNow: () => void;
      doSyncOnly: () => void;
      doDelegateOnly: () => void;
    };
    const store = create<S>()(
      synced(
        (set, get, st) => ({
          value: { nested: { arr: [{ x: 1 }], rec: {} } },
          setX: (i, v) => {
            set((draft) => {
              draft.value.nested.arr[i].x = v;
            });
          },
          addUser: (u) => {
            set((draft) => {
              draft.value.nested.rec[u.id] = u;
            });
          },
          renameUser: (id, name) => {
            set((draft) => {
              draft.value.nested.rec[id].name = name;
            });
          },
          syncNow: () => st.sync(),
          doSyncOnly: () => st.sync(),
          doDelegateOnly: () => st.sync.delegate.PING({ n: 1 }),
        }),
        { key: "NEST", session }
      )
    );

    const cleanup = session.connect();
    await server.connected;

    // Render multiple components with narrow selectors to assert only
    // components depending on changed slices rerender.
    function XView() {
      const x = store((s: S) => s.value.nested.arr[0].x);
      const rendersRef = React.useRef(0);
      rendersRef.current += 1;
      return (
        <div>
          <span data-testid="x-val">{x}</span>
          <span data-testid="x-renders">{rendersRef.current}</span>
        </div>
      );
    }
    function NameView() {
      const name = store((s: S) => s.value.nested.rec["u1"]?.name ?? null);
      const rendersRef = React.useRef(0);
      rendersRef.current += 1;
      return (
        <div>
          <span data-testid="name-val">{name === null ? "null" : name}</span>
          <span data-testid="name-renders">{rendersRef.current}</span>
        </div>
      );
    }
    render(
      <>
        <XView />
        <NameView />
      </>
    );
    expect(screen.getByTestId("x-val").textContent).toBe("1");
    expect(screen.getByTestId("x-renders").textContent).toBe("1");
    expect(screen.getByTestId("name-val").textContent).toBe("null");
    expect(screen.getByTestId("name-renders").textContent).toBe("1");

    const onXChange = jest.fn();
    const onNameChange = jest.fn();
    const unsubX = store.subscribe((s: S, p: S) => {
      const next = s.value.nested.arr[0].x;
      const prev = p.value.nested.arr[0].x;
      if (next !== prev) onXChange(next);
    });
    const unsubName = store.subscribe((s: S, p: S) => {
      const next = s.value.nested.rec["u1"]?.name ?? null;
      const prev = p.value.nested.rec["u1"]?.name ?? null;
      if (next !== prev) onNameChange(next);
    });

    // mutate without sync -> no network
    act(() => {
      store.getState().setX(0, 2);
    });
    expect(onXChange).toHaveBeenCalledTimes(1);
    expect(onNameChange).toHaveBeenCalledTimes(0);
    // Only XView rerenders
    expect(screen.getByTestId("x-val").textContent).toBe("2");
    expect(screen.getByTestId("x-renders").textContent).toBe("2");
    expect(screen.getByTestId("name-val").textContent).toBe("null");
    expect(screen.getByTestId("name-renders").textContent).toBe("1");
    await new Promise((r) => setTimeout(r, 20));
    expect(server).toHaveReceivedMessages([]);

    // flush -> sends patches for changed path(s)
    act(() => {
      store.getState().syncNow();
    });
    const patch1 = (await server.nextMessage) as any;
    expect(patch1.type).toBe("_PATCH:NEST");
    expect(Array.isArray(patch1.data)).toBe(true);
    // One or more patches, last should set x=2
    const lastP = patch1.data[patch1.data.length - 1];
    expect(
      lastP.path.endsWith("/value/nested/arr/0/x") ||
        lastP.path.endsWith("nested/arr/0/x")
    ).toBe(true);
    expect(lastP.value).toBe(2);
    // Flushing should not cause extra UI rerenders since state didn't change
    expect(screen.getByTestId("x-renders").textContent).toBe("2");
    expect(screen.getByTestId("name-renders").textContent).toBe("1");

    // add user and then rename via immer mutation
    act(() => {
      store.getState().addUser({ id: "u1", name: "Alice", tags: ["a"] });
    });
    expect(onNameChange).toHaveBeenCalledTimes(1); // now becomes "Alice"
    // Only NameView rerenders on user add
    expect(screen.getByTestId("x-renders").textContent).toBe("2");
    expect(screen.getByTestId("name-val").textContent).toBe("Alice");
    expect(screen.getByTestId("name-renders").textContent).toBe("2");
    act(() => {
      store.getState().renameUser("u1", "Ally");
    });
    expect(onNameChange).toHaveBeenCalledTimes(2); // name changed
    // Only NameView rerenders on rename
    expect(screen.getByTestId("x-renders").textContent).toBe("2");
    expect(screen.getByTestId("name-val").textContent).toBe("Ally");
    expect(screen.getByTestId("name-renders").textContent).toBe("3");

    // Do actions that only sync or delegate and do not set -> no selector calls triggered
    const nameCallsBefore = onNameChange.mock.calls.length;
    const xCallsBefore = onXChange.mock.calls.length;
    act(() => {
      store.getState().doSyncOnly();
      store.getState().doDelegateOnly();
    });
    expect(onNameChange.mock.calls.length).toBe(nameCallsBefore);
    expect(onXChange.mock.calls.length).toBe(xCallsBefore);
    // No re-renders for pure sync/delegate
    expect(screen.getByTestId("x-renders").textContent).toBe("2");
    expect(screen.getByTestId("name-renders").textContent).toBe("3");

    unsubX();
    unsubName();
    cleanup?.();
  });

  test("remote patch updates nested fields and triggers selector rerender", async () => {
    const server = new WS("ws://localhost", { jsonProtocol: true });
    const session = new Session("ws://localhost");
    type S = { value: { nested: { arr: { x: number }[] } } };
    const store = create<S>()(
      synced(
        () => ({
          value: { nested: { arr: [{ x: 1 }] } },
        }),
        { key: "NEST2", session }
      )
    );

    const cleanup = session.connect();
    await server.connected;

    function View() {
      const x = store((s: S) => s.value.nested.arr[0].x);
      const rendersRef = React.useRef(0);
      rendersRef.current += 1;
      return (
        <div>
          <span data-testid="x">{x}</span>
          <span data-testid="renders">{rendersRef.current}</span>
        </div>
      );
    }

    render(<View />);
    expect(screen.getByTestId("x").textContent).toBe("1");
    expect(screen.getByTestId("renders").textContent).toBe("1");

    const onXChange = jest.fn();
    const unsub = store.subscribe((s: S, p: S) => {
      const next = s.value.nested.arr[0].x;
      const prev = p.value.nested.arr[0].x;
      if (next !== prev) onXChange(next);
    });
    // baseline
    onXChange.mockClear();

    // remote patch to nested path
    act(() => {
      server.send({
        type: "_PATCH:NEST2",
        data: [{ op: "replace", path: "/value/nested/arr/0/x", value: 9 }],
      });
    });
    expect(store.getState().value.nested.arr[0].x).toBe(9);
    expect(onXChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("x").textContent).toBe("9");
    expect(screen.getByTestId("renders").textContent).toBe("2");

    unsub();
    cleanup?.();
  });
});
