Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let fast_json_patch = require("fast-json-patch");
let immer = require("immer");
let react = require("react");
let js_file_download = require("js-file-download");
js_file_download = __toESM(js_file_download);
let uuid = require("uuid");
let react_jsx_runtime = require("react/jsx-runtime");
require("zustand/middleware");
//#region src/utils/useStorage.ts
function useStorage(storageType, key, initialValue) {
	const storage = window[storageType];
	const readValue = (0, react.useCallback)(() => {
		if (typeof window === "undefined") return initialValue instanceof Function ? initialValue() : initialValue;
		try {
			const item = storage.getItem(key);
			if (item) return JSON.parse(item);
		} catch (error) {
			console.warn(`Error reading ${storageType} key “${key}”:`, error);
		}
		return initialValue instanceof Function ? initialValue() : initialValue;
	}, [
		key,
		initialValue,
		storageType,
		storage
	]);
	const [storedValue, setStoredValue] = (0, react.useState)(readValue);
	const setValue = (0, react.useCallback)((value) => {
		if (typeof window === "undefined") {
			console.warn(`Tried setting ${storageType} key “${key}” even though environment is not a client`);
			return;
		}
		try {
			const valueToStore = value instanceof Function ? value(storedValue) : value;
			setStoredValue(valueToStore);
			storage.setItem(key, JSON.stringify(valueToStore));
		} catch (error) {
			console.warn(`Error setting ${storageType} key “${key}”:`, error);
		}
	}, [
		key,
		storedValue,
		storageType,
		storage
	]);
	(0, react.useEffect)(() => {
		setStoredValue(readValue());
	}, []);
	(0, react.useEffect)(() => {
		if (typeof window === "undefined") return;
		const handleStorageChange = (event) => {
			if (event.storageArea === storage && event.key === key) try {
				setStoredValue(event.newValue ? JSON.parse(event.newValue) : initialValue);
			} catch (error) {
				console.warn(`Error parsing storage change for key “${key}”:`, error);
			}
		};
		window.addEventListener("storage", handleStorageChange);
		return () => {
			window.removeEventListener("storage", handleStorageChange);
		};
	}, [
		key,
		initialValue,
		storage,
		readValue
	]);
	return [storedValue, setValue];
}
function useLocalStorage(key, initialValue) {
	return useStorage("localStorage", key, initialValue);
}
function useSessionStorage(key, initialValue) {
	return useStorage("sessionStorage", key, initialValue);
}
//#endregion
//#region src/session.tsx
const DefaultSessionContext = (0, react.createContext)(null);
const SessionProvider = ({ url, label, toast, children, context = DefaultSessionContext, autoconnect = false, wsAuth = false, binaryType = "blob" }) => {
	const [session, setSession] = (0, react.useState)(null);
	(0, react.useEffect)(() => {
		console.info(`[WS Session] Creating new session for ${label || "Server"} at ${url}`);
		const newSession = new Session({
			url,
			label,
			toast,
			binaryType
		});
		setSession(newSession);
		return () => {
			console.info(`[WS Session] Disconnecting session for ${label || "Server"} at ${url}`);
			newSession.disconnect();
		};
	}, [url]);
	(0, react.useEffect)(() => {
		if (session) {
			console.info(`[WS Session] Updating label and/or toast reference for ${label || "Server"} at ${url}`);
			session.label = label || "Server";
			session.toast = toast;
		}
	}, [
		label,
		toast,
		session
	]);
	(0, react.useEffect)(() => {
		if (autoconnect && session) {
			console.info(`[WS Session] Autoconnecting session for ${label || "Server"} at ${url}`);
			const cleanup = session.connect();
			return () => {
				console.info(`[WS Session] Auto-disconnecting session for ${label || "Server"} at ${url}`);
				cleanup?.();
			};
		}
	}, [autoconnect, session]);
	if (wsAuth) {
		const [userId, setUserId] = useLocalStorage("_USER_ID", null);
		const [sessionId, setSessionId] = useSessionStorage("_SESSION_ID", null);
		(0, react.useEffect)(() => {
			if (!session) return;
			const handleRequestUserSession = () => {
				let u = userId;
				let s = sessionId;
				if (u === null) {
					u = (0, uuid.v4)();
					setUserId(u);
					console.info("[WS Session] Generated new user ID:", u);
				}
				if (s === null) {
					s = (0, uuid.v4)();
					setSessionId(s);
					console.info("[WS Session] Generated new session ID:", s);
				}
				session.send("_USER_SESSION", {
					user: u,
					session: s
				});
			};
			session.registerEvent("_REQUEST_USER_SESSION", handleRequestUserSession);
			return () => {
				session.deregisterEvent("_REQUEST_USER_SESSION");
			};
		}, [
			session,
			userId,
			sessionId
		]);
	}
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(context.Provider, {
		value: session,
		children
	});
};
var Session = class {
	constructor(options) {
		this.ws = null;
		this.isConnected = false;
		this.onConnectionChange = void 0;
		this.eventHandlers = {};
		this.initHandlers = {};
		this.binaryHandler = null;
		this.binData = null;
		this.retryTimeout = null;
		this.autoReconnect = true;
		this.defaultOverride = false;
		this.url = options.url;
		this.label = options.label ?? "Server";
		this.toast = options.toast ?? null;
		this.binaryType = options.binaryType ?? "blob";
		this.minRetryInterval = options.minRetryInterval ?? 250;
		this.maxRetryInterval = options.maxRetryInterval ?? 1e4;
		this.retryInterval = this.minRetryInterval;
		this.defaultOverride = options.override ?? false;
	}
	registerEvent(event, callback, override) {
		const shouldOverride = override ?? this.defaultOverride;
		if (event in this.eventHandlers && !shouldOverride) {
			console.error(`[WS Session] Attempted to registerEvent for ${event}, but handler already exists`);
			throw new Error(`already subscribed to ${event}`);
		}
		this.eventHandlers[event] = callback;
	}
	deregisterEvent(event) {
		if (!(event in this.eventHandlers)) {
			console.error(`[WS Session] Attempted to deregisterEvent for ${event}, but no handler was found`);
			throw new Error(`not subscribed to ${event}`);
		}
		delete this.eventHandlers[event];
	}
	registerInit(key, callback, override) {
		const shouldOverride = override ?? this.defaultOverride;
		if (key in this.initHandlers && !shouldOverride) {
			console.error(`[WS Session] Attempted to registerInit with key=${key}, but initHandler already exists`);
			throw new Error(`already registered`);
		}
		console.debug(`[WS Session] registeInit for key=${key}`);
		this.initHandlers[key] = callback;
	}
	deregisterInit(key) {
		if (!(key in this.initHandlers)) {
			console.error(`[WS Session] Attempted to deregisterInit for key=${key}, but it was not registered`);
			throw new Error(`not registered`);
		}
		delete this.initHandlers[key];
	}
	registerBinary(callback, override) {
		const shouldOverride = override ?? this.defaultOverride;
		if (this.binaryHandler !== null && !shouldOverride) {
			console.error(`[WS Session] Attempted to registerBinary, but a binary handler is already registered`);
			throw new Error(`already registered`);
		}
		this.binaryHandler = callback;
	}
	deregisterBinary() {
		if (this.binaryHandler === null) {
			console.error(`[WS Session] Attempted to deregisterBinary, but no binary handler was registered`);
			throw new Error(`not registered`);
		}
		this.binaryHandler = null;
	}
	send(event, data) {
		if (this.ws?.readyState !== WebSocket.OPEN) {
			console.warn(`[WS Session] Attempted to send event=${event} while socket not OPEN`);
			this.toast?.error(`${this.label}: Sending while not connected!`);
			return;
		}
		this.ws?.send(JSON.stringify({
			type: event,
			data
		}));
	}
	sendBinary(event, metadata, data) {
		if (this.ws?.readyState !== WebSocket.OPEN) {
			console.warn(`[WS Session] Attempted to sendBinary event=${event} while socket not OPEN`);
			this.toast?.error(`${this.label}: Sending while not connected!`);
			return;
		}
		this.ws?.send(JSON.stringify({
			type: "_BIN_META",
			data: {
				type: event,
				metadata
			}
		}));
		this.ws?.send(data);
	}
	connect() {
		this.toast?.info(`Connecting to ${this.label}...`);
		this.ws = new WebSocket(this.url);
		this.ws.binaryType = this.binaryType;
		this.autoReconnect = true;
		this.ws.onopen = () => {
			this.toast?.success(`Connected to ${this.label}!`);
			this.isConnected = true;
			this.onConnectionChange?.(this.isConnected);
			this.retryInterval = this.minRetryInterval;
		};
		this.ws.onclose = () => {
			this.isConnected = false;
			this.onConnectionChange?.(this.isConnected);
			if (this.autoReconnect) {
				this.toast?.warning(`Disconnected from ${this.label}: Retrying in ${this.retryInterval / 1e3} seconds...`);
				this.retryTimeout = setTimeout(() => {
					if (this !== null && this.url && !this.isConnected) this.connect();
				}, this.retryInterval);
				this.retryInterval = Math.min(this.retryInterval * 2, this.maxRetryInterval);
			} else this.toast?.warning(`Disconnected from ${this.label}!`);
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
		const wasConnected = this.isConnected;
		this.isConnected = false;
		if (wasConnected) this.onConnectionChange?.(this.isConnected);
		this.autoReconnect = false;
		if (this.ws !== null) {
			this.ws.onopen = null;
			this.ws.onclose = null;
			this.ws.onmessage = null;
			this.ws.onerror = null;
			this.ws.close();
			this.ws = null;
		}
		if (this.retryTimeout !== null) {
			clearTimeout(this.retryTimeout);
			this.retryTimeout = null;
		}
	}
	handleReceiveEvent(e) {
		if (typeof e.data === "string") {
			const event = JSON.parse(e.data);
			if (event.type === "_DISCONNECT") {
				console.info(`[WS Session] Received _DISCONNECT from server for ${this.label}`);
				this.disconnect();
				this.toast?.loading(`${this.label}: ${event.data}`, { duration: 1e7 });
				return;
			} else if (event.type === "_DOWNLOAD") {
				const { filename, data } = event.data;
				fetch(`data:application/octet-stream;base64,${data}`).then((res) => res.blob()).then((blob) => (0, js_file_download.default)(blob, filename));
			} else if (event.type === "_BIN_META") {
				if (this.binData !== null) console.warn("[WS Session] Overwriting existing binData metadata");
				this.binData = event.data;
			} else if (event.type in this.eventHandlers) this.eventHandlers[event.type](event.data);
			else console.warn(`[WS Session] No registered handler for event.type=${event.type}`);
		} else if (this.binData !== null) {
			const { type, metadata } = this.binData;
			if (type in this.eventHandlers) this.eventHandlers[type]({
				data: e.data,
				...metadata
			});
			else console.warn(`[WS Session] No handler for binary event: ${type}`);
			this.binData = null;
		} else if (this.binaryHandler !== null) this.binaryHandler(e.data);
		else console.warn("[WS Session] Unhandled binary message (no binData or binaryHandler)");
	}
};
//#endregion
//#region src/sync.ts
(0, immer.enablePatches)();
var Sync = class {
	get lastSyncTime() {
		return this._lastSyncTime;
	}
	constructor(key, session, sendOnInit = false) {
		this._patches = [];
		this._lastSyncTime = 0;
		this._actionHandlers = /* @__PURE__ */ new Map();
		this._debounceTimer = null;
		this._maxWaitTimer = null;
		this._firstPatchAt = null;
		this._baseSnapshot = null;
		this._isSyncedSubscribers = /* @__PURE__ */ new Set();
		this.compressThreshold = 5;
		this._subscribeIsSynced = (onStoreChange) => {
			this._isSyncedSubscribers.add(onStoreChange);
			return () => {
				this._isSyncedSubscribers.delete(onStoreChange);
			};
		};
		this.key = key;
		this.session = session;
		this.sendOnInit = sendOnInit;
	}
	sync(params) {
		const debounceMs = params?.debounceMs ?? 0;
		const maxWaitMs = params?.maxWaitMs ?? 0;
		if (debounceMs <= 0) {
			this.flush();
			return;
		}
		if (this._patches.length === 0) return;
		if (this._firstPatchAt === null) this._firstPatchAt = Date.now();
		if (this._debounceTimer) clearTimeout(this._debounceTimer);
		this._debounceTimer = setTimeout(() => this.flush(), debounceMs);
		if (maxWaitMs > 0 && this._maxWaitTimer === null && this._firstPatchAt) {
			const now = Date.now();
			const fireAt = this._firstPatchAt + maxWaitMs;
			const delay = Math.max(0, fireAt - now);
			this._maxWaitTimer = setTimeout(() => this.flush(), delay);
		}
	}
	flush() {
		this._clearTimers();
		if (this._patches.length > 0) {
			if (this.compressThreshold !== null && this._patches.length >= this.compressThreshold && this._baseSnapshot !== null) this._patches = this.compressImmerPatches(this._baseSnapshot, this._patches);
			this.session.send(patchEvent(this.key), convertImmerPatchesToJsonPatch(this._patches));
			this._lastSyncTime = Date.now();
			this._patches = [];
			this._emitIsSyncedChanged();
		}
		this._firstPatchAt = null;
		this._baseSnapshot = null;
	}
	_clearTimers() {
		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
			this._debounceTimer = null;
		}
		if (this._maxWaitTimer) {
			clearTimeout(this._maxWaitTimer);
			this._maxWaitTimer = null;
		}
	}
	_discardPendingPatches() {
		const hadPatches = this._patches.length > 0;
		this._clearTimers();
		if (hadPatches) {
			this._patches = [];
			this._emitIsSyncedChanged();
		}
		this._firstPatchAt = null;
		this._baseSnapshot = null;
	}
	appendPatch(patches, baseState) {
		const wasSynced = this._patches.length === 0;
		this._patches.push(...patches);
		if (this._firstPatchAt === null && patches.length > 0) {
			this._firstPatchAt = Date.now();
			if (baseState !== void 0 && typeof baseState === "object" && baseState !== null) this._baseSnapshot = baseState;
		}
		if (wasSynced !== (this._patches.length === 0)) this._emitIsSyncedChanged();
	}
	compressImmerPatches(baseState, patches) {
		let compressed = patches;
		(0, immer.produce)(baseState, (draft) => {
			(0, immer.applyPatches)(draft, patches);
		}, (p) => {
			compressed = p;
		});
		return compressed;
	}
	sendAction(action) {
		this.flush();
		this.session.send(actionEvent(this.key), action);
	}
	startTask(task) {
		this.flush();
		this.session.send(taskStartEvent(this.key), task);
	}
	cancelTask(task) {
		this.flush();
		this.session.send(taskCancelEvent(this.key), task);
	}
	sendBinary(action, data) {
		this.flush();
		this.session.sendBinary(actionEvent(this.key), action, data);
	}
	fetchRemoteState() {
		this._discardPendingPatches();
		this.session.send(getEvent(this.key), {});
	}
	sendState(state) {
		this._discardPendingPatches();
		this.session.send(setEvent(this.key), state);
	}
	registerHandlers(getState, setState, patchState, actionHandler) {
		this.session.registerEvent(getEvent(this.key), () => this.sendState(getState()));
		this.session.registerEvent(setEvent(this.key), (s) => setState(s));
		this.session.registerEvent(patchEvent(this.key), (p) => patchState(p));
		this.session.registerEvent(actionEvent(this.key), (a) => {
			const act = a;
			const handler = this._actionHandlers.get(act.type);
			if (handler) {
				const payload = Object.fromEntries(Object.entries(act).filter(([k]) => k !== "type"));
				try {
					handler(payload);
				} catch (err) {
					console.error(`[Sync] error invoking dynamic action handler for ${act.type}:`, err);
				}
			} else actionHandler(act);
		});
		if (this.sendOnInit) this.session.registerInit(this.key, () => this.sendState(getState()));
		return () => {
			this.session.deregisterEvent(getEvent(this.key));
			this.session.deregisterEvent(setEvent(this.key));
			this.session.deregisterEvent(patchEvent(this.key));
			this.session.deregisterEvent(actionEvent(this.key));
			if (this.sendOnInit) this.session.deregisterInit(this.key);
		};
	}
	registerExposedActions(handlers) {
		const registeredKeys = [];
		for (const [key, fn] of Object.entries(handlers)) {
			if (this._actionHandlers.has(key)) {
				console.error(`[Sync] Attempt to re-register action handler: ${key}`);
				throw new Error(`action handler already registered for ${key}`);
			}
			this._actionHandlers.set(key, ((payload) => fn(payload)));
			registeredKeys.push(key);
		}
		return () => {
			for (const key of registeredKeys) this._actionHandlers.delete(key);
		};
	}
	useExposedActions(handlers) {
		(0, react.useEffect)(() => this.registerExposedActions(handlers), [this, handlers]);
	}
	_emitIsSyncedChanged() {
		for (const cb of this._isSyncedSubscribers) try {
			cb();
		} catch (err) {
			console.error("[Sync] error in isSynced subscriber", err);
		}
	}
	useIsSynced() {
		return (0, react.useSyncExternalStore)(this._subscribeIsSynced, () => this._patches.length === 0, () => true);
	}
	createDelegators(nameToKey) {
		if (arguments.length === 0) return (ntk) => this.createDelegators(ntk);
		const entries = Object.entries(nameToKey);
		return Object.fromEntries(entries.map(([localName, remoteKey]) => {
			const fn = (args) => {
				if (args === null || args === void 0) this.sendAction({ type: String(remoteKey) });
				else this.sendAction({
					type: String(remoteKey),
					...args
				});
			};
			return [localName, fn];
		}));
	}
	createTaskDelegators(nameToKey) {
		if (arguments.length === 0) return (ntk) => this.createTaskDelegators(ntk);
		const entries = Object.entries(nameToKey);
		return Object.fromEntries(entries.map(([localName, remoteKey]) => {
			return [localName, {
				start: (args) => {
					if (args === null || args === void 0) this.startTask({ type: String(remoteKey) });
					else this.startTask({
						type: String(remoteKey),
						...args
					});
				},
				cancel: () => {
					this.cancelTask({ type: String(remoteKey) });
				}
			}];
		}));
	}
};
const setEvent = (key) => "_SET:" + key;
const getEvent = (key) => "_GET:" + key;
const patchEvent = (key) => "_PATCH:" + key;
const actionEvent = (key) => "_ACTION:" + key;
const taskStartEvent = (key) => "_TASK_START:" + key;
const taskCancelEvent = (key) => "_TASK_CANCEL:" + key;
const convertImmerPatchesToJsonPatch = (immerPatches) => {
	return immerPatches.map((p) => {
		let stringPath = p.path.join("/");
		if (!stringPath.startsWith("/")) stringPath = "/" + stringPath;
		return {
			...p,
			path: stringPath
		};
	});
};
const convertShallowUpdateToImmerPatch = (shallowUpdate) => {
	return Object.entries(shallowUpdate).map(([key, value]) => {
		return {
			op: "replace",
			path: [key],
			value
		};
	});
};
//#endregion
//#region src/react/synced-reducer.ts
(0, immer.enablePatches)();
function useSyncedReducer(key, syncedReducer, initialState, overrideSession = null, sendOnInit = false) {
	const session = overrideSession ?? (0, react.useContext)(DefaultSessionContext);
	if (!session) throw new Error("useSyncedReducer requires a Session from context or overrideSession");
	const syncObj = (0, react.useMemo)(() => new Sync(key, session, sendOnInit), [
		session,
		key,
		sendOnInit
	]);
	const sendAction = syncObj.sendAction.bind(syncObj);
	const startTask = syncObj.startTask.bind(syncObj);
	const cancelTask = syncObj.cancelTask.bind(syncObj);
	const sendBinary = syncObj.sendBinary.bind(syncObj);
	const wrappedReducer = ([state], action) => {
		switch (action.type) {
			case setEvent(key): return [action.data, []];
			case patchEvent(key): return [action.data.reduce(fast_json_patch.applyReducer, (0, fast_json_patch.deepClone)(state)), []];
			default: {
				if (!syncedReducer) return [state, []];
				const patchEffects = [];
				const plainEffects = [];
				const sync = () => {
					patchEffects.push((patches) => () => {
						syncObj.appendPatch(patches);
						syncObj.sync();
					});
				};
				const delegate = (actionOverride) => {
					plainEffects.push(() => {
						sendAction(actionOverride ?? action);
					});
				};
				const [newState, patches] = (0, immer.produceWithPatches)(syncedReducer)((0, immer.castImmutable)(state), action, sync, delegate);
				return [newState, [...plainEffects, ...patchEffects.map((f) => f(patches))]];
			}
		}
	};
	const [[state, effects], dispatch] = (0, react.useReducer)(wrappedReducer, [initialState, []]);
	(0, react.useEffect)(() => {
		if (effects.length === 0) return;
		effects.forEach((f) => f());
		effects.splice(0, effects.length);
	});
	const setState = (newState) => {
		dispatch({
			type: setEvent(key),
			data: newState
		});
	};
	const patchState = (patch) => {
		dispatch({
			type: patchEvent(key),
			data: patch
		});
	};
	const actionState = (action) => {
		dispatch(action);
	};
	const latestStateRef = (0, react.useRef)(state);
	latestStateRef.current = state;
	(0, react.useEffect)(() => {
		return syncObj.registerHandlers(() => latestStateRef.current, setState, patchState, actionState);
	}, [syncObj]);
	const setters = (0, react.useMemo)(() => {
		const result = {};
		Object.keys(initialState).forEach((attr) => {
			const attrStr = String(attr);
			const upper = attrStr.charAt(0).toUpperCase() + attrStr.slice(1);
			const setter = (newValue) => {
				patchState([{
					op: "replace",
					path: `/${attrStr}`,
					value: newValue
				}]);
			};
			const syncer = (newValue) => {
				patchState([{
					op: "replace",
					path: `/${attrStr}`,
					value: newValue
				}]);
				const immerPatches = convertShallowUpdateToImmerPatch({ [attrStr]: newValue });
				syncObj.appendPatch(immerPatches);
				syncObj.sync();
			};
			result[`set${upper}`] = setter;
			result[`sync${upper}`] = syncer;
		});
		return result;
	}, [
		initialState,
		patchState,
		key,
		session,
		syncObj
	]);
	return [(0, react.useMemo)(() => ({
		...state,
		...setters,
		fetchRemoteState: syncObj.fetchRemoteState.bind(syncObj),
		sendState: (s) => syncObj.sendState(s),
		sendAction,
		startTask,
		cancelTask,
		sendBinary
	}), [
		state,
		setters,
		syncObj,
		sendAction,
		startTask,
		cancelTask,
		sendBinary
	]), dispatch];
}
function useSynced(key, initialState, overrideSession = null, sendOnInit = false) {
	const [stateWithSync] = useSyncedReducer(key, void 0, initialState, overrideSession, sendOnInit);
	return stateWithSync;
}
function useObserved(key, initialState, overrideSession = null) {
	const [stateWithSync] = useSyncedReducer(key, void 0, initialState, overrideSession, false);
	return (0, react.useMemo)(() => {
		const result = {};
		Object.keys(initialState).forEach((k) => {
			result[k] = stateWithSync[k];
		});
		result.fetchRemoteState = stateWithSync.fetchRemoteState;
		return result;
	}, [stateWithSync, initialState]);
}
//#endregion
//#region src/remote-toast.ts
const useRemoteToast = (session, toast, prefix = "") => {
	(0, react.useEffect)(() => {
		session?.registerEvent("_TOAST", ({ message, type }) => {
			switch (type) {
				case "default":
					toast(prefix + message);
					break;
				case "message":
					toast.message(prefix + message);
					break;
				case "success":
					toast.success(prefix + message);
					break;
				case "info":
					toast.info(prefix + message);
					break;
				case "warning":
					toast.warning(prefix + message);
					break;
				case "error":
					toast.error(prefix + message);
					break;
				default: toast(prefix + message);
			}
		});
		return () => {
			session?.deregisterEvent("_TOAST");
		};
	}, [
		session,
		toast,
		prefix
	]);
};
//#endregion
//#region src/zustand/synced-store.ts
(0, immer.enablePatches)();
const syncedImpl = (stateCreator, syncOptions) => (set, get, store) => {
	const syncAttributes = Array.isArray(syncOptions.syncAttributes) ? new Set(syncOptions.syncAttributes) : syncOptions.syncAttributes !== void 0 ? new Set(Object.keys(syncOptions.syncAttributes)) : null;
	const extractSyncedSubset = (source) => {
		if (!syncAttributes) return source;
		const result = {};
		for (const key of syncAttributes) if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = source[key];
		return result;
	};
	const filterImmerPatches = (patches) => {
		if (!syncAttributes) return patches;
		return patches.filter((patch) => {
			const root = patch.path[0];
			if (typeof root === "string") return syncAttributes.has(root);
			return false;
		});
	};
	const newStore = store;
	const syncObj = new Sync(syncOptions.key, syncOptions.session, syncOptions.sendOnInit);
	store.setState = (updater, replace, ...args) => {
		if (typeof updater === "function") {
			const userFn = updater;
			const producer = (draft) => {
				const result = userFn(draft);
				if (result && typeof result === "object") Object.assign(draft, result);
			};
			const newStateCreator = (0, immer.produceWithPatches)(producer);
			const current = get();
			const [newState, patches] = newStateCreator(current);
			const filteredPatches = filterImmerPatches(patches);
			syncObj.appendPatch(filteredPatches, current);
			return set(newState, replace, ...args);
		} else {
			const newState = updater;
			const shallowUpdate = extractSyncedSubset(newState ?? {});
			syncObj.appendPatch(convertShallowUpdateToImmerPatch(shallowUpdate), get());
			return set(newState, replace, ...args);
		}
	};
	const cleanup = syncObj.registerHandlers(() => extractSyncedSubset(get()), (s) => {
		set(extractSyncedSubset(s));
	}, (patches) => {
		const current = extractSyncedSubset(get());
		set(patches.reduce(fast_json_patch.applyReducer, (0, fast_json_patch.deepClone)(current)));
	}, (action) => {
		const handler = get()[action.type];
		if (typeof handler === "function") {
			const payload = { ...action };
			delete payload.type;
			try {
				handler(payload);
			} catch (err) {
				console.error(`[zustand synced] error invoking action handler for ${action.type}:`, err);
			}
		}
	});
	const callableSync = syncObj.sync.bind(syncObj);
	callableSync.obj = syncObj;
	callableSync.cleanup = cleanup;
	callableSync.createDelegators = syncObj.createDelegators.bind(syncObj);
	callableSync.createTaskDelegators = syncObj.createTaskDelegators.bind(syncObj);
	callableSync.sendAction = syncObj.sendAction.bind(syncObj);
	callableSync.startTask = syncObj.startTask.bind(syncObj);
	callableSync.cancelTask = syncObj.cancelTask.bind(syncObj);
	callableSync.sendBinary = syncObj.sendBinary.bind(syncObj);
	callableSync.fetchRemoteState = syncObj.fetchRemoteState.bind(syncObj);
	callableSync.sendState = ((state) => {
		const subset = extractSyncedSubset(state);
		syncObj.sendState(subset);
	});
	callableSync.registerExposedActions = syncObj.registerExposedActions.bind(syncObj);
	callableSync.useExposedActions = syncObj.useExposedActions.bind(syncObj);
	callableSync.useIsSynced = syncObj.useIsSynced.bind(syncObj);
	newStore.sync = callableSync;
	return stateCreator(store.setState, get, newStore);
};
const synced = syncedImpl;
//#endregion
exports.DefaultSessionContext = DefaultSessionContext;
exports.Session = Session;
exports.SessionProvider = SessionProvider;
exports.synced = synced;
exports.useObserved = useObserved;
exports.useRemoteToast = useRemoteToast;
exports.useSynced = useSynced;
exports.useSyncedReducer = useSyncedReducer;

//# sourceMappingURL=index.cjs.map