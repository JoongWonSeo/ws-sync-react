import { Sync, patchEvent } from "../src/sync";
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
