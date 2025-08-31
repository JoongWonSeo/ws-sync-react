export class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  binaryType: BinaryType = "blob";

  onopen: ((this: WebSocket, ev: Event) => any) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
  onerror: ((this: WebSocket, ev: Event) => any) | null = null;

  sent: any[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: any) {
    this.sent.push(data);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen &&
      this.onopen.call(this as unknown as WebSocket, new Event("open"));
  }

  receive(data: any) {
    const ev = { data } as MessageEvent;
    this.onmessage && this.onmessage.call(this as unknown as WebSocket, ev);
  }

  error(err: any) {
    this.onerror && this.onerror.call(this as unknown as WebSocket, err as any);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose &&
      this.onclose.call(
        this as unknown as WebSocket,
        new Event("close") as any
      );
  }

  static instances: MockWebSocket[] = [];
}

let originalWebSocket: any;

export function installMockWebSocket() {
  originalWebSocket = (global as any).WebSocket;
  (global as any).WebSocket = MockWebSocket as any;
}

export function restoreMockWebSocket() {
  (global as any).WebSocket = originalWebSocket as any;
}

export function resetMockWebSocket() {
  MockWebSocket.instances = [];
}

export function createToastMock() {
  return {
    info: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    loading: jest.fn(),
  };
}
