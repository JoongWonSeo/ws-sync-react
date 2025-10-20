import { render } from "@testing-library/react";
import React from "react";
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

describe("Sync dynamic action handlers", () => {
  test("createDelegators typing works with enum-like keys and interface params (no index signature)", () => {
    // Simulate generated types
    const Keys = {
      append: "APPEND",
      resetAll: "RESET_ALL",
      selectOrClear: "SELECT_OR_CLEAR",
      updateNote: "UPDATE_NOTE",
    } as const;
    type KeysT = (typeof Keys)[keyof typeof Keys];

    interface Params {
      APPEND: { id: string };
      RESET_ALL: null;
      SELECT_OR_CLEAR: { index: number | null };
      UPDATE_NOTE: { index: number; title: string };
    }

    // Renamed mapping object
    const Renamed = {
      add: Keys.append,
      reset: Keys.resetAll,
      select: Keys.selectOrClear,
      update: Keys.updateNote,
    } as const;

    // Construct
    const sync = new Sync("K", new MockSession() as any);
    const d = sync.createDelegators<Params>()(Renamed);
    // Type-only assertions (no runtime effect)
    d.add({ id: "x" });
    d.reset();
    d.select({ index: 1 });
    d.update({ index: 0, title: "New" });
  });

  test("createDelegators direct form infers mapping and sends actions", () => {
    const session = new MockSession();
    const sync = new Sync("DLG", session as any);

    const Keys = {
      A: "A",
      B: "B",
    } as const;
    interface Params {
      A: { x: number };
      B: null;
    }
    const map = { doA: Keys.A, doB: Keys.B } as const;

    const d = sync.createDelegators<Params>()(map);
    d.doA({ x: 1 });
    d.doB();

    expect(session.sent).toEqual([
      { event: "_ACTION:DLG", data: { type: "A", x: 1 } },
      { event: "_ACTION:DLG", data: { type: "B" } },
    ]);
  });

  test("store.sync.createDelegators works (curried)", () => {
    const session = new MockSession();
    const sync = new Sync("S2", session as any);
    const Keys = { P: "P", Q: "Q" } as const;
    interface Params {
      P: { n: number };
      Q: null;
    }

    // Simulate attachment like zustand middleware
    const callable = sync.sync.bind(sync) as unknown as {
      createDelegators: Sync["createDelegators"];
      sendAction: Sync["sendAction"];
    };
    (callable as unknown as any).createDelegators =
      sync.createDelegators.bind(sync);
    (callable as unknown as any).sendAction = sync.sendAction.bind(sync);

    const d1 = callable.createDelegators<Params>()({
      p: Keys.P,
      q: Keys.Q,
    } as const);
    d1.p({ n: 2 });
    d1.q();

    expect(session.sent).toEqual([
      { event: "_ACTION:S2", data: { type: "P", n: 2 } },
      { event: "_ACTION:S2", data: { type: "Q" } },
    ]);
  });
  test("registered dynamic handler takes precedence over catch-all", () => {
    const session = new MockSession();
    const sync = new Sync("DOC", session as any);

    const getState = jest.fn(() => ({}));
    const setState = jest.fn();
    const patchState = jest.fn();
    const catchAll = jest.fn();

    sync.registerHandlers(getState, setState, patchState, catchAll);

    const dyn = jest.fn();
    const cleanup = sync.registerExposedActions({ SCROLL: dyn });

    // Trigger action
    session.events[actionEvent("DOC")]?.({ type: "SCROLL", a: 1 });
    expect(dyn).toHaveBeenCalledWith({ a: 1 });
    expect(catchAll).not.toHaveBeenCalled();

    cleanup();
  });

  test("missing dynamic handler falls back to catch-all", () => {
    const session = new MockSession();
    const sync = new Sync("D2", session as any);
    const catchAll = jest.fn();
    sync.registerHandlers(() => ({} as any), jest.fn(), jest.fn(), catchAll);

    session.events[actionEvent("D2")]?.({ type: "NOOP", p: true });
    expect(catchAll).toHaveBeenCalledWith({ type: "NOOP", p: true });
  });

  test("cleanup deregisters dynamic handler and restores catch-all", () => {
    const session = new MockSession();
    const sync = new Sync("D3", session as any);
    const catchAll = jest.fn();
    sync.registerHandlers(() => ({} as any), jest.fn(), jest.fn(), catchAll);

    const dyn = jest.fn();
    const cleanup = sync.registerExposedActions({ A: dyn });

    session.events[actionEvent("D3")]?.({ type: "A", q: 2 });
    expect(dyn).toHaveBeenCalledTimes(1);
    expect(catchAll).not.toHaveBeenCalled();

    // After cleanup, should route to catch-all
    cleanup();
    session.events[actionEvent("D3")]?.({ type: "A", q: 3 });
    expect(dyn).toHaveBeenCalledTimes(1);
    expect(catchAll).toHaveBeenCalledWith({ type: "A", q: 3 });
  });

  test("duplicate registration throws", () => {
    const session = new MockSession();
    const sync = new Sync("D4", session as any);
    sync.registerHandlers(() => ({} as any), jest.fn(), jest.fn(), jest.fn());

    sync.registerExposedActions({ X: jest.fn() });
    expect(() => sync.registerExposedActions({ X: jest.fn() })).toThrow();
  });
});

