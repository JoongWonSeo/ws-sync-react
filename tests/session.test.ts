import { Session } from '../src/session';

describe('Session event management', () => {
  test('register and deregister events', () => {
    const session = new Session('ws://localhost');

    const handler = jest.fn();
    session.registerEvent('HELLO', handler);
    expect(() => session.registerEvent('HELLO', handler)).toThrow();

    session.deregisterEvent('HELLO');
    expect(() => session.deregisterEvent('HELLO')).toThrow();
  });
});
