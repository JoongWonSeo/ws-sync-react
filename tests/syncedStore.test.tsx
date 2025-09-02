import { act } from "@testing-library/react";
import { create } from "zustand";
import { synced } from "../src/zustand/synced-store";
import { MockSession } from "./utils/mocks";

describe("synced-store middleware", () => {
  test("flushes patches from immer producer via sync()", () => {
    const session = new MockSession();
    type S = { a: number; inc: () => void };
    const useStore = create<S>()(
      synced(
        (set, get, store) => ({
          a: 1,
          inc: () => {
            set((s) => ({ a: s.a + 2 }));
            store.sync();
          },
        }),
        { key: "Z", session: session as any }
      )
    );

    act(() => {
      useStore.getState().inc();
    });

    expect(session.sent).toHaveLength(1);
    expect(session.sent[0].event).toBe("_PATCH:Z");
    const patch = session.sent[0].data[0];
    expect(patch.op).toBe("replace");
    expect(patch.path).toBe("/a");
    expect(patch.value).toBe(3);
  });

  test("converts shallow set to patch and syncs", () => {
    const session = new MockSession();
    type S = { a: number; setA: (v: number) => void };
    const useStore = create<S>()(
      synced(
        (set, get, store) => ({
          a: 0,
          setA: (v: number) => {
            set({ a: v } as any);
            store.sync();
          },
        }),
        { key: "Z2", session: session as any }
      )
    );

    act(() => {
      useStore.getState().setA(10);
    });
    expect(session.sent).toHaveLength(1);
    expect(session.sent[0]).toEqual({
      event: "_PATCH:Z2",
      data: [{ op: "replace", path: "/a", value: 10 }],
    });
  });

  test("exposes sendAction and sendBinary on store.sync", () => {
    const session = new MockSession();
    type S = {
      a: number;
      ping: () => void;
      upload: (buf: ArrayBuffer) => void;
    };
    const useStore = create<S>()(
      synced(
        (set, get, store) => ({
          a: 0,
          ping: () => store.sync.sendAction({ type: "PING", n: 7 }),
          upload: (buf: ArrayBuffer) =>
            store.sync.sendBinary({ type: "UPLOAD", name: "f" }, buf),
        }),
        { key: "Z3", session: session as any }
      )
    );

    act(() => {
      useStore.getState().ping();
    });
    expect(session.sent.pop()).toEqual({
      event: "_ACTION:Z3",
      data: { type: "PING", n: 7 },
    });

    const buf = new Uint8Array([1, 2]).buffer;
    act(() => {
      useStore.getState().upload(buf);
    });
    expect(session.sentBinary[0]).toEqual({
      event: "_ACTION:Z3",
      meta: { type: "UPLOAD", name: "f" },
      data: buf,
    });
  });
});
