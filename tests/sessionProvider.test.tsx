import { act, cleanup, render, screen } from "@testing-library/react";
import React, { useContext } from "react";
import { DefaultSessionContext, SessionProvider } from "../src/session";
import {
  MockWebSocket,
  installMockWebSocket,
  restoreMockWebSocket,
} from "./utils/mocks";

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

beforeAll(() => {
  installMockWebSocket();
});
afterAll(() => {
  restoreMockWebSocket();
});
afterEach(() => {
  cleanup();
  uuidCalls = [];
  MockWebSocket.instances = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
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
  test("autoconnect connects on mount and disconnects on unmount", () => {
    const toast = createToastMock();
    const { unmount } = render(
      <SessionProvider url="ws://localhost/a" toast={toast} autoconnect>
        <div />
      </SessionProvider>
    );

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe("ws://localhost/a");

    // Simulate open
    MockWebSocket.instances[0].open();
    expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.OPEN);

    unmount();
    expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CLOSED);
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

  test("creates new session when url changes and disconnects old one", () => {
    const toast = createToastMock();
    const { rerender } = render(
      <SessionProvider url="ws://localhost/a" toast={toast} autoconnect>
        <div />
      </SessionProvider>
    );
    expect(MockWebSocket.instances).toHaveLength(1);
    const first = MockWebSocket.instances[0];
    first.open();

    rerender(
      <SessionProvider url="ws://localhost/b" toast={toast} autoconnect>
        <div />
      </SessionProvider>
    );

    // Old should be closed, new should be created
    expect(first.readyState).toBe(MockWebSocket.CLOSED);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.instances[1].url).toBe("ws://localhost/b");
  });
});

describe("SessionProvider wsAuth", () => {
  test("generates and persists ids then responds to _REQUEST_USER_SESSION", async () => {
    const toast = createToastMock();
    render(
      <SessionProvider url="ws://localhost/a" toast={toast} autoconnect wsAuth>
        <div />
      </SessionProvider>
    );

    const ws = MockWebSocket.instances[0];
    ws.open();

    // Backend requests user/session
    await act(async () => {
      ws.receive(JSON.stringify({ type: "_REQUEST_USER_SESSION", data: {} }));
    });

    // Session should send _USER_SESSION with mocked UUIDs
    const sent = ws.sent.map((x) =>
      typeof x === "string" ? JSON.parse(x) : x
    );
    const meta = sent.find((f: any) => f.type === "_USER_SESSION");
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
    window.localStorage.setItem("_USER_ID", JSON.stringify("EXISTING-U"));
    window.sessionStorage.setItem("_SESSION_ID", JSON.stringify("EXISTING-S"));

    const toast = createToastMock();
    render(
      <SessionProvider url="ws://localhost/a" toast={toast} autoconnect wsAuth>
        <div />
      </SessionProvider>
    );

    const ws = MockWebSocket.instances[0];
    ws.open();

    await act(async () => {
      ws.receive(JSON.stringify({ type: "_REQUEST_USER_SESSION", data: {} }));
    });

    const sent = ws.sent.map((x) =>
      typeof x === "string" ? JSON.parse(x) : x
    );
    const meta = sent.find((f: any) => f.type === "_USER_SESSION");
    expect(meta).toEqual({
      type: "_USER_SESSION",
      data: { user: "EXISTING-U", session: "EXISTING-S" },
    });

    // No uuid generated
    expect(uuidCalls).toEqual([]);
  });
});
