import { useLocalStorage, useSessionStorage } from "@uidotdev/usehooks";
import fileDownload from "js-file-download";
import {
  createContext,
  useMemo,
  useEffect,
  Context,
  useRef,
  useState,
} from "react";
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
  binaryType?: BinaryType;
}

export const SessionProvider = ({
  url,
  label,
  toast,
  children,
  context = DefaultSessionContext,
  autoconnect = false,
  wsAuth = false,
  binaryType = "blob",
}: SessionProviderProps) => {
  // Initialize session
  const [session, setSession] = useState<Session | null>(null);

  // When the URL changes, create a new session and update state
  useEffect(() => {
    console.info(
      `[WS Session] Creating new session for ${label || "Server"} at ${url}`
    );
    const newSession = new Session(url, label, toast, binaryType);
    setSession(newSession);

    return () => {
      console.info(
        `[WS Session] Disconnecting session for ${label || "Server"} at ${url}`
      );
      newSession.disconnect();
    };
  }, [url]);

  // When label or toast changes, update the session
  useEffect(() => {
    if (session) {
      console.info(
        `[WS Session] Updating label and/or toast reference for ${
          label || "Server"
        } at ${url}`
      );
      session.label = label || "Server";
      session.toast = toast;
    }
  }, [label, toast, session]);

  // Autoconnect on mount
  useEffect(() => {
    if (autoconnect && session) {
      console.info(
        `[WS Session] Autoconnecting session for ${label || "Server"} at ${url}`
      );
      const cleanup = session.connect(); // connect the session
      return () => {
        console.info(
          `[WS Session] Auto-disconnecting session for ${
            label || "Server"
          } at ${url}`
        );
        cleanup?.();
      };
    }
  }, [autoconnect, session]);

  // Handle wsAuth functionality
  if (wsAuth) {
    const [userId, setUserId] = useLocalStorage<string | null>(
      "_USER_ID",
      null
    );
    const [sessionId, setSessionId] = useSessionStorage<string | null>(
      "_SESSION_ID",
      null
    );

    useEffect(() => {
      if (!session) return;

      const handleRequestUserSession = () => {
        // console.debug(`[WS Session] Handling _REQUEST_USER_SESSION event`);
        let u = userId;
        let s = sessionId;

        if (u === null) {
          u = uuid();
          setUserId(u);
          console.info("[WS Session] Generated new user ID:", u);
        }
        if (s === null) {
          s = uuid();
          setSessionId(s);
          console.info("[WS Session] Generated new session ID:", s);
        }

        // console.debug("[WS Session] Sending _USER_SESSION event with IDs");
        session.send("_USER_SESSION", { user: u, session: s });
      };

      session.registerEvent("_REQUEST_USER_SESSION", handleRequestUserSession);

      return () => {
        session.deregisterEvent("_REQUEST_USER_SESSION");
      };
    }, [session, userId, sessionId]);
  }

  return <context.Provider value={session}>{children}</context.Provider>;
};

