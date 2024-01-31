"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Session = exports.SessionProvider = exports.DefaultSessionContext = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const usehooks_1 = require("@uidotdev/usehooks");
const react_1 = require("react");
const sonner_1 = require("sonner");
const uuid_1 = require("uuid");
exports.DefaultSessionContext = (0, react_1.createContext)(null);
const SessionProvider = ({ url, children, context, autoconnect, wsAuth }) => {
    const session = (0, react_1.useMemo)(() => new Session(url), [url]);
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
    constructor(url, minRetryInterval = 250, maxRetryInterval = 10000) {
        this.ws = null;
        this.isConnected = false;
        this.onConnectionChange = undefined;
        this.eventHandlers = {};
        this.initHandlers = {};
        this.binaryHandler = null;
        this.retryTimeout = null; // scheduled retry
        this.autoReconnect = true;
        this.url = url;
        this.minRetryInterval = minRetryInterval;
        this.maxRetryInterval = maxRetryInterval;
        this.retryInterval = minRetryInterval;
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
        var _a, _b;
        if (((_a = this.ws) === null || _a === void 0 ? void 0 : _a.readyState) !== WebSocket.OPEN) {
            sonner_1.toast.error(`Sending while not connected!`);
            return;
        }
        (_b = this.ws) === null || _b === void 0 ? void 0 : _b.send(JSON.stringify({
            type: event,
            data: data,
        }));
    }
    connect() {
        console.log('connecting to ', this.url);
        sonner_1.toast.info('Connecting to server...');
        this.ws = new WebSocket(this.url);
        this.autoReconnect = true;
        this.ws.onopen = () => {
            console.log('connected');
            sonner_1.toast.success('Connected to server!');
            this.isConnected = true;
            if (this.onConnectionChange)
                this.onConnectionChange(this.isConnected);
            this.retryInterval = this.minRetryInterval;
        };
        this.ws.onclose = () => {
            console.log('disconnected');
            this.isConnected = false;
            if (this.onConnectionChange)
                this.onConnectionChange(this.isConnected);
            if (this.autoReconnect) {
                sonner_1.toast.warning(`Disconnected from server: Retrying in ${this.retryInterval / 1000} seconds...`);
                this.retryTimeout = setTimeout(() => {
                    // skip if we've already reconnected or deleted
                    if (this !== null && this.url && !this.isConnected) {
                        console.log('reconnecting');
                        this.connect();
                    }
                }, this.retryInterval);
                this.retryInterval = Math.min(this.retryInterval * 2, this.maxRetryInterval);
            }
            else {
                sonner_1.toast.warning('Disconnected from server!');
            }
        };
        this.ws.onerror = (err) => {
            var _a;
            console.error("Socket encountered error: ", err, "Closing socket");
            sonner_1.toast.error(`Socket Error: ${err}`);
            (_a = this.ws) === null || _a === void 0 ? void 0 : _a.close();
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
        if (typeof e.data === 'string') {
            // json message
            const event = JSON.parse(e.data);
            if (event.type == "_DISCONNECT") {
                this.disconnect();
                sonner_1.toast.loading(event.data, { duration: 10000000 });
                return;
            }
            if (event.type in this.eventHandlers) {
                this.eventHandlers[event.type](event.data);
            }
            else {
                console.log(`unhandled event: ${event.type}`);
            }
        }
        else {
            // binary message
            if (this.binaryHandler !== null)
                this.binaryHandler(e.data);
            else
                console.log(`unhandled binary message`);
        }
    }
}
exports.Session = Session;
