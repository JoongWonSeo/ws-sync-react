import { createSyncedStore } from '../src/zustand-sync'
import { Action } from '../src'

class MockSession {
  events: Record<string, (data: any) => void> = {}
  inits: Record<string, () => void> = {}
  sent: { event: string; data: any }[] = []
  send(event: string, data: any) { this.sent.push({ event, data }) }
  sendBinary(event: string, meta: any, data: ArrayBuffer) {}
  registerEvent(ev: string, cb: (data: any) => void) { this.events[ev] = cb }
  deregisterEvent(ev: string) { delete this.events[ev] }
  registerInit(key: string, cb: () => void) { this.inits[key] = cb }
  deregisterInit(key: string) { delete this.inits[key] }
}

describe('createSyncedStore', () => {
  test('local updates and syncing', () => {
    const session = new MockSession()
    const store = createSyncedStore('COUNTER', { count: 0 }, session as any)

    store.getState().setCount(1)
    expect(store.getState().count).toBe(1)
    expect(session.sent).toHaveLength(0)

    store.getState().syncCount(2)
    expect(store.getState().count).toBe(2)
    expect(session.sent).toEqual([
      { event: '_PATCH:COUNTER', data: [{ op: 'replace', path: '/count', value: 2 }] },
    ])

    store.getState().fetchRemoteState()
    expect(session.sent[1]).toEqual({ event: '_GET:COUNTER', data: {} })

    session.events['_PATCH:COUNTER']([{ op: 'replace', path: '/count', value: 5 }])
    expect(store.getState().count).toBe(5)
  })
})