export class Session {
  url: string;
  label: string;
  ws: WebSocket | null = null;
  binaryType: BinaryType;

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
    binaryType: BinaryType = "blob",
    minRetryInterval: number = 250,
    maxRetryInterval: number = 10000
  ) {
    this.url = url;
    this.label = label;
    this.toast = toast;
    this.binaryType = binaryType;
    this.minRetryInterval = minRetryInterval;
    this.maxRetryInterval = maxRetryInterval;
    this.retryInterval = minRetryInterval;
  }

  registerEvent(event: string, callback: (data: any) => void) {
    if (event in this.eventHandlers) {
      console.error(
        `[WS Session] Attempted to registerEvent for ${event}, but handler already exists`
      );
      throw new Error(`already subscribed to ${event}`);
    }
    this.eventHandlers[event] = callback;
  }

  deregisterEvent(event: string) {
    if (!(event in this.eventHandlers)) {
      console.error(
        `[WS Session] Attempted to deregisterEvent for ${event}, but no handler was found`
      );
      throw new Error(`not subscribed to ${event}`);
    }
    delete this.eventHandlers[event];
  }

  registerInit(key: string, callback: () => void) {
    if (key in this.initHandlers) {
      console.error(
        `[WS Session] Attempted to registerInit with key=${key}, but initHandler already exists`
      );
      throw new Error(`already registered`);
    }
    console.debug(`[WS Session] registeInit for key=${key}`);
    this.initHandlers[key] = callback;
  }

  deregisterInit(key: string) {
    if (!(key in this.initHandlers)) {
      console.error(
        `[WS Session] Attempted to deregisterInit for key=${key}, but it was not registered`
      );
      throw new Error(`not registered`);
    }
    delete this.initHandlers[key];
  }

  registerBinary(callback: (data: any) => void) {
    if (this.binaryHandler !== null) {
      console.error(
        `[WS Session] Attempted to registerBinary, but a binary handler is already registered`
      );
      throw new Error(`already registered`);
    }
    this.binaryHandler = callback;
  }

  deregisterBinary() {
    if (this.binaryHandler === null) {
      console.error(
        `[WS Session] Attempted to deregisterBinary, but no binary handler was registered`
      );
      throw new Error(`not registered`);
    }
    this.binaryHandler = null;
  }

  send(event: string, data: any) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.warn(
        `[WS Session] Attempted to send event=${event} while socket not OPEN`
      );
      this.toast?.error(`${this.label}: Sending while not connected!`);
      return;
    }

    // console.info(
    //   `[WS Session] Sending event=${event} to ${this.label} with data:`,
    //   data
    // );
    this.ws?.send(
      JSON.stringify({
        type: event,
        data: data,
      })
    );
  }

  sendBinary(event: string, metadata: any, data: ArrayBuffer) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.warn(
        `[WS Session] Attempted to sendBinary event=${event} while socket not OPEN`
      );
      this.toast?.error(`${this.label}: Sending while not connected!`);
      return;
    }

    // console.info(
    //   `[WS Session] Sending binary event=${event} to ${this.label}, metadata=`,
    //   metadata
    // );
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
    // console.info(`[WS Session] Connecting to ${this.label} at ${this.url}`);
    this.toast?.info(`Connecting to ${this.label}...`);

    this.ws = new WebSocket(this.url);
    this.ws.binaryType = this.binaryType;
    this.autoReconnect = true;

    this.ws.onopen = () => {
      // console.info(`[WS Session] onopen - Connected to ${this.label}!`);
      this.toast?.success(`Connected to ${this.label}!`);
      this.isConnected = true;
      if (this.onConnectionChange) this.onConnectionChange(this.isConnected);
      this.retryInterval = this.minRetryInterval;
    };

    this.ws.onclose = () => {
      // console.warn(`[WS Session] onclose - Disconnected from ${this.label}`);
      this.isConnected = false;
      if (this.onConnectionChange) this.onConnectionChange(this.isConnected);

      if (this.autoReconnect) {
        this.toast?.warning(
          `Disconnected from ${this.label}: Retrying in ${
            this.retryInterval / 1000
          } seconds...`
        );

        // console.debug(
        //   `[WS Session] Scheduling reconnect in ${this.retryInterval}ms`
        // );

        this.retryTimeout = setTimeout(() => {
          // skip if we've already reconnected or if the session is disposed
          if (this !== null && this.url && !this.isConnected) {
            // console.debug(`[WS Session] Reconnect attempt for ${this.label}`);
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
      console.error("[WS Session] onerror - Socket encountered error:", err);
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
    // console.info(`[WS Session] Disconnecting from ${this.label}`);
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
      const event = JSON.parse(e.data);

      if (event.type === "_DISCONNECT") {
        console.info(
          `[WS Session] Received _DISCONNECT from server for ${this.label}`
        );
        this.disconnect();
        this.toast?.loading(`${this.label}: ${event.data}`, {
          duration: 10000000,
        });
        return;
      } else if (event.type === "_DOWNLOAD") {
        const { filename, data } = event.data;
        fetch(`data:application/octet-stream;base64,${data}`)
          .then((res) => res.blob())
          .then((blob) => fileDownload(blob, filename));
      } else if (event.type === "_BIN_META") {
        // the next message will be binary, save the metadata
        if (this.binData !== null) {
          console.warn("[WS Session] Overwriting existing binData metadata");
        }
        this.binData = event.data;
      } else if (event.type in this.eventHandlers) {
        this.eventHandlers[event.type](event.data);
      } else {
        console.warn(
          `[WS Session] No registered handler for event.type=${event.type}`
        );
      }
    } else {
      if (this.binData !== null) {
        const { type, metadata } = this.binData;

        if (type in this.eventHandlers) {
          this.eventHandlers[type]({
            data: e.data,
            ...metadata,
          });
        } else {
          console.warn(`[WS Session] No handler for binary event: ${type}`);
        }

        // clear the metadata since we've handled it
        this.binData = null;
      } else if (this.binaryHandler !== null) {
        this.binaryHandler(e.data);
      } else {
        console.warn(
          "[WS Session] Unhandled binary message (no binData or binaryHandler)"
        );
      }
    }
  }
}
