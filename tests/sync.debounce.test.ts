import {
  Sync,
  actionEvent,
  getEvent,
  patchEvent,
  setEvent,
  taskCancelEvent,
  taskStartEvent,
} from "../src/sync";
import { MockSession } from "./utils/mocks";

describe("Sync debounce + maxWait", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 0, 1, 0, 0, 0).getTime());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("debounce delays sending until timer elapses", () => {
    const session = new MockSession();
    const sync = new Sync("D", session as any);

    sync.appendPatch([{ op: "replace", path: ["a"], value: 1 } as any]);

    sync.sync({ debounceMs: 100 });
    expect(session.sent).toHaveLength(0);

    jest.advanceTimersByTime(99);
    expect(session.sent).toHaveLength(0);

    jest.advanceTimersByTime(1);
    expect(session.sent).toHaveLength(1);
    expect(session.sent[0].event).toBe(patchEvent("D"));
  });

  test("debounce is reset by subsequent sync calls before timer fires", () => {
    const session = new MockSession();
    const sync = new Sync("R", session as any);

    sync.appendPatch([{ op: "replace", path: ["a"], value: 1 } as any]);
    sync.sync({ debounceMs: 100 });
    jest.advanceTimersByTime(60);

    // Re-trigger debounce; should push out by another 100ms
    sync.sync({ debounceMs: 100 });
    jest.advanceTimersByTime(99);
    expect(session.sent).toHaveLength(0);

    jest.advanceTimersByTime(1);
    expect(session.sent).toHaveLength(1);
  });

  test("maxWaitMs caps the oldest pending patch age despite bounce", () => {
    const session = new MockSession();
    const sync = new Sync("CAP", session as any);

    // Queue first patch at t0
    sync.appendPatch([{ op: "replace", path: ["x"], value: 1 } as any]);

    // Start debounce 100ms, but cap at maxWait 150ms
    sync.sync({ debounceMs: 100, maxWaitMs: 150 }); // schedules debounce@100 and maxWait@150
    jest.advanceTimersByTime(90);

    // Add another patch and call sync again; debounce pushes to +100 from now
    sync.appendPatch([{ op: "replace", path: ["y"], value: 2 } as any]);
    sync.sync({ debounceMs: 100, maxWaitMs: 150 });

    // At t=150, maxWait should flush even though debounce would push later
    jest.advanceTimersByTime(60); // total 150
    expect(session.sent).toHaveLength(1);
    expect(session.sent[0].event).toBe(patchEvent("CAP"));
    // After flush, timers are cleared and firstPatchAt reset

    // Further calls require new patches to send again
    sync.sync({ debounceMs: 100, maxWaitMs: 150 });
    expect(session.sent).toHaveLength(1);
  });

  test("flush() sends immediately and clears timers", () => {
    const session = new MockSession();
    const sync = new Sync("F", session as any);

    sync.appendPatch([{ op: "replace", path: ["k"], value: 3 } as any]);
    sync.sync({ debounceMs: 100, maxWaitMs: 500 });
    expect(session.sent).toHaveLength(0);

    sync.flush();
    expect(session.sent).toHaveLength(1);

    // No extra sends when timers tick after flush
    jest.advanceTimersByTime(1000);
    expect(session.sent).toHaveLength(1);
  });

  test("sendAction flushes pending patches before emitting actions", () => {
    const session = new MockSession();
    const sync = new Sync("ORDER", session as any);

    sync.appendPatch([{ op: "replace", path: ["count"], value: 5 } as any]);
    sync.sync({ debounceMs: 100 });
    expect(session.sent).toHaveLength(0);

    sync.sendAction({ type: "RESET" });

    expect(session.sent).toEqual([
      {
        event: patchEvent("ORDER"),
        data: [{ op: "replace", path: "/count", value: 5 }],
      },
      { event: actionEvent("ORDER"), data: { type: "RESET" } },
    ]);

    // timers should be cleared by the flush triggered in sendAction
    jest.advanceTimersByTime(200);
    expect(session.sent).toHaveLength(2);
  });

  test("task operations flush pending patches before sending events", () => {
    const mkPatch = () => [{ op: "replace", path: ["status"], value: "dirty" } as any];

    const startSession = new MockSession();
    const syncStart = new Sync("TASK", startSession as any);
    syncStart.appendPatch(mkPatch());
    syncStart.sync({ debounceMs: 100 });
    expect(startSession.sent).toHaveLength(0);

    syncStart.startTask({ type: "UPLOAD", id: "t1" } as any);

    expect(startSession.sent).toEqual([
      {
        event: patchEvent("TASK"),
        data: [{ op: "replace", path: "/status", value: "dirty" }],
      },
      {
        event: taskStartEvent("TASK"),
        data: { type: "UPLOAD", id: "t1" },
      },
    ]);

    const cancelSession = new MockSession();
    const syncCancel = new Sync("TASK", cancelSession as any);
    syncCancel.appendPatch(mkPatch());
    syncCancel.sync({ debounceMs: 100 });
    expect(cancelSession.sent).toHaveLength(0);

    syncCancel.cancelTask({ type: "UPLOAD" });

    expect(cancelSession.sent).toEqual([
      {
        event: patchEvent("TASK"),
        data: [{ op: "replace", path: "/status", value: "dirty" }],
      },
      {
        event: taskCancelEvent("TASK"),
        data: { type: "UPLOAD" },
      },
    ]);
  });

  test("sendBinary flushes patches before sending binary payloads", () => {
    const session = new MockSession();
    const sync = new Sync("BIN", session as any);
    const payload = new Uint8Array([1, 2]).buffer;

    sync.appendPatch([{ op: "replace", path: ["mode"], value: "pending" } as any]);
    sync.sync({ debounceMs: 100 });
    expect(session.sent).toHaveLength(0);
    expect(session.sentBinary).toHaveLength(0);

    sync.sendBinary({ type: "UPLOAD" }, payload);

    expect(session.sent).toEqual([
      {
        event: patchEvent("BIN"),
        data: [{ op: "replace", path: "/mode", value: "pending" }],
      },
    ]);
    expect(session.sentBinary).toEqual([
      {
        event: actionEvent("BIN"),
        meta: { type: "UPLOAD" },
        data: payload,
      },
    ]);

    jest.advanceTimersByTime(200);
    expect(session.sent).toHaveLength(1);
    expect(session.sentBinary).toHaveLength(1);
  });

  test("fetchRemoteState discards pending local patches", () => {
    const session = new MockSession();
    const sync = new Sync("FETCH", session as any);

    sync.appendPatch([{ op: "replace", path: ["count"], value: 2 } as any]);
    sync.sync({ debounceMs: 100 });
    expect(session.sent).toHaveLength(0);

    sync.fetchRemoteState();

    expect(session.sent).toEqual([{ event: getEvent("FETCH"), data: {} }]);

    jest.advanceTimersByTime(200);
    expect(session.sent).toHaveLength(1);
  });

  test("sendState discards pending local patches", () => {
    const session = new MockSession();
    const sync = new Sync("SET", session as any);
    const payload = { value: "server" };

    sync.appendPatch([{ op: "replace", path: ["value"], value: "local" } as any]);
    sync.sync({ debounceMs: 100 });
    expect(session.sent).toHaveLength(0);

    sync.sendState(payload);

    expect(session.sent).toEqual([{ event: setEvent("SET"), data: payload }]);

    jest.advanceTimersByTime(200);
    expect(session.sent).toHaveLength(1);
  });

  test("sync() without debounce flushes immediately and cancels pending timers", () => {
    const session = new MockSession();
    const sync = new Sync("NOW", session as any);

    sync.appendPatch([{ op: "replace", path: ["v"], value: 1 } as any]);
    sync.sync({ debounceMs: 500 }); // schedule delayed flush
    expect(session.sent).toHaveLength(0);

    // Immediate flush should happen now, not after 500ms
    sync.sync();
    expect(session.sent).toHaveLength(1);

    // Debounce timers should be cleared and not fire again
    jest.advanceTimersByTime(1000);
    expect(session.sent).toHaveLength(1);
  });
});
