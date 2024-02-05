import { useLocalStorage, useSessionStorage } from '@uidotdev/usehooks'
import { createContext, useMemo, useEffect, Context } from 'react'
// import { this.toast } from 'sonner'
import { v4 as uuid } from 'uuid'


export const DefaultSessionContext = createContext<Session | null>(null)


interface SessionProviderProps {
  url: string
  children: React.ReactNode
  context: Context<Session | null>
  autoconnect?: boolean
  wsAuth?: boolean
  toast?: any
}

export const SessionProvider = ({ url, toast, children, context, autoconnect, wsAuth }: SessionProviderProps) => {
  const session = useMemo(() => new Session(url, toast), [url])

  if (wsAuth) {
    const [userId, setUserId] = useLocalStorage<string | null>(`_USER_ID`, null)
    const [sessionId, setSessionId] = useSessionStorage<string | null>(`_SESSION_ID`, null)

    useEffect(() => {
      session?.registerEvent("_REQUEST_USER_SESSION", () => {
        let u = userId, s = sessionId
        if (userId === null) {
          u = uuid()
          setUserId(u)
          console.log("generated new user id", u)
        }
        if (sessionId === null) {
          s = uuid()
          setSessionId(s)
          console.log("generated new session id", s)
        }
        session.send("_USER_SESSION", { user: u, session: s })
      })

      return () => {
        session?.deregisterEvent("_REQUEST_USER_SESSION")
      }
    }, [url])
  }

  if (autoconnect)
    useEffect(() => {
      return session.connect()
    }, [url])

  return (
    <context.Provider value={session}>
      {children}
    </context.Provider>
  )
}


export class Session {
  url: string;
  ws: WebSocket | null = null;

  isConnected: boolean = false;
  onConnectionChange?: ((arg0: boolean) => void) = undefined;
  minRetryInterval: number;
  maxRetryInterval: number;
  retryInterval: number;
  toast: any;

  private eventHandlers: { [event: string]: (data: any) => void } = {};
  private initHandlers: { [key: string]: (() => void) } = {};
  private binaryHandler: ((data: any) => void) | null = null;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null; // scheduled retry
  private autoReconnect: boolean = true;



  constructor(url: string, toast: any = null, minRetryInterval: number = 250, maxRetryInterval: number = 10000) {
    this.url = url;
    this.minRetryInterval = minRetryInterval;
    this.maxRetryInterval = maxRetryInterval;
    this.retryInterval = minRetryInterval;
    this.toast = toast
  }

  registerEvent(event: string, callback: (data: any) => void) {
    if (event in this.eventHandlers)
      throw new Error(`already subscribed to ${event}`)
    this.eventHandlers[event] = callback
  }

  deregisterEvent(event: string) {
    if (!(event in this.eventHandlers))
      throw new Error(`not subscribed to ${event}`)
    delete this.eventHandlers[event]
  }

  registerInit(key: string, callback: () => void) {
    if (key in this.initHandlers)
      throw new Error(`already registered`)
    this.initHandlers[key] = callback
  }

  deregisterInit(key: string) {
    if (!(key in this.initHandlers))
      throw new Error(`not registered`)
    delete this.initHandlers[key]
  }

  registerBinary(callback: (data: any) => void) {
    if (this.binaryHandler !== null)
      throw new Error(`already registered`)
    this.binaryHandler = callback
  }

  deregisterBinary() {
    if (this.binaryHandler === null)
      throw new Error(`not registered`)
    this.binaryHandler = null
  }

  send(event: string, data: any) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.toast?.error(`Sending while not connected!`)
      return
    }

    this.ws?.send(JSON.stringify({
      type: event,
      data: data,
    }))
  }

  connect() {
    console.log('connecting to ', this.url)
    this.toast?.info('Connecting to server...')
    this.ws = new WebSocket(this.url)
    this.autoReconnect = true

    this.ws.onopen = () => {
      console.log('connected')
      this.toast?.success('Connected to server!')
      this.isConnected = true
      if (this.onConnectionChange)
        this.onConnectionChange(this.isConnected)
      this.retryInterval = this.minRetryInterval
    }

    this.ws.onclose = () => {
      console.log('disconnected')
      this.isConnected = false
      if (this.onConnectionChange)
        this.onConnectionChange(this.isConnected)
      if (this.autoReconnect) {
        this.toast?.warning(`Disconnected from server: Retrying in ${this.retryInterval / 1000} seconds...`)
        this.retryTimeout = setTimeout(() => {
          // skip if we've already reconnected or deleted
          if (this !== null && this.url && !this.isConnected) {
            console.log('reconnecting')
            this.connect()
          }
        }, this.retryInterval)
        this.retryInterval = Math.min(this.retryInterval * 2, this.maxRetryInterval)
      } else {
        this.toast?.warning('Disconnected from server!')
      }
    }

    this.ws.onerror = (err) => {
      console.error(
        "Socket encountered error: ",
        err,
        "Closing socket"
      )
      this.toast?.error(`Socket Error: ${err}`)
      this.ws?.close()
    }

    this.ws.onmessage = (e) => { this.handleReceiveEvent(e) }

    return () => {
      this.disconnect()
    }
  }

  disconnect() {
    this.autoReconnect = false
    this.ws?.close()
    if (this.onConnectionChange)
      this.onConnectionChange(false)
    if (this.ws !== null) {
      this.ws.onopen = null
      this.ws.onclose = null
      this.ws.onmessage = null
      this.ws.onerror = null
      this.ws = null
    }
    if (this.retryTimeout !== null) {
      clearTimeout(this.retryTimeout)
      this.retryTimeout = null
    }
  }

  handleReceiveEvent(e: MessageEvent) {
    if (typeof e.data === 'string') {
      // json message
      const event = JSON.parse(e.data)
      if (event.type == "_DISCONNECT") {
        this.disconnect()
        this.toast?.loading(event.data, { duration: 10000000 })
        return
      }
      if (event.type in this.eventHandlers) {
        this.eventHandlers[event.type](event.data)
      }
      else {
        console.log(`unhandled event: ${event.type}`)
      }
    }
    else {
      // binary message
      if (this.binaryHandler !== null)
        this.binaryHandler(e.data)
      else
        console.log(`unhandled binary message`)
    }
  }
}