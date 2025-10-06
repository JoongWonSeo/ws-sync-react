import { act } from "@testing-library/react";
import { create } from "zustand";
import { synced } from "../src/zustand/synced-store";
import { MockSession } from "./utils/mocks";

describe("syncAttributes option", () => {
  test("defaults to syncing every field", () => {
    const session = new MockSession();
    type S = {
      remote: number;
      localOnly: string;
      setLocalOnly: (v: string) => void;
    };
    const useStore = create<S>()(
      synced(
        (set, _get, store) => ({
          remote: 0,
          localOnly: "init",
          setLocalOnly: (v: string) => {
            set({ localOnly: v });
            store.sync();
          },
        }),
        { key: "SYNC_DEFAULT", session: session as any }
      )
    );

    act(() => {
      useStore.getState().setLocalOnly("secret");
    });

    expect(session.sent).toHaveLength(1);
    expect(session.sent[0]).toEqual({
      event: "_PATCH:SYNC_DEFAULT",
      data: [{ op: "replace", path: "/localOnly", value: "secret" }],
    });
  });

  test("omits shallow local-only updates when syncAttributes is array", () => {
    const session = new MockSession();
    type S = {
      remote: number;
      localOnly: string;
      setLocalOnly: (v: string) => void;
      setRemote: (v: number) => void;
    };
    const useStore = create<S>()(
      synced(
        (set, _get, store) => ({
          remote: 0,
          localOnly: "init",
          setLocalOnly: (v: string) => {
            set({ localOnly: v });
            store.sync();
          },
          setRemote: (v: number) => {
            set({ remote: v });
            store.sync();
          },
        }),
        {
          key: "SYNC_ARRAY",
          session: session as any,
          syncAttributes: ["remote"],
        }
      )
    );

    act(() => {
      useStore.getState().setLocalOnly("secret");
    });

    expect(session.sent).toHaveLength(0);

    act(() => {
      useStore.getState().setRemote(42);
    });

    expect(session.sent).toHaveLength(1);
    expect(session.sent[0]).toEqual({
      event: "_PATCH:SYNC_ARRAY",
      data: [{ op: "replace", path: "/remote", value: 42 }],
    });
  });

  test("omits immer local-only updates when syncAttributes is array", () => {
    const session = new MockSession();
    type S = {
      remote: number;
      localOnly: { flag: boolean };
      toggleLocal: () => void;
      toggleRemote: () => void;
    };
    const useStore = create<S>()(
      synced(
        (set, _get, store) => ({
          remote: 0,
          localOnly: { flag: false },
          toggleLocal: () => {
            set((state) => {
              state.localOnly.flag = !state.localOnly.flag;
            });
            store.sync();
          },
          toggleRemote: () => {
            set((state) => {
              state.remote += 1;
            });
            store.sync();
          },
        }),
        {
          key: "SYNC_ARRAY_IMMER",
          session: session as any,
          syncAttributes: ["remote"],
        }
      )
    );

    act(() => {
      useStore.getState().toggleLocal();
    });

    expect(session.sent).toHaveLength(0);

    act(() => {
      useStore.getState().toggleRemote();
    });

    expect(session.sent).toHaveLength(1);
    expect(session.sent[0]).toEqual({
      event: "_PATCH:SYNC_ARRAY_IMMER",
      data: [{ op: "replace", path: "/remote", value: 1 }],
    });
  });

  test("syncAttributes object variant filters by keys", () => {
    const session = new MockSession();
    type S = {
      remote: number;
      extra: number;
      localOnly: string;
      setAll: (remote: number, extra: number, localOnly: string) => void;
    };
    const useStore = create<S>()(
      synced(
        (set, _get, store) => ({
          remote: 0,
          extra: 0,
          localOnly: "init",
          setAll: (remote: number, extra: number, localOnly: string) => {
            set({ remote, extra, localOnly });
            store.sync();
          },
        }),
        {
          key: "SYNC_OBJECT",
          session: session as any,
          syncAttributes: { remote: true, extra: false },
        }
      )
    );

    act(() => {
      useStore.getState().setAll(5, 10, "secret");
    });

    expect(session.sent).toHaveLength(1);
    expect(session.sent[0]).toEqual({
      event: "_PATCH:SYNC_OBJECT",
      data: [
        { op: "replace", path: "/remote", value: 5 },
        { op: "replace", path: "/extra", value: 10 },
      ],
    });
    expect(useStore.getState().localOnly).toBe("secret");
  });

  test("_GET handler returns only synced attributes", () => {
    const session = new MockSession();
    type S = {
      remote: number;
      localOnly: string;
      setBoth: (remote: number, localOnly: string) => void;
    };
    const useStore = create<S>()(
      synced(
        (set) => ({
          remote: 1,
          localOnly: "init",
          setBoth: (remote: number, localOnly: string) => {
            set({ remote, localOnly });
          },
        }),
        {
          key: "SYNC_GET",
          session: session as any,
          syncAttributes: ["remote"],
        }
      )
    );

    act(() => {
      useStore.getState().setBoth(3, "secret");
    });

    expect(session.sent).toHaveLength(0);

    const getHandler = session.events["_GET:SYNC_GET"];
    expect(getHandler).toBeDefined();
    act(() => {
      getHandler?.({});
    });

    expect(session.sent).toHaveLength(1);
    expect(session.sent[0]).toEqual({
      event: "_SET:SYNC_GET",
      data: { remote: 3 },
    });
  });

  test("remote patches keep Set state when excluded via syncAttributes", () => {
    const session = new MockSession();
    type S = {
      remote: number;
      localSet: Set<string>;
    };
    const useStore = create<S>()(
      synced(
        () => ({
          remote: 0,
          localSet: new Set(["alpha"]),
        }),
        {
          key: "SYNC_SET_LOCAL",
          session: session as any,
          syncAttributes: ["remote"],
        }
      )
    );

    const handler = session.events["_PATCH:SYNC_SET_LOCAL"];
    expect(handler).toBeDefined();

    act(() => {
      handler?.([{ op: "replace", path: "/remote", value: 1 }]);
    });

    const localSet = useStore.getState().localSet;
    expect(localSet).toBeInstanceOf(Set);
    if (localSet instanceof Set) {
      expect(Array.from(localSet)).toEqual(["alpha"]);
    }
  });

  test("remote patches keep Map state when excluded via syncAttributes", () => {
    const session = new MockSession();
    type S = {
      remote: number;
      localMap: Map<string, number>;
    };
    const useStore = create<S>()(
      synced(
        () => ({
          remote: 0,
          localMap: new Map([["k", 1]]),
        }),
        {
          key: "SYNC_MAP_LOCAL",
          session: session as any,
          syncAttributes: ["remote"],
        }
      )
    );

    const handler = session.events["_PATCH:SYNC_MAP_LOCAL"];
    expect(handler).toBeDefined();

    act(() => {
      handler?.([{ op: "replace", path: "/remote", value: 2 }]);
    });

    const localMap = useStore.getState().localMap;
    expect(localMap).toBeInstanceOf(Map);
    if (localMap instanceof Map) {
      expect(Array.from(localMap.entries())).toEqual([["k", 1]]);
    }
  });
});
