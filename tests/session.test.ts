import { waitFor } from "@testing-library/dom";
import { Session } from "../src/session";
import {
  MockWebSocket,
  createToastMock,
  installMockWebSocket,
  resetMockWebSocket,
  restoreMockWebSocket,
} from "./utils/mocks";

jest.useFakeTimers();

// Mock js-file-download
const fileDownloadMock = jest.fn();
jest.mock("js-file-download", () => {
  return {
    __esModule: true,
    default: (...args: any[]) => fileDownloadMock(...args),
  };
});

// Attach to global mock
beforeAll(() => {
  installMockWebSocket();
});

afterAll(() => {
  restoreMockWebSocket();
});

afterEach(() => {
  jest.clearAllMocks();
  resetMockWebSocket();
  fileDownloadMock.mockReset();
});

describe("Session event management", () => {
  test("register and deregister events", () => {
    const session = new Session("ws://localhost");

    const handler = jest.fn();
    session.registerEvent("HELLO", handler);
    expect(() => session.registerEvent("HELLO", handler)).toThrow();

    session.deregisterEvent("HELLO");
    expect(() => session.deregisterEvent("HELLO")).toThrow();
  });

  test("register/deregister init handlers", () => {
    const session = new Session("ws://localhost");
    const init = jest.fn();
    session.registerInit("key", init);
    expect(() => session.registerInit("key", init)).toThrow();
    session.deregisterInit("key");
    expect(() => session.deregisterInit("key")).toThrow();
  });

  test("register/deregister binary handler", () => {
    const session = new Session("ws://localhost");
    const bin = jest.fn();
    session.registerBinary(bin);
    expect(() => session.registerBinary(bin)).toThrow();
    session.deregisterBinary();
    expect(() => session.deregisterBinary()).toThrow();
  });
});

describe("Session send APIs", () => {
  test("send while not connected warns and does not send", () => {
    const toast = createToastMock();
    const session = new Session("ws://localhost", "Server", toast);
    // not connected -> ws is null
    session.send("FOO", { bar: 1 });
    expect(toast.error).toHaveBeenCalled();
  });

  test("send when connected serializes payload", () => {
    const toast = createToastMock();
    const session = new Session("ws://localhost", "Server", toast);
    const cleanup = session.connect();
    expect(toast.info).toHaveBeenCalled();
    // Open socket
    MockWebSocket.instances[0].open();
    expect(toast.success).toHaveBeenCalled();

    session.send("FOO", { a: 1 });
    const sent = MockWebSocket.instances[0].sent;
    expect(sent).toHaveLength(1);
    const frame = JSON.parse(sent[0]);
    expect(frame).toEqual({ type: "FOO", data: { a: 1 } });

    cleanup?.();
  });

  test("sendBinary sends meta then raw data", () => {
    const toast = createToastMock();
    const session = new Session("ws://localhost", "Server", toast);
    const cleanup = session.connect();
    MockWebSocket.instances[0].open();

    const meta = { type: "X", meta: 2 } as any;
    const buf = new Uint8Array([1, 2, 3]).buffer;
    session.sendBinary("BIN_EVT", meta, buf);
    const sent = MockWebSocket.instances[0].sent;
    expect(sent).toHaveLength(2);
    expect(JSON.parse(sent[0])).toEqual({
      type: "_BIN_META",
      data: { type: "BIN_EVT", metadata: meta },
    });
    expect(sent[1]).toBe(buf);

    cleanup?.();
  });
});

