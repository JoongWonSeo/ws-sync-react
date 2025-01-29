"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Session = exports.SessionProvider = exports.DefaultSessionContext = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const usehooks_1 = require("@uidotdev/usehooks");
const js_file_download_1 = __importDefault(require("js-file-download"));
const react_1 = require("react");
const uuid_1 = require("uuid");
exports.DefaultSessionContext = (0, react_1.createContext)(null);
const SessionProvider = ({ url, label, toast, children, context = exports.DefaultSessionContext, autoconnect = false, wsAuth = false, binaryType = "blob", }) => {
    // Initialize session
    const [session, setSession] = (0, react_1.useState)(null);
    // When the URL changes, create a new session and update state
    (0, react_1.useEffect)(() => {
        console.info(`[WS Session] Creating new session for ${label || "Server"} at ${url}`);
        const newSession = new Session(url, label, toast, binaryType);
        setSession(newSession);
        return () => {
            console.info(`[WS Session] Disconnecting session for ${label || "Server"} at ${url}`);
            newSession.disconnect();
        };
    }, [url]);
    // When label or toast changes, update the session
    (0, react_1.useEffect)(() => {
        if (session) {
            console.info(`[WS Session] Updating label and/or toast reference for ${label || "Server"} at ${url}`);
            session.label = label || "Server";
            session.toast = toast;
        }
    }, [label, toast, session]);
    // Autoconnect on mount
    (0, react_1.useEffect)(() => {
        if (autoconnect && session) {
            console.info(`[WS Session] Autoconnecting session for ${label || "Server"} at ${url}`);
            const cleanup = session.connect(); // connect the session
            return () => {
                console.info(`[WS Session] Auto-disconnecting session for ${label || "Server"} at ${url}`);
                cleanup === null || cleanup === void 0 ? void 0 : cleanup();
            };
        }
    }, [autoconnect, session]);
    // Handle wsAuth functionality
    if (wsAuth) {
        const [userId, setUserId] = (0, usehooks_1.useLocalStorage)("_USER_ID", null);
        const [sessionId, setSessionId] = (0, usehooks_1.useSessionStorage)("_SESSION_ID", null);
        (0, react_1.useEffect)(() => {
            if (!session)
                return;
            const handleRequestUserSession = () => {
                console.debug(`[WS Session] Handling _REQUEST_USER_SESSION event`);
                let u = userId;
                let s = sessionId;
                if (u === null) {
                    u = (0, uuid_1.v4)();
                    setUserId(u);
                    console.info("[WS Session] Generated new user ID:", u);
                }
                if (s === null) {
                    s = (0, uuid_1.v4)();
                    setSessionId(s);
                    console.info("[WS Session] Generated new session ID:", s);
                }
                console.debug("[WS Session] Sending _USER_SESSION event with IDs");
                session.send("_USER_SESSION", { user: u, session: s });
            };
            console.debug(`[WS Session] Registering _REQUEST_USER_SESSION event handler for ${session.label}`);
            session.registerEvent("_REQUEST_USER_SESSION", handleRequestUserSession);
            return () => {
                console.debug(`[WS Session] Deregistering _REQUEST_USER_SESSION event handler for ${session.label}`);
                session.deregisterEvent("_REQUEST_USER_SESSION");
            };
        }, [session, userId, sessionId]);
    }
    return (0, jsx_runtime_1.jsx)(context.Provider, { value: session, children: children });
};
exports.SessionProvider = SessionProvider;
class Session {
    constructor(url, label = "Server", toast = null, binaryType = "blob", minRetryInterval = 250, maxRetryInterval = 10000) {
        this.ws = null;
        this.isConnected = false;
        this.onConnectionChange = undefined;
        this.eventHandlers = {};
        this.initHandlers = {};
        this.binaryHandler = null;
        this.binData = null; // metadata for the next binary message
        this.retryTimeout = null; // scheduled retry
        this.autoReconnect = true;
        console.debug(`[WS Session] Constructor called with url=${url}, label=${label}, minRetryInterval=${minRetryInterval}, maxRetryInterval=${maxRetryInterval}`);
        this.url = url;
        this.label = label;
        this.toast = toast;
        this.binaryType = binaryType;
        this.minRetryInterval = minRetryInterval;
        this.maxRetryInterval = maxRetryInterval;
        this.retryInterval = minRetryInterval;
        console.debug("[WS Session] Session object created");
    }
    registerEvent(event, callback) {
        if (event in this.eventHandlers) {
            console.error(`[WS Session] Attempted to registerEvent for ${event}, but handler already exists`);
            throw new Error(`already subscribed to ${event}`);
        }
        console.debug(`[WS Session] registerEvent for ${event}`);
        this.eventHandlers[event] = callback;
    }
    deregisterEvent(event) {
        if (!(event in this.eventHandlers)) {
            console.error(`[WS Session] Attempted to deregisterEvent for ${event}, but no handler was found`);
            throw new Error(`not subscribed to ${event}`);
        }
        console.debug(`[WS Session] deregisterEvent for ${event}`);
        delete this.eventHandlers[event];
    }
    registerInit(key, callback) {
        if (key in this.initHandlers) {
            console.error(`[WS Session] Attempted to registerInit with key=${key}, but initHandler already exists`);
            throw new Error(`already registered`);
        }
        console.debug(`[WS Session] registerInit for key=${key}`);
        this.initHandlers[key] = callback;
    }
    deregisterInit(key) {
        if (!(key in this.initHandlers)) {
            console.error(`[WS Session] Attempted to deregisterInit for key=${key}, but it was not registered`);
            throw new Error(`not registered`);
        }
        console.debug(`[WS Session] deregisterInit for key=${key}`);
        delete this.initHandlers[key];
    }
    registerBinary(callback) {
        if (this.binaryHandler !== null) {
            console.error(`[WS Session] Attempted to registerBinary, but a binary handler is already registered`);
            throw new Error(`already registered`);
        }
        console.debug("[WS Session] registerBinary handler");
        this.binaryHandler = callback;
    }
    deregisterBinary() {
        if (this.binaryHandler === null) {
            console.error(`[WS Session] Attempted to deregisterBinary, but no binary handler was registered`);
            throw new Error(`not registered`);
        }
        console.debug("[WS Session] deregisterBinary handler");
        this.binaryHandler = null;
    }
    send(event, data) {
        var _a, _b, _c;
        console.debug(`[WS Session] send called for event=${event}`);
        if (((_a = this.ws) === null || _a === void 0 ? void 0 : _a.readyState) !== WebSocket.OPEN) {
            console.warn(`[WS Session] Attempted to send event=${event} while socket not OPEN`);
            (_b = this.toast) === null || _b === void 0 ? void 0 : _b.error(`${this.label}: Sending while not connected!`);
            return;
        }
        console.info(`[WS Session] Sending event=${event} to ${this.label} with data:`, data);
        (_c = this.ws) === null || _c === void 0 ? void 0 : _c.send(JSON.stringify({
            type: event,
            data: data,
        }));
    }
    sendBinary(event, metadata, data) {
        var _a, _b, _c, _d;
        console.debug(`[WS Session] sendBinary called for event=${event}, metadata=`, metadata);
        if (((_a = this.ws) === null || _a === void 0 ? void 0 : _a.readyState) !== WebSocket.OPEN) {
            console.warn(`[WS Session] Attempted to sendBinary event=${event} while socket not OPEN`);
            (_b = this.toast) === null || _b === void 0 ? void 0 : _b.error(`${this.label}: Sending while not connected!`);
            return;
        }
        console.info(`[WS Session] Sending binary event=${event} to ${this.label}, metadata=`, metadata);
        (_c = this.ws) === null || _c === void 0 ? void 0 : _c.send(JSON.stringify({
            type: "_BIN_META",
            data: {
                type: event,
                metadata: metadata,
            },
        }));
        console.debug(`[WS Session] Sending raw binary data for event=${event}`);
        (_d = this.ws) === null || _d === void 0 ? void 0 : _d.send(data);
    }
    connect() {
        var _a;
        console.info(`[WS Session] Connecting to ${this.label} at ${this.url}`);
        (_a = this.toast) === null || _a === void 0 ? void 0 : _a.info(`Connecting to ${this.label}...`);
        this.ws = new WebSocket(this.url);
        this.ws.binaryType = this.binaryType;
        this.autoReconnect = true;
        this.ws.onopen = () => {
            var _a;
            console.info(`[WS Session] onopen - Connected to ${this.label}!`);
            (_a = this.toast) === null || _a === void 0 ? void 0 : _a.success(`Connected to ${this.label}!`);
            this.isConnected = true;
            if (this.onConnectionChange)
                this.onConnectionChange(this.isConnected);
            this.retryInterval = this.minRetryInterval;
        };
        this.ws.onclose = () => {
            var _a, _b;
            console.warn(`[WS Session] onclose - Disconnected from ${this.label}`);
            this.isConnected = false;
            if (this.onConnectionChange)
                this.onConnectionChange(this.isConnected);
            if (this.autoReconnect) {
                (_a = this.toast) === null || _a === void 0 ? void 0 : _a.warning(`Disconnected from ${this.label}: Retrying in ${this.retryInterval / 1000} seconds...`);
                console.debug(`[WS Session] Scheduling reconnect in ${this.retryInterval}ms`);
                this.retryTimeout = setTimeout(() => {
                    // skip if we've already reconnected or if the session is disposed
                    if (this !== null && this.url && !this.isConnected) {
                        console.debug(`[WS Session] Reconnect attempt for ${this.label}`);
                        this.connect();
                    }
                }, this.retryInterval);
                this.retryInterval = Math.min(this.retryInterval * 2, this.maxRetryInterval);
            }
            else {
                (_b = this.toast) === null || _b === void 0 ? void 0 : _b.warning(`Disconnected from ${this.label}!`);
            }
        };
        this.ws.onerror = (err) => {
            var _a, _b;
            console.error("[WS Session] onerror - Socket encountered error:", err);
            (_a = this.toast) === null || _a === void 0 ? void 0 : _a.error(`${this.label}: Socket Error: ${err}`);
            (_b = this.ws) === null || _b === void 0 ? void 0 : _b.close();
        };
        this.ws.onmessage = (e) => {
            console.debug("[WS Session] onmessage - Received message");
            this.handleReceiveEvent(e);
        };
        return () => {
            console.debug(`[WS Session] Disconnect cleanup for ${this.label}`);
            this.disconnect();
        };
    }
    disconnect() {
        var _a;
        console.info(`[WS Session] Disconnecting from ${this.label}`);
        this.autoReconnect = false;
        (_a = this.ws) === null || _a === void 0 ? void 0 : _a.close();
        if (this.onConnectionChange)
            this.onConnectionChange(false);
        if (this.ws !== null) {
            this.ws.onopen = null;
            this.ws.onclose = null;
            this.ws.onmessage = null;
            this.ws.onerror = null;
            this.ws = null;
        }
        if (this.retryTimeout !== null) {
            console.debug(`[WS Session] Clearing retryTimeout for ${this.label} on disconnect`);
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        }
    }
    handleReceiveEvent(e) {
        var _a;
        console.debug("[WS Session] handleReceiveEvent triggered");
        if (typeof e.data === "string") {
            console.debug("[WS Session] Received string data, attempting to parse");
            const event = JSON.parse(e.data);
            if (event.type === "_DISCONNECT") {
                console.info(`[WS Session] Received _DISCONNECT from server for ${this.label}`);
                this.disconnect();
                (_a = this.toast) === null || _a === void 0 ? void 0 : _a.loading(`${this.label}: ${event.data}`, {
                    duration: 10000000,
                });
                return;
            }
            else if (event.type === "_DOWNLOAD") {
                console.info(`[WS Session] Received _DOWNLOAD request from server for ${this.label}`);
                const { filename, data } = event.data;
                fetch(`data:application/octet-stream;base64,${data}`)
                    .then((res) => res.blob())
                    .then((blob) => (0, js_file_download_1.default)(blob, filename));
            }
            else if (event.type === "_BIN_META") {
                console.debug("[WS Session] Received _BIN_META for upcoming binary data");
                // the next message will be binary, save the metadata
                if (this.binData !== null) {
                    console.warn("[WS Session] Overwriting existing binData metadata");
                }
                this.binData = event.data;
            }
            else if (event.type in this.eventHandlers) {
                console.debug(`[WS Session] Found handler for event.type=${event.type}, invoking...`);
                this.eventHandlers[event.type](event.data);
            }
            else {
                console.warn(`[WS Session] No registered handler for event.type=${event.type}`);
            }
        }
        else {
            console.debug("[WS Session] Received binary data");
            if (this.binData !== null) {
                const { type, metadata } = this.binData;
                console.debug(`[WS Session] Handling binary data for event type=${type} with metadata=`, metadata);
                if (type in this.eventHandlers) {
                    this.eventHandlers[type](Object.assign({ data: e.data }, metadata));
                }
                else {
                    console.warn(`[WS Session] No handler for binary event: ${type}`);
                }
                // clear the metadata since we've handled it
                this.binData = null;
            }
            else if (this.binaryHandler !== null) {
                console.debug("[WS Session] Invoking binaryHandler with untagged binary data");
                this.binaryHandler(e.data);
            }
            else {
                console.warn("[WS Session] Unhandled binary message (no binData or binaryHandler)");
            }
        }
    }
}
exports.Session = Session;
