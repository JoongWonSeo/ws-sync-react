import { waitFor } from "@testing-library/dom";
import WS from "jest-websocket-mock";
import { Session } from "../src/session";
import { createToastMock } from "./utils/mocks";

// Mock js-file-download
const fileDownloadMock = jest.fn();
jest.mock("js-file-download", () => {
  return {
    __esModule: true,
    default: (...args: any[]) => fileDownloadMock(...args),
  };
});

let server: WS;

beforeEach(() => {
  server = new WS("ws://localhost");
});

afterEach(() => {
  jest.clearAllMocks();
  fileDownloadMock.mockReset();
  WS.clean();
});

describe("Session event management", () => {
  test("register and deregister events", () => {
    const session = new Session({ url: "ws://localhost" });

    const handler = jest.fn();
    session.registerEvent("HELLO", handler);
    expect(() => session.registerEvent("HELLO", handler)).toThrow();

    session.deregisterEvent("HELLO");
    expect(() => session.deregisterEvent("HELLO")).toThrow();
  });

  test("register/deregister init handlers", () => {
    const session = new Session({ url: "ws://localhost" });
    const init = jest.fn();
    session.registerInit("key", init);
    expect(() => session.registerInit("key", init)).toThrow();
    session.deregisterInit("key");
    expect(() => session.deregisterInit("key")).toThrow();
  });

  test("register/deregister binary handler", () => {
    const session = new Session({ url: "ws://localhost" });
    const bin = jest.fn();
    session.registerBinary(bin);
    expect(() => session.registerBinary(bin)).toThrow();
    session.deregisterBinary();
    expect(() => session.deregisterBinary()).toThrow();
  });

  test("override allows re-registering event handlers via parameter", () => {
    const session = new Session({ url: "ws://localhost" });
    const handler1 = jest.fn();
    const handler2 = jest.fn();

    session.registerEvent("TEST", handler1);
    // Should not throw when override=true
    expect(() => session.registerEvent("TEST", handler2, true)).not.toThrow();
  });

  test("override allows re-registering init handlers via parameter", () => {
    const session = new Session({ url: "ws://localhost" });
    const init1 = jest.fn();
    const init2 = jest.fn();

    session.registerInit("key", init1);
    // Should not throw when override=true
    expect(() => session.registerInit("key", init2, true)).not.toThrow();
  });

  test("override allows re-registering binary handler via parameter", () => {
    const session = new Session({ url: "ws://localhost" });
    const bin1 = jest.fn();
    const bin2 = jest.fn();

    session.registerBinary(bin1);
    // Should not throw when override=true
    expect(() => session.registerBinary(bin2, true)).not.toThrow();
  });

  test("default override from constructor allows re-registering", () => {
    const session = new Session({ url: "ws://localhost", override: true });
    const handler1 = jest.fn();
    const handler2 = jest.fn();

    session.registerEvent("TEST", handler1);
    // Should not throw because session has default override=true
    expect(() => session.registerEvent("TEST", handler2)).not.toThrow();

    const init1 = jest.fn();
    const init2 = jest.fn();
    session.registerInit("key", init1);
    expect(() => session.registerInit("key", init2)).not.toThrow();

    const bin1 = jest.fn();
    const bin2 = jest.fn();
    session.registerBinary(bin1);
    expect(() => session.registerBinary(bin2)).not.toThrow();
  });

  test("explicit override parameter overrides session default", () => {
    const session = new Session({ url: "ws://localhost", override: true });
    const handler1 = jest.fn();
    const handler2 = jest.fn();

    session.registerEvent("TEST", handler1);
    // Explicitly set override=false should throw even though session default is true
    expect(() => session.registerEvent("TEST", handler2, false)).toThrow();
  });
});

