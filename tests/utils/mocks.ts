export function createToastMock() {
  return {
    info: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    loading: jest.fn(),
  };
}

export class MockSession {
  events: Record<string, (data: any) => void> = {};
  inits: Record<string, () => void> = {};
  sent: { event: string; data: any }[] = [];
  sentBinary: { event: string; meta: any; data: ArrayBuffer }[] = [];

  send(event: string, data: any) {
    this.sent.push({ event, data });
  }

  sendBinary(event: string, meta: any, data: ArrayBuffer) {
    this.sentBinary.push({ event, meta, data });
  }

  registerEvent(ev: string, cb: (data: any) => void) {
    this.events[ev] = cb;
  }

  deregisterEvent(ev: string) {
    delete this.events[ev];
  }

  registerInit(key: string, cb: () => void) {
    this.inits[key] = cb;
  }

  deregisterInit(key: string) {
    delete this.inits[key];
  }
}

export function createMockSession() {
  return new MockSession();
}
