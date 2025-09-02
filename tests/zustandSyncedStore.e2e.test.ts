import { act } from "@testing-library/react";
import { create } from "zustand";
import { Session } from "../src/session";
import { synced } from "../src/zustand/synced-store";
import {
  MockWebSocket,
  createToastMock,
  installMockWebSocket,
  resetMockWebSocket,
  restoreMockWebSocket,
} from "./utils/mocks";

jest.useFakeTimers();

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

describe("zustand synced-store e2e with real Session + mocked ws", () => {
  test("remote _SET and _PATCH update state in store", () => {
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

    const cleanup = session.connect();
    const ws = MockWebSocket.instances[0];
    act(() => ws.open());

    act(() => {
      ws.receive(JSON.stringify({ type: "_SET:ZEE", data: { count: 10 } }));
    });
    expect(store.getState().count).toBe(10);

    act(() => {
      ws.receive(
        JSON.stringify({
          type: "_PATCH:ZEE",
          data: [{ op: "replace", path: "/count", value: 3 }],
        })
      );
    });
    expect(store.getState().count).toBe(3);

    cleanup?.();
  });

  test("local set + sync emits _PATCH and updates state", () => {
    const session = new Session("ws://localhost");
    type S = { count: number; inc: (by: number) => void };
    const store = create<S>()(
      synced(
        (set, get, st) => ({
          count: 0,
          inc: (by: number) => {
            set((s) => ({ count: s.count + by } as any));
            st.sync();
          },
        }),
        { key: "ZEE2", session }
      )
    );

    const cleanup = session.connect();
    const ws = MockWebSocket.instances[0];
    act(() => ws.open());

    act(() => {
      store.getState().inc(2);
    });

    const sent = ws.sent
      .filter((s) => typeof s === "string")
      .map((s) => JSON.parse(s as string));
    const last = sent[sent.length - 1];
    expect(last.type).toBe("_PATCH:ZEE2");
    expect(last.data[0]).toEqual({ op: "replace", path: "/count", value: 2 });
    expect(store.getState().count).toBe(2);

    cleanup?.();
  });

  test("remote _ACTION routes to named handler on store", () => {
    const session = new Session("ws://localhost");
    type S = { count: number; INC: (p: { by: number }) => void };
    const store = create<S>()(
      synced(
        (set) => ({
          count: 0,
          INC: ({ by }) => set((s) => ({ count: s.count + (by ?? 1) } as any)),
        }),
        { key: "ACT", session }
      )
    );

    const cleanup = session.connect();
    const ws = MockWebSocket.instances[0];
    act(() => ws.open());

    act(() => {
      ws.receive(
        JSON.stringify({ type: "_ACTION:ACT", data: { type: "INC", by: 5 } })
      );
    });
    expect(store.getState().count).toBe(5);

    cleanup?.();
  });

  test("delegate helper sends original action via _ACTION", () => {
    const session = new Session("ws://localhost");
    type S = { noop: () => void };
    const store = create<S>()(
      synced(
        (_set, _get, st) => ({
          noop: () => {
            (st.sync as any).delegate.PING({ n: 7 });
          },
        }),
        { key: "DLGZ", session }
      )
    );

    const cleanup = session.connect();
    const ws = MockWebSocket.instances[0];
    act(() => ws.open());

    act(() => {
      store.getState().noop();
    });

    const frames = ws.sent
      .filter((s) => typeof s === "string")
      .map((s) => JSON.parse(s as string));
    const last = frames[frames.length - 1];
    expect(last).toEqual({
      type: "_ACTION:DLGZ",
      data: { type: "PING", n: 7 },
    });

    cleanup?.();
  });

  test("fetchRemoteState emits _GET and sendState sends _SET", () => {
    const session = new Session("ws://localhost");
    type S = { a: number };
    const store = create<S>()(synced(() => ({ a: 1 }), { key: "FS", session }));

    const cleanup = session.connect();
    const ws = MockWebSocket.instances[0];
    act(() => ws.open());

    act(() => {
      (store as any).sync.fetchRemoteState();
    });
    let frames = ws.sent
      .filter((s) => typeof s === "string")
      .map((s) => JSON.parse(s as string));
    expect(frames.pop()).toEqual({ type: "_GET:FS", data: {} });

    act(() => {
      (store as any).sync.sendState({ a: 9 });
    });
    frames = ws.sent
      .filter((s) => typeof s === "string")
      .map((s) => JSON.parse(s as string));
    expect(frames.pop()).toEqual({ type: "_SET:FS", data: { a: 9 } });

    cleanup?.();
  });
});