describe("Session send APIs", () => {
  test("send while not connected warns and does not send", () => {
    const toast = createToastMock();
    const session = new Session({ url: "ws://localhost", label: "Server", toast });
    // not connected -> ws is null
    session.send("FOO", { bar: 1 });
    expect(toast.error).toHaveBeenCalled();
  });

  test("send when connected serializes payload", async () => {
    const toast = createToastMock();
    const session = new Session({ url: "ws://localhost", label: "Server", toast });
    const cleanup = session.connect();
    expect(toast.info).toHaveBeenCalled();
    await server.connected;
    expect(toast.success).toHaveBeenCalled();

    session.send("FOO", { a: 1 });
    const frame = JSON.parse((await server.nextMessage) as string) as any;
    expect(frame).toEqual({ type: "FOO", data: { a: 1 } });

    cleanup?.();
  });

  test("sendBinary sends meta then raw data", async () => {
    const toast = createToastMock();
    const session = new Session({ url: "ws://localhost", label: "Server", toast });
    const cleanup = session.connect();
    await server.connected;

    const meta = { type: "X", meta: 2 } as any;
    const buf = new Uint8Array([1, 2, 3]).buffer;
    session.sendBinary("BIN_EVT", meta, buf);
    const first = JSON.parse((await server.nextMessage) as string) as any;
    expect(first).toEqual({
      type: "_BIN_META",
      data: { type: "BIN_EVT", metadata: meta },
    });
    const second = await server.nextMessage;
    expect(second instanceof ArrayBuffer).toBe(true);
    expect(second).toBe(buf);

    cleanup?.();
  });
});

describe("Session websocket lifecycle", () => {
  test("connect configures ws, sets binaryType and connection flags", async () => {
    const toast = createToastMock();
    const session = new Session({
      url: "ws://localhost",
      label: "MySrv",
      toast,
      binaryType: "arraybuffer",
    });
    const cleanup = session.connect();
    const client = (await server.connected) as unknown as WebSocket;
    expect(client.binaryType).toBe("arraybuffer");
    expect(session.isConnected).toBe(true);
    cleanup?.();
  });

  test("onConnectionChange callback fires on open/close", async () => {
    const toast = createToastMock();
    const session = new Session({ url: "ws://localhost", label: "Srv", toast });
    const cb = jest.fn();
    session.onConnectionChange = cb;
    const cleanup = session.connect();
    await server.connected;
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(true);
    server.close();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith(false);
    cleanup?.();
  });

  test("auto reconnect schedules retry and doubles interval (single change events per transition)", async () => {
    const toast = createToastMock();
    const session: any = new Session({
      url: "ws://localhost",
      label: "Srv",
      toast,
      minRetryInterval: 20,
      maxRetryInterval: 10000,
    });
    const cb = jest.fn();
    session.onConnectionChange = cb;
    const cleanup = session.connect();
    await server.connected;
    // After open, retryInterval reset
    expect(session.retryInterval).toBe(20);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(true);
    // Trigger close -> schedule reconnect
    server.close();
    expect(toast.warning).toHaveBeenCalled();
    expect(session.isConnected).toBe(false);
    // Backoff doubled
    expect(session.retryInterval).toBe(40);
    // Wait for reconnect and ensure a new connection occurs
    await server.connected;
    // Should have fired true on connect and false on close
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls.map((c) => c[0])).toEqual([true, false]);
    cleanup?.();
  });

  test("disconnect disables autoReconnect and sets isConnected false (no duplicate change)", async () => {
    const toast = createToastMock();
    const session: any = new Session({ url: "ws://localhost", label: "Srv", toast });
    const cb = jest.fn();
    session.onConnectionChange = cb;
    const cleanup = session.connect();
    await server.connected;
    // Force a close to schedule retry
    server.close();
    // Immediately disconnect to cancel retry
    session.disconnect();
    expect(session.isConnected).toBe(false);
    // Calls: connect(true), close(false), disconnect(false) should not duplicate close(false)
    // Because we guard on previous state, the disconnect false shouldn't increment.
    expect(cb.mock.calls.map((c) => c[0])).toEqual([true, false]);
    cleanup?.();
  });

  test("onerror toasts error and closes socket", async () => {
    const toast = createToastMock();
    const session = new Session({ url: "ws://localhost", label: "Srv", toast });
    const cleanup = session.connect();
    await server.connected;
    // Trigger error and close from server
    server.error();
    expect(toast.error).toHaveBeenCalled();
    // Error handler calls close -> which should call onclose
    expect(session.isConnected).toBe(false);
    cleanup?.();
  });

  test("_DISCONNECT does not double-fire onConnectionChange", async () => {
    const toast = createToastMock();
    const session = new Session({ url: "ws://localhost", label: "Srv", toast });
    const cb = jest.fn();
    session.onConnectionChange = cb;
    const cleanup = session.connect();
    await server.connected;
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(true);
    // Server initiates graceful disconnect
    server.send(JSON.stringify({ type: "_DISCONNECT", data: "Maintenance" }));
    await server.closed;
    // Only one additional call to false, no double-fire
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls.map((c) => c[0])).toEqual([true, false]);
    cleanup?.();
  });

  test("_DISCONNECT disables retries; manual connect restores retry behavior", async () => {
    const toast = createToastMock();
    const session: any = new Session({
      url: "ws://localhost",
      label: "Srv",
      toast,
      minRetryInterval: 10,
      maxRetryInterval: 1000,
    });
    const cleanup = session.connect();
    await server.connected;
    // Trigger graceful server disconnect via special message
    server.send(JSON.stringify({ type: "_DISCONNECT", data: "Maintenance" }));
    await server.closed;
    // After graceful disconnect, autoReconnect should be false and no retry scheduled
    expect(session.autoReconnect).toBe(false);
    expect(session.retryTimeout).toBe(null);

    // Manual reconnect by user
    const cleanup2 = session.connect();
    await server.connected;
    // Ensure autoReconnect restored
    expect(session.autoReconnect).toBe(true);
    // Simulate unexpected server close -> should schedule retry and backoff
    server.close();
    expect(toast.warning).toHaveBeenCalled();
    expect(session.retryTimeout).not.toBe(null);
    cleanup2?.();
    cleanup?.();
  });
});

