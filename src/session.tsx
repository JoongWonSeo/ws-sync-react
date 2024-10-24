import { useLocalStorage, useSessionStorage } from "@uidotdev/usehooks";
import fileDownload from "js-file-download";
import { createContext, useMemo, useEffect, Context } from "react";
import { v4 as uuid } from "uuid";

export const DefaultSessionContext = createContext<Session | null>(null);

interface SessionProviderProps {
  url: string;
  label?: string;
  children: React.ReactNode;
  context?: Context<Session | null>;
  autoconnect?: boolean;
  wsAuth?: boolean;
  toast?: any;
}

export const SessionProvider = ({
  url,
  label,
  toast,
  children,
  context = DefaultSessionContext,
  autoconnect = false,
  wsAuth = false,
}: SessionProviderProps) => {
  const session = useMemo(() => new Session(url, label, toast), [url]);

  if (wsAuth) {
    const [userId, setUserId] = useLocalStorage<string | null>(
      `_USER_ID`,
      null
    );
    const [sessionId, setSessionId] = useSessionStorage<string | null>(
      `_SESSION_ID`,
      null
    );

    useEffect(() => {
      session?.registerEvent("_REQUEST_USER_SESSION", () => {
        let u = userId,
          s = sessionId;
        if (userId === null) {
          u = uuid();
          setUserId(u);
          console.log("generated new user id", u);
        }
        if (sessionId === null) {
          s = uuid();
          setSessionId(s);
          console.log("generated new session id", s);
        }
        session.send("_USER_SESSION", { user: u, session: s });
      });

      return () => {
        session?.deregisterEvent("_REQUEST_USER_SESSION");
      };
    }, [url]);
  }

  if (autoconnect)
    useEffect(() => {
      return session.connect();
    }, [url]);

  return <context.Provider value={session}>{children}</context.Provider>;
};

export class Session {
  url: string;
  label: string;
  ws: WebSocket | null = null;

  isConnected: boolean = false;
  onConnectionChange?: (arg0: boolean) => void = undefined;
  minRetryInterval: number;
  maxRetryInterval: number;
  retryInterval: number;
  toast: any;

  private eventHandlers: { [event: string]: (data: any) => void } = {};
  private initHandlers: { [key: string]: () => void } = {};
  private binaryHandler: ((data: any) => void) | null = null;
  private binData: any | null = null; // metadata for the next binary message
  private retryTimeout: ReturnType<typeof setTimeout> | null = null; // scheduled retry
  private autoReconnect: boolean = true;

  constructor(
    url: string,
    label: string = "Server",
    toast: any = null,
    minRetryInterval: number = 250,
    maxRetryInterval: number = 10000
  ) {
    this.url = url;
    this.label = label;
    this.minRetryInterval = minRetryInterval;
    this.maxRetryInterval = maxRetryInterval;
    this.retryInterval = minRetryInterval;
    this.toast = toast;
  }

  registerEvent(event: string, callback: (data: any) => void) {
    if (event in this.eventHandlers)
      throw new Error(`already subscribed to ${event}`);
    this.eventHandlers[event] = callback;
  }

  deregisterEvent(event: string) {
    if (!(event in this.eventHandlers))
      throw new Error(`not subscribed to ${event}`);
    delete this.eventHandlers[event];
  }

  registerInit(key: string, callback: () => void) {
    if (key in this.initHandlers) throw new Error(`already registered`);
    this.initHandlers[key] = callback;
  }

  deregisterInit(key: string) {
    if (!(key in this.initHandlers)) throw new Error(`not registered`);
    delete this.initHandlers[key];
  }

  registerBinary(callback: (data: any) => void) {
    if (this.binaryHandler !== null) throw new Error(`already registered`);
    this.binaryHandler = callback;
  }

  deregisterBinary() {
    if (this.binaryHandler === null) throw new Error(`not registered`);
    this.binaryHandler = null;
  }

  send(event: string, data: any) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.toast?.error(`${this.label}: Sending while not connected!`);
      return;
    }

    this.ws?.send(
      JSON.stringify({
        type: event,
        data: data,
      })
    );
  }

  sendBinary(event: string, metadata: any, data: ArrayBuffer) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.toast?.error(`${this.label}: Sending while not connected!`);
      return;
    }

    this.ws?.send(
      JSON.stringify({
        type: "_BIN_META",
        data: {
          type: event,
          metadata: metadata,
        },
      })
    );
    this.ws?.send(data);
  }

  connect() {
    this.toast?.info(`Connecting to ${this.label}...`);
    this.ws = new WebSocket(this.url);
    this.autoReconnect = true;

    this.ws.onopen = () => {
      this.toast?.success(`Connected to ${this.label}!`);
      this.isConnected = true;
      if (this.onConnectionChange) this.onConnectionChange(this.isConnected);
      this.retryInterval = this.minRetryInterval;
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      if (this.onConnectionChange) this.onConnectionChange(this.isConnected);
      if (this.autoReconnect) {
        this.toast?.warning(
          `Disconnected from ${this.label}: Retrying in ${
            this.retryInterval / 1000
          } seconds...`
        );
        this.retryTimeout = setTimeout(() => {
          // skip if we've already reconnected or deleted
          if (this !== null && this.url && !this.isConnected) {
            this.connect();
          }
        }, this.retryInterval);
        this.retryInterval = Math.min(
          this.retryInterval * 2,
          this.maxRetryInterval
        );
      } else {
        this.toast?.warning(`Disconnected from ${this.label}!`);
      }
    };

    this.ws.onerror = (err) => {
      console.error("Socket encountered error: ", err, "Closing socket");
      this.toast?.error(`${this.label}: Socket Error: ${err}`);
      this.ws?.close();
    };

    this.ws.onmessage = (e) => {
      this.handleReceiveEvent(e);
    };

    return () => {
      this.disconnect();
    };
  }

  disconnect() {
    this.autoReconnect = false;
    this.ws?.close();
    if (this.onConnectionChange) this.onConnectionChange(false);
    if (this.ws !== null) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws = null;
    }
    if (this.retryTimeout !== null) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  handleReceiveEvent(e: MessageEvent) {
    if (typeof e.data === "string") {
      // json message
      const event = JSON.parse(e.data);
      if (event.type == "_DISCONNECT") {
        this.disconnect();
        this.toast?.loading(`${this.label}: ${event.data}`, {
          duration: 10000000,
        });
        return;
      } else if (event.type == "_DOWNLOAD") {
        // decode the base64 data and download it
        const { filename, data } = event.data;
        fetch(`data:application/octet-stream;base64,${data}`)
          .then((res) => res.blob())
          .then((blob) => fileDownload(blob, filename));
      } else if (event.type == "_BIN_META") {
        // the next message will be binary, save the metadata
        if (this.binData !== null) console.log(`overwriting bytes metadata`);
        this.binData = event.data;
      } else if (event.type in this.eventHandlers) {
        this.eventHandlers[event.type](event.data);
      } else {
        console.log(`unhandled event: ${event.type}`);
      }
    } else {
      // binary message
      if (this.binData !== null) {
        if (this.binData.type in this.eventHandlers)
          this.eventHandlers[this.binData.type]({
            data: e.data,
            ...this.binData.metadata,
          });
        else console.log(`no handler for binary event: ${this.binData.type}`);
        // clear the metadata since we've handled it
        this.binData = null;
      } else if (this.binaryHandler !== null) this.binaryHandler(e.data);
      else console.log(`unhandled binary message`);
    }
  }
}
