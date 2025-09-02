import {
  Sync,
  actionEvent,
  convertImmerPatchesToJsonPatch,
  convertShallowUpdateToImmerPatch,
  getEvent,
  patchEvent,
  setEvent,
} from "../src/sync";
import { MockSession } from "./utils/mocks";

describe("Sync core behavior", () => {
  test("does not send when no patches queued", () => {
    const session = new MockSession();
    const sync = new Sync("KEY", session as any);
    sync.sync();
    expect(session.sent).toHaveLength(0);
  });

  test("appendPatch + sync sends converted patches and clears queue", () => {
    const session = new MockSession();
    const sync = new Sync("COUNTER", session as any);

    const p1 = { op: "replace", path: ["count"], value: 2 } as any;
    const p2 = { op: "replace", path: ["flag"], value: true } as any;

    sync.appendPatch([p1]);
    sync.appendPatch([p2]);

    expect(session.sent).toHaveLength(0);

    sync.sync();

    expect(session.sent).toHaveLength(1);
    expect(session.sent[0]).toEqual({
      event: patchEvent("COUNTER"),
      data: [
        { op: "replace", path: "/count", value: 2 },
        { op: "replace", path: "/flag", value: true },
      ],
    });

    // second sync with no new patches should not send
    sync.sync();
    expect(session.sent).toHaveLength(1);
  });

  test("lastSyncTime is updated when syncing patches", () => {
    const session = new MockSession();
    const sync = new Sync("K", session as any);
    const before = sync.lastSyncTime;
    expect(before).toBe(0);

    sync.appendPatch([{ op: "replace", path: ["x"], value: 1 } as any]);
    sync.sync();
    const after = sync.lastSyncTime;
    expect(after).toBeGreaterThan(0);
  });

  test("fetchRemoteState sends _GET event with empty object", () => {
    const session = new MockSession();
    const sync = new Sync("DOC", session as any);
    sync.fetchRemoteState();
    expect(session.sent).toEqual([{ event: getEvent("DOC"), data: {} }]);
  });

  test("sendState sends _SET with provided state", () => {
    const session = new MockSession();
    const sync = new Sync("S", session as any);
    const state = { a: 1 };
    sync.sendState(state);
    expect(session.sent).toEqual([{ event: setEvent("S"), data: state }]);
  });

  test("sendAction/startTask/cancelTask/sendBinary forward to session with namespaced events", () => {
    const session = new MockSession();
    const sync = new Sync("TASKS", session as any);

    sync.sendAction({ type: "DO", id: 1 });
    sync.startTask({ type: "UPLOAD", id: "t1" } as any);
    sync.cancelTask({ type: "UPLOAD" });

    const bin = new Uint8Array([1, 2, 3]).buffer;
    sync.sendBinary({ type: "BIN", name: "file" }, bin);

    expect(session.sent).toEqual([
      { event: actionEvent("TASKS"), data: { type: "DO", id: 1 } },
      { event: "_TASK_START:TASKS", data: { type: "UPLOAD", id: "t1" } },
      { event: "_TASK_CANCEL:TASKS", data: { type: "UPLOAD" } },
    ]);

    expect(session.sentBinary).toHaveLength(1);
    expect(session.sentBinary[0].event).toBe(actionEvent("TASKS"));
    expect(session.sentBinary[0].meta).toEqual({ type: "BIN", name: "file" });
    expect(session.sentBinary[0].data).toBe(bin);
  });
});

describe("Sync.registerHandlers wiring", () => {
  test("registers handlers and invokes callbacks for GET/SET/PATCH/ACTION", () => {
    const session = new MockSession();
    const sync = new Sync("DOC", session as any);

    const getState = jest.fn(() => ({ v: 1 }));
    const setState = jest.fn();
    const patchState = jest.fn();
    const actionHandler = jest.fn();

    const cleanup = sync.registerHandlers(
      getState,
      setState,
      patchState,
      actionHandler
    );

    // _GET triggers sending current state via _SET
    session.events[getEvent("DOC")]?.({});
    expect(getState).toHaveBeenCalledTimes(1);
    expect(session.sent).toContainEqual({
      event: setEvent("DOC"),
      data: { v: 1 },
    });

    // _SET replaces state
    session.events[setEvent("DOC")]?.({ v: 2 });
    expect(setState).toHaveBeenCalledWith({ v: 2 });

    // _PATCH applies array
    const patch = [{ op: "replace", path: "/v", value: 3 }];
    session.events[patchEvent("DOC")]?.(patch);
    expect(patchState).toHaveBeenCalledWith(patch);

    // _ACTION forwards action
    const act = { type: "INC", by: 1 } as any;
    session.events[actionEvent("DOC")]?.(act);
    expect(actionHandler).toHaveBeenCalledWith(act);

    // cleanup removes all handlers
    cleanup();
    expect(session.events[getEvent("DOC")]).toBeUndefined();
    expect(session.events[setEvent("DOC")]).toBeUndefined();
    expect(session.events[patchEvent("DOC")]).toBeUndefined();
    expect(session.events[actionEvent("DOC")]).toBeUndefined();
  });

  test("sendOnInit registers init handler that sends current state, and is cleaned up", () => {
    const session = new MockSession();
    const sync = new Sync("INITDOC", session as any, true);

    const getState = jest.fn(() => ({ init: true }));
    const setState = jest.fn();
    const patchState = jest.fn();
    const actionHandler = jest.fn();

    const cleanup = sync.registerHandlers(
      getState,
      setState,
      patchState,
      actionHandler
    );

    // verify init registered
    expect(typeof session.inits["INITDOC"]).toBe("function");

    // simulate init callback (e.g., on connect)
    session.inits["INITDOC"]?.();
    expect(getState).toHaveBeenCalledTimes(1);
    expect(session.sent).toContainEqual({
      event: setEvent("INITDOC"),
      data: { init: true },
    });

    cleanup();
    expect(session.inits["INITDOC"]).toBeUndefined();
  });
});

describe("utility conversions", () => {
  test("convertImmerPatchesToJsonPatch ensures leading slash and path join", () => {
    const immer = [
      { op: "replace", path: ["a", "b"], value: 1 },
      { op: "remove", path: ["c"] },
    ] as any;
    const json = convertImmerPatchesToJsonPatch(immer);
    expect(json).toEqual([
      { op: "replace", path: "/a/b", value: 1 },
      { op: "remove", path: "/c" },
    ]);
  });

  test("convertShallowUpdateToImmerPatch maps keys to replace patches", () => {
    const immer = convertShallowUpdateToImmerPatch({ x: 1, y: true });
    expect(immer).toEqual([
      { op: "replace", path: ["x"], value: 1 },
      { op: "replace", path: ["y"], value: true },
    ]);
  });
});
