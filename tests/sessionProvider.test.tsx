import { act, cleanup, render, screen } from "@testing-library/react";
import WS from "jest-websocket-mock";
import React, { useContext } from "react";
import { DefaultSessionContext, SessionProvider } from "../src/session";

// Use real timers to avoid interference with other test files
beforeEach(() => {
  jest.useRealTimers();
});

// Mock uuid to be deterministic in tests
let uuidCalls: string[] = [];
jest.mock("uuid", () => ({
  v4: () => {
    const next = uuidCalls.length === 0 ? "USER-1" : "SESS-1";
    uuidCalls.push(next);
    return next;
  },
}));

afterEach(() => {
  cleanup();
  uuidCalls = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
  WS.clean();
});

function createToastMock() {
  return {
    info: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    loading: jest.fn(),
  };
}

function LabelProbe() {
  const session = useContext(DefaultSessionContext);
  return <div data-testid="label">{session?.label ?? "NO"}</div>;
}

describe("SessionProvider lifecycle", () => {
  test("autoconnect connects on mount and disconnects on unmount", async () => {
    const server = new WS("ws://localhost/a", { jsonProtocol: true });
    const toast = createToastMock();
    const { unmount } = render(
      <SessionProvider url="ws://localhost/a" toast={toast} autoconnect>
        <div />
      </SessionProvider>
    );

    await server.connected;

    unmount();
    await server.closed;
  });

  test("updates label and toast when props change", async () => {
    const toastA = createToastMock();
    const { rerender } = render(
      <SessionProvider url="ws://localhost/a" label="Server A" toast={toastA}>
        <LabelProbe />
      </SessionProvider>
    );
    expect(screen.getByTestId("label").textContent).toBe("Server A");

    const toastB = createToastMock();
    rerender(
      <SessionProvider url="ws://localhost/a" label="Server B" toast={toastB}>
        <LabelProbe />
      </SessionProvider>
    );

    // Wait for effect to mutate session.label, then force a re-render to read new value
    await act(async () => {
      await Promise.resolve();
    });
    rerender(
      <SessionProvider url="ws://localhost/a" label="Server B" toast={toastB}>
        <LabelProbe />
      </SessionProvider>
    );
    expect(screen.getByTestId("label").textContent).toBe("Server B");
  });

  test("creates new session when url changes and disconnects old one", async () => {
    const serverA = new WS("ws://localhost/a", { jsonProtocol: true });
    const serverB = new WS("ws://localhost/b", { jsonProtocol: true });
    const toast = createToastMock();
    const { rerender } = render(
      <SessionProvider url="ws://localhost/a" toast={toast} autoconnect>
        <div />
      </SessionProvider>
    );
    await serverA.connected;

    rerender(
      <SessionProvider url="ws://localhost/b" toast={toast} autoconnect>
        <div />
      </SessionProvider>
    );
    await serverB.connected;
    await serverA.closed;
  });
});

describe("SessionProvider wsAuth", () => {
  test("generates and persists ids then responds to _REQUEST_USER_SESSION", async () => {
    const server = new WS("ws://localhost/a", { jsonProtocol: true });
    const toast = createToastMock();
    render(
      <SessionProvider url="ws://localhost/a" toast={toast} autoconnect wsAuth>
        <div />
      </SessionProvider>
    );

    await server.connected;

    // Backend requests user/session
    await act(async () => {
      server.send({ type: "_REQUEST_USER_SESSION", data: {} });
    });

    // Session should send _USER_SESSION with mocked UUIDs
    const meta = (await server.nextMessage) as any;
    expect(meta).toEqual({
      type: "_USER_SESSION",
      data: { user: "USER-1", session: "SESS-1" },
    });

    expect(window.localStorage.getItem("_USER_ID")).toBe(
      JSON.stringify("USER-1")
    );
    expect(window.sessionStorage.getItem("_SESSION_ID")).toBe(
      JSON.stringify("SESS-1")
    );
    // Two uuid calls performed
    expect(uuidCalls).toEqual(["USER-1", "SESS-1"]);
  });

  test("reuses existing ids without calling uuid", async () => {
    const server = new WS("ws://localhost/a", { jsonProtocol: true });
    window.localStorage.setItem("_USER_ID", JSON.stringify("EXISTING-U"));
    window.sessionStorage.setItem("_SESSION_ID", JSON.stringify("EXISTING-S"));

    const toast = createToastMock();
    render(
      <SessionProvider url="ws://localhost/a" toast={toast} autoconnect wsAuth>
        <div />
      </SessionProvider>
    );

    await server.connected;

    await act(async () => {
      server.send({ type: "_REQUEST_USER_SESSION", data: {} });
    });

    const meta = (await server.nextMessage) as any;
    expect(meta).toEqual({
      type: "_USER_SESSION",
      data: { user: "EXISTING-U", session: "EXISTING-S" },
    });

    // No uuid generated
    expect(uuidCalls).toEqual([]);
  });
});