describe("Session message routing", () => {
  test("routes to registered event handler", async () => {
    const toast = createToastMock();
    const session = new Session({ url: "ws://localhost", label: "Srv", toast });
    const cleanup = session.connect();
    await server.connected;
    const handler = jest.fn();
    session.registerEvent("PING", handler);
    // Send message
    server.send(JSON.stringify({ type: "PING", data: { x: 1 } }));
    expect(handler).toHaveBeenCalledWith({ x: 1 });
    cleanup?.();
  });

  test("handles _DISCONNECT by disconnecting and showing toast exactly once", async () => {
    const toast = createToastMock();
    const session = new Session({ url: "ws://localhost", label: "Srv", toast });
    const cb = jest.fn();
    session.onConnectionChange = cb as any;
    const cleanup = session.connect();
    await server.connected;
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(true);
    server.send(JSON.stringify({ type: "_DISCONNECT", data: "Maintenance" }));
    await server.closed;
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith(false);
    expect(session.isConnected).toBe(false);
    expect(toast.loading).toHaveBeenCalled();
    // Should have fired: true (open), false (disconnect) -> exactly two calls
    expect(cb.mock.calls.map((c) => c[0])).toEqual([true, false]);
    cleanup?.();
  });

  test("handles _BIN_META + next binary using eventHandlers", async () => {
    const toast = createToastMock();
    const session = new Session({ url: "ws://localhost", label: "Srv", toast });
    const cleanup = session.connect();
    await server.connected;
    const binHandler = jest.fn();
    session.registerEvent("BINARY_EVT", binHandler);
    // Meta
    server.send(
      JSON.stringify({
        type: "_BIN_META",
        data: { type: "BINARY_EVT", metadata: { a: 5 } },
      })
    );
    // Binary payload simulated by ArrayBuffer
    const payload = new Uint8Array([9, 8, 7]).buffer;
    server.send(payload as any);
    await waitFor(() =>
      expect(binHandler).toHaveBeenCalledWith({ data: payload, a: 5 })
    );
    cleanup?.();
  });

  test("routes raw binary to binaryHandler when no bin meta", async () => {
    const toast = createToastMock();
    const session = new Session({ url: "ws://localhost", label: "Srv", toast });
    const cleanup = session.connect();
    await server.connected;
    const rawBin = jest.fn();
    session.registerBinary(rawBin);
    const payload = new Uint8Array([1]).buffer;
    server.send(payload as any);
    await waitFor(() => expect(rawBin).toHaveBeenCalledWith(payload));
    cleanup?.();
  });

  test("handles _DOWNLOAD by fetching data uri and invoking file download", async () => {
    const toast = createToastMock();
    const session = new Session({ url: "ws://localhost", label: "Srv", toast });
    const cleanup = session.connect();
    await server.connected;

    // Mock global fetch -> returns Response-like with blob()
    const blob = new Blob(["hello"]);
    const fetchMock = jest.fn().mockResolvedValue({
      blob: () => Promise.resolve(blob),
    } as any);
    (global as any).fetch = fetchMock;

    server.send(
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
  });
});
