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
const SessionProvider = ({ url, label, toast, children, context, autoconnect, wsAuth }) => {
    const session = (0, react_1.useMemo)(() => new Session(url, label, toast), [url]);
    if (wsAuth) {
        const [userId, setUserId] = (0, usehooks_1.useLocalStorage)(`_USER_ID`, null);
        const [sessionId, setSessionId] = (0, usehooks_1.useSessionStorage)(`_SESSION_ID`, null);
        (0, react_1.useEffect)(() => {
            session === null || session === void 0 ? void 0 : session.registerEvent("_REQUEST_USER_SESSION", () => {
                let u = userId, s = sessionId;
                if (userId === null) {
                    u = (0, uuid_1.v4)();
                    setUserId(u);
                    console.log("generated new user id", u);
                }
                if (sessionId === null) {
                    s = (0, uuid_1.v4)();
                    setSessionId(s);
                    console.log("generated new session id", s);
                }
                session.send("_USER_SESSION", { user: u, session: s });
            });
            return () => {
                session === null || session === void 0 ? void 0 : session.deregisterEvent("_REQUEST_USER_SESSION");
            };
        }, [url]);
    }
    if (autoconnect)
        (0, react_1.useEffect)(() => {
            return session.connect();
        }, [url]);
    return ((0, jsx_runtime_1.jsx)(context.Provider, { value: session, children: children }));
};
exports.SessionProvider = SessionProvider;
class Session {
    constructor(url, label = "Server", toast = null, minRetryInterval = 250, maxRetryInterval = 10000) {
        this.ws = null;
        this.isConnected = false;
        this.onConnectionChange = undefined;
        this.eventHandlers = {};
        this.initHandlers = {};
        this.binaryHandler = null;
        this.binData = null; // metadata for the next binary message
        this.retryTimeout = null; // scheduled retry
        this.autoReconnect = true;
        this.url = url;
        this.label = label;
        this.minRetryInterval = minRetryInterval;
        this.maxRetryInterval = maxRetryInterval;
        this.retryInterval = minRetryInterval;
        this.toast = toast;
    }
    registerEvent(event, callback) {
        if (event in this.eventHandlers)
            throw new Error(`already subscribed to ${event}`);
        this.eventHandlers[event] = callback;
    }
    deregisterEvent(event) {
        if (!(event in this.eventHandlers))
            throw new Error(`not subscribed to ${event}`);
        delete this.eventHandlers[event];
    }
    registerInit(key, callback) {
        if (key in this.initHandlers)
            throw new Error(`already registered`);
        this.initHandlers[key] = callback;
    }
    deregisterInit(key) {
        if (!(key in this.initHandlers))
            throw new Error(`not registered`);
        delete this.initHandlers[key];
    }
    registerBinary(callback) {
        if (this.binaryHandler !== null)
            throw new Error(`already registered`);
        this.binaryHandler = callback;
    }
    deregisterBinary() {
        if (this.binaryHandler === null)
            throw new Error(`not registered`);
        this.binaryHandler = null;
    }
    send(event, data) {
        var _a, _b, _c;
        if (((_a = this.ws) === null || _a === void 0 ? void 0 : _a.readyState) !== WebSocket.OPEN) {
            (_b = this.toast) === null || _b === void 0 ? void 0 : _b.error(`${this.label}: Sending while not connected!`);
            return;
        }
        (_c = this.ws) === null || _c === void 0 ? void 0 : _c.send(JSON.stringify({
            type: event,
            data: data,
        }));
    }
    sendBinary(event, metadata, data) {
        var _a, _b, _c, _d;
        if (((_a = this.ws) === null || _a === void 0 ? void 0 : _a.readyState) !== WebSocket.OPEN) {
            (_b = this.toast) === null || _b === void 0 ? void 0 : _b.error(`${this.label}: Sending while not connected!`);
            return;
        }
        (_c = this.ws) === null || _c === void 0 ? void 0 : _c.send(JSON.stringify({
            type: "_BIN_META",
            data: {
                type: event,
                metadata: metadata,
            },
        }));
        (_d = this.ws) === null || _d === void 0 ? void 0 : _d.send(data);
    }
    connect() {
        var _a;
        (_a = this.toast) === null || _a === void 0 ? void 0 : _a.info(`Connecting to ${this.label}...`);
        this.ws = new WebSocket(this.url);
        this.autoReconnect = true;
        this.ws.onopen = () => {
            var _a;
            (_a = this.toast) === null || _a === void 0 ? void 0 : _a.success(`Connected to ${this.label}!`);
            this.isConnected = true;
            if (this.onConnectionChange)
                this.onConnectionChange(this.isConnected);
            this.retryInterval = this.minRetryInterval;
        };
        this.ws.onclose = () => {
            var _a, _b;
            this.isConnected = false;
            if (this.onConnectionChange)
                this.onConnectionChange(this.isConnected);
            if (this.autoReconnect) {
                (_a = this.toast) === null || _a === void 0 ? void 0 : _a.warning(`Disconnected from ${this.label}: Retrying in ${this.retryInterval / 1000} seconds...`);
                this.retryTimeout = setTimeout(() => {
                    // skip if we've already reconnected or deleted
                    if (this !== null && this.url && !this.isConnected) {
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
            console.error("Socket encountered error: ", err, "Closing socket");
            (_a = this.toast) === null || _a === void 0 ? void 0 : _a.error(`${this.label}: Socket Error: ${err}`);
            (_b = this.ws) === null || _b === void 0 ? void 0 : _b.close();
        };
        this.ws.onmessage = (e) => { this.handleReceiveEvent(e); };
        return () => {
            this.disconnect();
        };
    }
    disconnect() {
        var _a;
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
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        }
    }
    handleReceiveEvent(e) {
        var _a;
        if (typeof e.data === 'string') {
            // json message
            const event = JSON.parse(e.data);
            if (event.type == "_DISCONNECT") {
                this.disconnect();
                (_a = this.toast) === null || _a === void 0 ? void 0 : _a.loading(`${this.label}: ${event.data}`, { duration: 10000000 });
                return;
            }
            else if (event.type == "_DOWNLOAD") {
                // decode the base64 data and download it
                const { filename, data } = event.data;
                fetch(`data:application/octet-stream;base64,${data}`)
                    .then(res => res.blob())
                    .then(blob => (0, js_file_download_1.default)(blob, filename));
            }
            else if (event.type == "_BIN_META") {
                // the next message will be binary, save the metadata
                if (this.binData !== null)
                    console.log(`overwriting bytes metadata`);
                this.binData = event.data;
            }
            else if (event.type in this.eventHandlers) {
                this.eventHandlers[event.type](event.data);
            }
            else {
                console.log(`unhandled event: ${event.type}`);
            }
        }
        else {
            // binary message
            if (this.binData !== null) {
                if (this.binData.type in this.eventHandlers)
                    this.eventHandlers[this.binData.type](Object.assign({ data: e.data }, this.binData.metadata));
                else
                    console.log(`no handler for binary event: ${this.binData.type}`);
            }
            else if (this.binaryHandler !== null)
                this.binaryHandler(e.data);
            else
                console.log(`unhandled binary message`);
        }
    }
}
exports.Session = Session;
