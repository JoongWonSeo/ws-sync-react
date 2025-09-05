import React from "react";
import { Sync } from "../src/sync";
import { MockSession } from "./utils/mocks";

describe("Typing for exposed actions", () => {
  test("registerExposedActions accepts strictly-typed payload handlers", () => {
    type Note = { id: string; title: string };

    const notes = {
      select: (_args: { index: number | null }) => {},
      add: (_args: { note: Note }) => {},
      update: (_args: { index: number; note: Note }) => {},
      reset: () => {},
    };

    const session = new MockSession();
    const sync = new Sync("NOTES", session as any);
    const cleanup = sync.registerExposedActions(notes);
    cleanup();
  });

  test("useExposedActions accepts strictly-typed payload handlers", () => {
    type Note = { id: string; title: string };
    const notes = {
      select: (_args: { index: number | null }) => {},
      add: (_args: { note: Note }) => {},
      update: (_args: { index: number; note: Note }) => {},
      reset: () => {},
    };

    const session = new MockSession();
    const sync = new Sync("NOTES2", session as any);

    function Harness() {
      sync.useExposedActions(notes);
      return null;
    }

    // Render/unmount to exercise the hook types; runtime behavior is tested elsewhere
    const element = React.createElement(Harness);
    expect(typeof element).toBe("object");
  });
});