describe("Session websocket lifecycle", () => {
  test("connect configures ws, sets binaryType and connection flags", () => {
    const toast = createToastMock();
    const session = new Session(
      "ws://localhost",
      "MySrv",
      toast,
      "arraybuffer"
    );
    const cleanup = session.connect();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].binaryType).toBe("arraybuffer");
    MockWebSocket.instances[0].open();
    expect(session.isConnected).toBe(true);
    cleanup?.();
  });

  test("onConnectionChange callback fires on open/close", () => {
    const toast = createToastMock();
    const session = new Session("ws://localhost", "Srv", toast);
    const cb = jest.fn();
    session.onConnectionChange = cb;
    const cleanup = session.connect();
    MockWebSocket.instances[0].open();
    expect(cb).toHaveBeenCalledWith(true);
    MockWebSocket.instances[0].close();
    expect(cb).toHaveBeenCalledWith(false);
    cleanup?.();
  });

  test("auto reconnect schedules retry and doubles interval", () => {
    const toast = createToastMock();
    const session: any = new Session("ws://localhost", "Srv", toast);
    session.minRetryInterval = 250;
    session.maxRetryInterval = 10000;
    const cleanup = session.connect();
    MockWebSocket.instances[0].open();
    // After open, retryInterval reset
    expect(session.retryInterval).toBe(250);
    // Trigger close -> schedule reconnect
    MockWebSocket.instances[0].close();
    expect(toast.warning).toHaveBeenCalled();
    expect(session.isConnected).toBe(false);
    // Backoff doubled
    expect(session.retryInterval).toBe(500);
    // Run timers to reconnect
    jest.runOnlyPendingTimers();
    expect(MockWebSocket.instances.length).toBe(2);
    cleanup?.();
  });

  test("disconnect disables autoReconnect and cancels retry", () => {
    const toast = createToastMock();
    const session: any = new Session("ws://localhost", "Srv", toast);
    const cleanup = session.connect();
    MockWebSocket.instances[0].open();
    // Force a close to schedule retry
    MockWebSocket.instances[0].close();
    // Immediately disconnect to cancel retry
    session.disconnect();
    // Clear timers -> no additional connect should occur
    jest.runOnlyPendingTimers();
    expect(MockWebSocket.instances.length).toBe(1);
    cleanup?.();
  });

  test("onerror toasts error and closes socket", () => {
    const toast = createToastMock();
    const session = new Session("ws://localhost", "Srv", toast);
    const cleanup = session.connect();
    const ws = MockWebSocket.instances[0];
    // Trigger error
    ws.error(new Event("error"));
    expect(toast.error).toHaveBeenCalled();
    // Error handler calls close -> which should call onclose
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    cleanup?.();
  });
});

describe("Session message routing", () => {
  test("routes to registered event handler", () => {
    const toast = createToastMock();
    const session = new Session("ws://localhost", "Srv", toast);
    const cleanup = session.connect();
    MockWebSocket.instances[0].open();
    const handler = jest.fn();
    session.registerEvent("PING", handler);
    // Send message
    MockWebSocket.instances[0].receive(
      JSON.stringify({ type: "PING", data: { x: 1 } })
    );
    expect(handler).toHaveBeenCalledWith({ x: 1 });
    cleanup?.();
  });

  test("handles _DISCONNECT by disconnecting and showing toast", () => {
    const toast = createToastMock();
    const session = new Session("ws://localhost", "Srv", toast);
    const cleanup = session.connect();
    MockWebSocket.instances[0].open();
    MockWebSocket.instances[0].receive(
      JSON.stringify({ type: "_DISCONNECT", data: "Maintenance" })
    );
    expect(session.isConnected).toBe(false);
    expect(toast.loading).toHaveBeenCalled();
    cleanup?.();
  });

  test("handles _BIN_META + next binary using eventHandlers", () => {
    const toast = createToastMock();
    const session = new Session("ws://localhost", "Srv", toast);
    const cleanup = session.connect();
    MockWebSocket.instances[0].open();
    const binHandler = jest.fn();
    session.registerEvent("BINARY_EVT", binHandler);
    // Meta
    MockWebSocket.instances[0].receive(
      JSON.stringify({
        type: "_BIN_META",
        data: { type: "BINARY_EVT", metadata: { a: 5 } },
      })
    );
    // Binary payload simulated by ArrayBuffer
    const payload = new Uint8Array([9, 8, 7]).buffer;
    MockWebSocket.instances[0].receive(payload);
    expect(binHandler).toHaveBeenCalledWith({ data: payload, a: 5 });
    cleanup?.();
  });

  test("routes raw binary to binaryHandler when no bin meta", () => {
    const toast = createToastMock();
    const session = new Session("ws://localhost", "Srv", toast);
    const cleanup = session.connect();
    MockWebSocket.instances[0].open();
    const rawBin = jest.fn();
    session.registerBinary(rawBin);
    const payload = new Uint8Array([1]).buffer;
    MockWebSocket.instances[0].receive(payload);
    expect(rawBin).toHaveBeenCalledWith(payload);
    cleanup?.();
  });

  test("handles _DOWNLOAD by fetching data uri and invoking file download", async () => {
    // Use real timers for waitFor
    jest.useRealTimers();
    const toast = createToastMock();
    const session = new Session("ws://localhost", "Srv", toast);
    const cleanup = session.connect();
    MockWebSocket.instances[0].open();

    // Mock global fetch -> returns Response-like with blob()
    const blob = new Blob(["hello"]);
    const fetchMock = jest.fn().mockResolvedValue({
      blob: () => Promise.resolve(blob),
    } as any);
    (global as any).fetch = fetchMock;

    MockWebSocket.instances[0].receive(
      JSON.stringify({
        type: "_DOWNLOAD",
        data: { filename: "a.bin", data: "aGVsbG8=" },
      })
    );

    // Wait until fileDownload is called
    await waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalled();
        expect(fileDownloadMock).toHaveBeenCalledWith(blob, "a.bin");
      },
      { timeout: 1000 }
    );

    cleanup?.();
    (global as any).fetch = undefined;
    jest.useFakeTimers();
  });
});
