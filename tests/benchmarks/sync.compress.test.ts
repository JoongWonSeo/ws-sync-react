/* eslint-disable no-console */
import { Sync } from "../../src/sync";
import { MockSession } from "../utils/mocks";

function randInt(n: number) {
  return Math.floor(Math.random() * n);
}

describe("compression micro-benchmark", () => {
  test("compare flush with and without compression (rough timing)", () => {
    const N = 5000; // number of small patches
    const base: any = { a: 0, b: 0, c: 0, d: 0 };

    const session1 = new MockSession();
    const s1 = new Sync("B1", session1 as any);
    s1.compressThreshold = null; // disable

    const session2 = new MockSession();
    const s2 = new Sync("B2", session2 as any);
    s2.compressThreshold = 1; // always compress if possible

    // Prepare random patches
    const patches: any[] = [];
    let cur = { ...base };
    for (let i = 0; i < N; i++) {
      const key = ["a", "b", "c", "d"][randInt(4)];
      const value = randInt(1000);
      patches.push([{ op: "replace", path: [key], value }]);
      cur = { ...cur, [key]: value };
    }

    // Run without compression
    let t0 = performance.now();
    let state = { ...base };
    patches.forEach((p) => s1.appendPatch(p as any, state));
    s1.flush();
    let t1 = performance.now();

    // Run with compression
    let t2 = performance.now();
    state = { ...base };
    patches.forEach((p) => s2.appendPatch(p as any, state));
    s2.flush();
    let t3 = performance.now();

    const noCompressMs = t1 - t0;
    const compressMs = t3 - t2;

    console.log(
      `[bench] no-compress=${noCompressMs.toFixed(
        2
      )}ms, compress=${compressMs.toFixed(2)}ms, ratio=${(
        compressMs / noCompressMs
      ).toFixed(2)}`
    );

    // Sanity: both sent once
    expect(session1.sent.length).toBe(1);
    expect(session2.sent.length).toBe(1);
  });
});