describe("Sync task delegators", () => {
  test("createTaskDelegators typing works with enum-like keys", () => {
    // Simulate generated types
    const Keys = {
      export: "EXPORT_DATA",
      import: "IMPORT_DATA",
      process: "PROCESS_DATA",
    } as const;

    interface Params {
      EXPORT_DATA: { format: string; filename: string };
      IMPORT_DATA: { file: string };
      PROCESS_DATA: null;
    }

    const TaskNames = {
      exportData: Keys.export,
      importData: Keys.import,
      processData: Keys.process,
    } as const;

    const sync = new Sync("TASKS", new MockSession() as any);
    const tasks = sync.createTaskDelegators<Params>()(TaskNames);

    // Type-only assertions
    tasks.exportData.start({ format: "json", filename: "data.json" });
    tasks.exportData.cancel();
    tasks.importData.start({ file: "input.csv" });
    tasks.importData.cancel();
    tasks.processData.start();
    tasks.processData.cancel();
  });

  test("createTaskDelegators sends TASK_START and TASK_CANCEL events", () => {
    const session = new MockSession();
    const sync = new Sync("TSK", session as any);

    const Keys = {
      BACKUP: "BACKUP",
      RESTORE: "RESTORE",
    } as const;

    interface Params {
      BACKUP: { destination: string };
      RESTORE: null;
    }

    const map = { backup: Keys.BACKUP, restore: Keys.RESTORE } as const;

    const tasks = sync.createTaskDelegators<Params>()(map);

    tasks.backup.start({ destination: "/backup" });
    tasks.restore.start();
    tasks.backup.cancel();
    tasks.restore.cancel();

    expect(session.sent).toEqual([
      { event: "_TASK_START:TSK", data: { type: "BACKUP", destination: "/backup" } },
      { event: "_TASK_START:TSK", data: { type: "RESTORE" } },
      { event: "_TASK_CANCEL:TSK", data: { type: "BACKUP" } },
      { event: "_TASK_CANCEL:TSK", data: { type: "RESTORE" } },
    ]);
  });

  test("store.sync.createTaskDelegators works (curried)", () => {
    const session = new MockSession();
    const sync = new Sync("S3", session as any);
    const Keys = { CALC: "CALC", RENDER: "RENDER" } as const;
    interface Params {
      CALC: { iterations: number };
      RENDER: null;
    }

    // Simulate attachment like zustand middleware
    const callable = sync.sync.bind(sync) as unknown as {
      createTaskDelegators: Sync["createTaskDelegators"];
      startTask: Sync["startTask"];
      cancelTask: Sync["cancelTask"];
    };
    (callable as unknown as any).createTaskDelegators =
      sync.createTaskDelegators.bind(sync);
    (callable as unknown as any).startTask = sync.startTask.bind(sync);
    (callable as unknown as any).cancelTask = sync.cancelTask.bind(sync);

    const tasks = callable.createTaskDelegators<Params>()({
      calculate: Keys.CALC,
      render: Keys.RENDER,
    } as const);

    tasks.calculate.start({ iterations: 100 });
    tasks.calculate.cancel();
    tasks.render.start();
    tasks.render.cancel();

    expect(session.sent).toEqual([
      { event: "_TASK_START:S3", data: { type: "CALC", iterations: 100 } },
      { event: "_TASK_CANCEL:S3", data: { type: "CALC" } },
      { event: "_TASK_START:S3", data: { type: "RENDER" } },
      { event: "_TASK_CANCEL:S3", data: { type: "RENDER" } },
    ]);
  });
});

describe("Sync.useExposedActions wrapper", () => {
  test("registers on mount and cleans up on unmount", () => {
    const session = new MockSession();
    const sync = new Sync("HOOK", session as any);
    const catchAll = jest.fn();

    // Install router
    sync.registerHandlers(() => ({} as any), jest.fn(), jest.fn(), catchAll);

    const dyn = jest.fn();

    function Harness() {
      // Using the convenience wrapper inside a component
      sync.useExposedActions({ SCROLL_TO_TOP: dyn });
      return null;
    }

    const { unmount } = render(React.createElement(Harness));

    // Routes to dynamic handler while mounted
    session.events[actionEvent("HOOK")]?.({ type: "SCROLL_TO_TOP", z: 9 });
    expect(dyn).toHaveBeenCalledWith({ z: 9 });
    expect(catchAll).not.toHaveBeenCalled();

    // Unmount -> wrapper cleanup removes handler
    unmount();
    session.events[actionEvent("HOOK")]?.({ type: "SCROLL_TO_TOP", z: 10 });
    expect(catchAll).toHaveBeenCalledWith({ type: "SCROLL_TO_TOP", z: 10 });
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
