import { Sync, convertImmerPatchesToJsonPatch, patchEvent } from "../src/sync";
import { MockSession } from "./utils/mocks";

describe("Sync patch compression", () => {
  test("no-op when no patches queued", () => {
    const session = new MockSession();
    const sync = new Sync("E0", session as any);
    sync.compressThreshold = 1;
    sync.flush();
    expect(session.sent).toHaveLength(0);
  });

  test("compresses sequential replace/add on same keys into minimal set when threshold met", () => {
    const session = new MockSession();
    const sync = new Sync("C", session as any);

    const base = { a: 1 } as any;

    // Simulate multiple immer patch batches produced from sequential updates
    // 1) add b=9, 2) replace a=3, 3) replace b=99, 4) replace a=5
    sync.appendPatch([{ op: "add", path: ["b"], value: 9 } as any], base);
    const s1 = { a: 1, b: 9 } as any;
    sync.appendPatch([{ op: "replace", path: ["a"], value: 3 } as any], s1);
    const s2 = { a: 3, b: 9 } as any;
    sync.appendPatch([{ op: "replace", path: ["b"], value: 99 } as any], s2);
    const s3 = { a: 3, b: 99 } as any;
    sync.appendPatch([{ op: "replace", path: ["a"], value: 5 } as any], s3);

    // Force compression by lowering threshold
    sync.compressThreshold = 2;
    sync.flush();

    expect(session.sent).toHaveLength(1);
    const sent = session.sent[0];
    expect(sent.event).toBe(patchEvent("C"));
    const json = sent.data;
    // Minimal net effect relative to base should be: b=99, a=5
    expect(json).toEqual(
      convertImmerPatchesToJsonPatch([
        { op: "add", path: ["b"], value: 99 } as any,
        { op: "replace", path: ["a"], value: 5 } as any,
      ])
    );
  });

  test("does not compress when threshold is null", () => {
    const session = new MockSession();
    const sync = new Sync("NC", session as any);
    const base = { c: 0 } as any;

    sync.compressThreshold = null;
    sync.appendPatch([{ op: "replace", path: ["c"], value: 1 } as any], base);
    sync.appendPatch([{ op: "replace", path: ["c"], value: 2 } as any], {
      c: 1,
    } as any);
    sync.flush();

    // Expect two separate replaces (no compression)
    expect(session.sent[0].data).toEqual(
      convertImmerPatchesToJsonPatch([
        { op: "replace", path: ["c"], value: 1 } as any,
        { op: "replace", path: ["c"], value: 2 } as any,
      ])
    );
  });

  test("does not compress if base snapshot is not captured", () => {
    const session = new MockSession();
    const sync = new Sync("NB", session as any);

    // append without base snapshot
    sync.compressThreshold = 1;
    sync.appendPatch([{ op: "replace", path: ["x"], value: 1 } as any]);
    sync.appendPatch([{ op: "replace", path: ["x"], value: 2 } as any]);
    sync.flush();

    // Without a base snapshot, we cannot rebase patches, so we send as-is
    expect(session.sent[0].data).toEqual(
      convertImmerPatchesToJsonPatch([
        { op: "replace", path: ["x"], value: 1 } as any,
        { op: "replace", path: ["x"], value: 2 } as any,
      ])
    );
  });

  test("resets compression state after flush", () => {
    const session = new MockSession();
    const sync = new Sync("RST", session as any);
    const base = { a: 0 } as any;
    sync.compressThreshold = 1;

    sync.appendPatch([{ op: "replace", path: ["a"], value: 1 } as any], base);
    sync.flush();

    const afterBase = { a: 1 } as any;
    sync.appendPatch(
      [{ op: "replace", path: ["a"], value: 2 } as any],
      afterBase
    );
    sync.flush();

    expect(session.sent).toHaveLength(2);
  });

  test("handles mixed operations (add, replace, remove) across keys", () => {
    const session = new MockSession();
    const sync = new Sync("MIX", session as any);
    const base = { a: 1, b: 2 } as any;
    sync.compressThreshold = 1;

    // add c, replace a, remove b
    sync.appendPatch([{ op: "add", path: ["c"], value: 10 } as any], base);
    sync.appendPatch([{ op: "replace", path: ["a"], value: 5 } as any], {
      a: 1,
      b: 2,
      c: 10,
    } as any);
    sync.appendPatch([{ op: "remove", path: ["b"] } as any], {
      a: 5,
      b: 2,
      c: 10,
    } as any);

    sync.flush();
    expect(session.sent).toHaveLength(1);
    const data = session.sent[0].data;
    // Net effect relative to base: a=5, add c=10, remove b
    expect(data).toEqual(
      expect.arrayContaining([
        { op: "replace", path: "/a", value: 5 },
        { op: "add", path: "/c", value: 10 },
        { op: "remove", path: "/b" },
      ])
    );
  });

  test("large threshold avoids compression until exceeded", () => {
    const session = new MockSession();
    const sync = new Sync("TH", session as any);
    sync.compressThreshold = 100;
    const base = { x: 0 } as any;
    sync.appendPatch([{ op: "replace", path: ["x"], value: 1 } as any], base);
    sync.appendPatch([{ op: "replace", path: ["x"], value: 2 } as any], {
      x: 1,
    } as any);
    sync.flush();
    expect(session.sent[0].data).toEqual([
      { op: "replace", path: "/x", value: 1 },
      { op: "replace", path: "/x", value: 2 },
    ]);
  });
});
