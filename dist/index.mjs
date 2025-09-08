// src/react/synced-reducer.ts
import { applyReducer, deepClone } from "fast-json-patch";
import {
  castImmutable,
  enablePatches as enablePatches2,
  produceWithPatches
} from "immer";
import { useContext, useEffect as useEffect4, useMemo, useReducer, useRef } from "react";

// src/session.tsx
import fileDownload from "js-file-download";
import { createContext, useEffect as useEffect2, useState as useState2 } from "react";
import { v4 as uuid } from "uuid";

// src/utils/useStorage.ts
import { useState, useEffect, useCallback } from "react";
function useStorage(storageType, key, initialValue) {
  const storage = window[storageType];
  const readValue = useCallback(() => {
    if (typeof window === "undefined") {
      return initialValue instanceof Function ? initialValue() : initialValue;
    }
    try {
      const item = storage.getItem(key);
      if (item) {
        return JSON.parse(item);
      }
    } catch (error) {
      console.warn(`Error reading ${storageType} key \u201C${key}\u201D:`, error);
    }
    return initialValue instanceof Function ? initialValue() : initialValue;
  }, [key, initialValue, storageType, storage]);
  const [storedValue, setStoredValue] = useState(readValue);
  const setValue = useCallback(
    (value) => {
      if (typeof window === "undefined") {
        console.warn(
          `Tried setting ${storageType} key \u201C${key}\u201D even though environment is not a client`
        );
        return;
      }
      try {
        const valueToStore = value instanceof Function ? value(storedValue) : value;
        setStoredValue(valueToStore);
        storage.setItem(key, JSON.stringify(valueToStore));
      } catch (error) {
        console.warn(`Error setting ${storageType} key \u201C${key}\u201D:`, error);
      }
    },
    [key, storedValue, storageType, storage]
  );
  useEffect(() => {
    setStoredValue(readValue());
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleStorageChange = (event) => {
      if (event.storageArea === storage && event.key === key) {
        try {
          setStoredValue(
            event.newValue ? JSON.parse(event.newValue) : initialValue
          );
        } catch (error) {
          console.warn(`Error parsing storage change for key \u201C${key}\u201D:`, error);
        }
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [key, initialValue, storage, readValue]);
  return [storedValue, setValue];
}
function useLocalStorage(key, initialValue) {
  return useStorage("localStorage", key, initialValue);
}
function useSessionStorage(key, initialValue) {
  return useStorage("sessionStorage", key, initialValue);
}

// src/session.tsx
import { jsx } from "react/jsx-runtime";
var DefaultSessionContext = createContext(null);
var SessionProvider = ({
  url,
  label,
  toast,
  children,
  context = DefaultSessionContext,
  autoconnect = false,
  wsAuth = false,
  binaryType = "blob"
}) => {
  const [session, setSession] = useState2(null);
  useEffect2(() => {
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
  useEffect2(() => {
    if (session) {
      console.info(
        `[WS Session] Updating label and/or toast reference for ${label || "Server"} at ${url}`
      );
      session.label = label || "Server";
      session.toast = toast;
    }
  }, [label, toast, session]);
  useEffect2(() => {
    if (autoconnect && session) {
      console.info(
        `[WS Session] Autoconnecting session for ${label || "Server"} at ${url}`
      );
      const cleanup = session.connect();
      return () => {
        console.info(
          `[WS Session] Auto-disconnecting session for ${label || "Server"} at ${url}`
        );
        cleanup?.();
      };
    }
  }, [autoconnect, session]);
  if (wsAuth) {
    const [userId, setUserId] = useLocalStorage(
      "_USER_ID",
      null
    );
    const [sessionId, setSessionId] = useSessionStorage(
      "_SESSION_ID",
      null
    );
    useEffect2(() => {
      if (!session) return;
      const handleRequestUserSession = () => {
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
        session.send("_USER_SESSION", { user: u, session: s });
      };
      session.registerEvent("_REQUEST_USER_SESSION", handleRequestUserSession);
      return () => {
        session.deregisterEvent("_REQUEST_USER_SESSION");
      };
    }, [session, userId, sessionId]);
  }
  return /* @__PURE__ */ jsx(context.Provider, { value: session, children });
};
var Session = class {
  constructor(url, label = "Server", toast = null, binaryType = "blob", minRetryInterval = 250, maxRetryInterval = 1e4) {
    this.ws = null;
    this.isConnected = false;
    this.onConnectionChange = void 0;
    this.eventHandlers = {};
    this.initHandlers = {};
    this.binaryHandler = null;
    this.binData = null;
    // metadata for the next binary message
    this.retryTimeout = null;
    // scheduled retry
    this.autoReconnect = true;
    this.url = url;
    this.label = label;
    this.toast = toast;
    this.binaryType = binaryType;
    this.minRetryInterval = minRetryInterval;
    this.maxRetryInterval = maxRetryInterval;
    this.retryInterval = minRetryInterval;
  }
  registerEvent(event, callback) {
    if (event in this.eventHandlers) {
      console.error(
        `[WS Session] Attempted to registerEvent for ${event}, but handler already exists`
      );
      throw new Error(`already subscribed to ${event}`);
    }
    this.eventHandlers[event] = callback;
  }
  deregisterEvent(event) {
    if (!(event in this.eventHandlers)) {
      console.error(
        `[WS Session] Attempted to deregisterEvent for ${event}, but no handler was found`
      );
      throw new Error(`not subscribed to ${event}`);
    }
    delete this.eventHandlers[event];
  }
  registerInit(key, callback) {
    if (key in this.initHandlers) {
      console.error(
        `[WS Session] Attempted to registerInit with key=${key}, but initHandler already exists`
      );
      throw new Error(`already registered`);
    }
    console.debug(`[WS Session] registeInit for key=${key}`);
    this.initHandlers[key] = callback;
  }
  deregisterInit(key) {
    if (!(key in this.initHandlers)) {
      console.error(
        `[WS Session] Attempted to deregisterInit for key=${key}, but it was not registered`
      );
      throw new Error(`not registered`);
    }
    delete this.initHandlers[key];
  }
  registerBinary(callback) {
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
  send(event, data) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.warn(
        `[WS Session] Attempted to send event=${event} while socket not OPEN`
      );
      this.toast?.error(`${this.label}: Sending while not connected!`);
      return;
    }
    this.ws?.send(
      JSON.stringify({
        type: event,
        data
      })
    );
  }
  sendBinary(event, metadata, data) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.warn(
        `[WS Session] Attempted to sendBinary event=${event} while socket not OPEN`
      );
      this.toast?.error(`${this.label}: Sending while not connected!`);
      return;
    }
    this.ws?.send(
      JSON.stringify({
        type: "_BIN_META",
        data: {
          type: event,
          metadata
        }
      })
    );
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
        this.toast?.warning(
          `Disconnected from ${this.label}: Retrying in ${this.retryInterval / 1e3} seconds...`
        );
        this.retryTimeout = setTimeout(() => {
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
    if (wasConnected) {
      this.onConnectionChange?.(this.isConnected);
    }
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
        console.info(
          `[WS Session] Received _DISCONNECT from server for ${this.label}`
        );
        this.disconnect();
        this.toast?.loading(`${this.label}: ${event.data}`, {
          duration: 1e7
        });
        return;
      } else if (event.type === "_DOWNLOAD") {
        const { filename, data } = event.data;
        fetch(`data:application/octet-stream;base64,${data}`).then((res) => res.blob()).then((blob) => fileDownload(blob, filename));
      } else if (event.type === "_BIN_META") {
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
            ...metadata
          });
        } else {
          console.warn(`[WS Session] No handler for binary event: ${type}`);
        }
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
};

// src/sync.ts
import {
  applyPatches,
  enablePatches,
  produce
} from "immer";
import { useEffect as useEffect3 } from "react";
enablePatches();
var Sync = class {
  // ========== public methods ========== //
  constructor(key, session, sendOnInit = false) {
    this._patches = [];
    // currently unsynced local changes
    this._lastSyncTime = 0;
    // timestamp of last sync
    this._actionHandlers = /* @__PURE__ */ new Map();
    this._debounceTimer = null;
    this._maxWaitTimer = null;
    this._firstPatchAt = null;
    this._baseSnapshot = null;
    // If not null, compress when patch count >= threshold
    this.compressThreshold = 5;
    this.key = key;
    this.session = session;
    this.sendOnInit = sendOnInit;
  }
  get lastSyncTime() {
    return this._lastSyncTime;
  }
  // flush the pending local changes to the server
  sync(params) {
    const debounceMs = params?.debounceMs ?? 0;
    const maxWaitMs = params?.maxWaitMs ?? 0;
    if (debounceMs <= 0) {
      this.flush();
      return;
    }
    if (this._patches.length === 0) {
      return;
    }
    if (this._firstPatchAt === null) {
      this._firstPatchAt = Date.now();
    }
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => this.flush(), debounceMs);
    if (maxWaitMs > 0 && this._maxWaitTimer === null && this._firstPatchAt) {
      const now = Date.now();
      const fireAt = this._firstPatchAt + maxWaitMs;
      const delay = Math.max(0, fireAt - now);
      this._maxWaitTimer = setTimeout(() => this.flush(), delay);
    }
  }
  flush() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (this._maxWaitTimer) {
      clearTimeout(this._maxWaitTimer);
      this._maxWaitTimer = null;
    }
    if (this._patches.length > 0) {
      if (this.compressThreshold !== null && this._patches.length >= this.compressThreshold && this._baseSnapshot !== null) {
        this._patches = this.compressImmerPatches(
          this._baseSnapshot,
          this._patches
        );
      }
      this.session.send(
        patchEvent(this.key),
        convertImmerPatchesToJsonPatch(this._patches)
      );
      this._lastSyncTime = Date.now();
      this._patches = [];
    }
    this._firstPatchAt = null;
    this._baseSnapshot = null;
  }
  appendPatch(patches, baseState) {
    this._patches.push(...patches);
    if (this._firstPatchAt === null && patches.length > 0) {
      this._firstPatchAt = Date.now();
      if (baseState !== void 0) {
        this._baseSnapshot = baseState;
      }
    }
  }
  // Compress Immer patches by re-applying them to the captured base and
  // re-emitting a minimal patch set for the net effect.
  compressImmerPatches(baseState, patches) {
    let compressed = patches;
    produce(
      baseState,
      (draft) => {
        applyPatches(draft, patches);
      },
      (p) => {
        compressed = p;
      }
    );
    return compressed;
  }
  sendAction(action) {
    this.session.send(actionEvent(this.key), action);
  }
  startTask(task) {
    this.session.send(taskStartEvent(this.key), task);
  }
  cancelTask(task) {
    this.session.send(taskCancelEvent(this.key), task);
  }
  sendBinary(action, data) {
    this.session.sendBinary(actionEvent(this.key), action, data);
  }
  // fetch the remote state by sending _GET
  fetchRemoteState() {
    this.session.send(getEvent(this.key), {});
  }
  // send the full state via _SET
  sendState(state) {
    this.session.send(setEvent(this.key), state);
  }
  // Register session event handlers for a reducer-like consumer and return a cleanup function
  registerHandlers(getState, setState, patchState, actionHandler) {
    this.session.registerEvent(
      getEvent(this.key),
      () => this.sendState(getState())
    );
    this.session.registerEvent(setEvent(this.key), (s) => setState(s));
    this.session.registerEvent(
      patchEvent(this.key),
      (p) => patchState(p)
    );
    this.session.registerEvent(actionEvent(this.key), (a) => {
      const act = a;
      const handler = this._actionHandlers.get(act.type);
      if (handler) {
        const payload = Object.fromEntries(
          Object.entries(act).filter(([k]) => k !== "type")
        );
        try {
          handler(payload);
        } catch (err) {
          console.error(
            `[Sync] error invoking dynamic action handler for ${act.type}:`,
            err
          );
        }
      } else {
        actionHandler(act);
      }
    });
    if (this.sendOnInit) {
      this.session.registerInit(this.key, () => this.sendState(getState()));
    }
    return () => {
      this.session.deregisterEvent(getEvent(this.key));
      this.session.deregisterEvent(setEvent(this.key));
      this.session.deregisterEvent(patchEvent(this.key));
      this.session.deregisterEvent(actionEvent(this.key));
      if (this.sendOnInit) {
        this.session.deregisterInit(this.key);
      }
    };
  }
  // Register multiple remote action handlers that take precedence over the catch-all
  registerExposedActions(handlers) {
    const registeredKeys = [];
    for (const [key, fn] of Object.entries(handlers)) {
      if (this._actionHandlers.has(key)) {
        console.error(`[Sync] Attempt to re-register action handler: ${key}`);
        throw new Error(`action handler already registered for ${key}`);
      }
      this._actionHandlers.set(key, ((payload) => (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fn(payload)
      )));
      registeredKeys.push(key);
    }
    return () => {
      for (const key of registeredKeys) {
        this._actionHandlers.delete(key);
      }
    };
  }
  // React convenience: register/deregister within a useEffect
  useExposedActions(handlers) {
    useEffect3(() => this.registerExposedActions(handlers), [this, handlers]);
  }
  createDelegators(nameToKey) {
    if (arguments.length === 0) {
      return (ntk) => this.createDelegators(ntk);
    }
    const entries = Object.entries(nameToKey);
    const result = Object.fromEntries(
      entries.map(([localName, remoteKey]) => {
        const fn = (args) => {
          if (args === null || args === void 0) {
            this.sendAction({ type: String(remoteKey) });
          } else {
            this.sendAction({ type: String(remoteKey), ...args });
          }
        };
        return [localName, fn];
      })
    );
    return result;
  }
};
var setEvent = (key) => "_SET:" + key;
var getEvent = (key) => "_GET:" + key;
var patchEvent = (key) => "_PATCH:" + key;
var actionEvent = (key) => "_ACTION:" + key;
var taskStartEvent = (key) => "_TASK_START:" + key;
var taskCancelEvent = (key) => "_TASK_CANCEL:" + key;
var convertImmerPatchesToJsonPatch = (immerPatches) => {
  return immerPatches.map((p) => {
    let stringPath = p.path.join("/");
    if (!stringPath.startsWith("/")) {
      stringPath = "/" + stringPath;
    }
    return {
      ...p,
      path: stringPath
    };
  });
};
var convertShallowUpdateToImmerPatch = (shallowUpdate) => {
  return Object.entries(shallowUpdate).map(([key, value]) => {
    return {
      op: "replace",
      path: [key],
      value
    };
  });
};

// src/react/synced-reducer.ts
enablePatches2();
function useSyncedReducer(key, syncedReducer, initialState, overrideSession = null, sendOnInit = false) {
  const session = overrideSession ?? useContext(DefaultSessionContext);
  if (!session) {
    throw new Error(
      "useSyncedReducer requires a Session from context or overrideSession"
    );
  }
  const syncObj = useMemo(
    () => new Sync(key, session, sendOnInit),
    [session, key, sendOnInit]
  );
  const sendAction = syncObj.sendAction.bind(syncObj);
  const startTask = syncObj.startTask.bind(syncObj);
  const cancelTask = syncObj.cancelTask.bind(syncObj);
  const sendBinary = syncObj.sendBinary.bind(syncObj);
  const wrappedReducer = ([state2], action) => {
    switch (action.type) {
      // completely overwrite the state, usually sent by the remote on init or to refresh
      case setEvent(key): {
        const newState = action.data;
        return [newState, []];
      }
      // apply a patch to the state, usually sent by the remote on sync
      case patchEvent(key): {
        const patch = action.data;
        const newState = patch.reduce(applyReducer, deepClone(state2));
        return [newState, []];
      }
      // any other user-defined action, either locally or by the remote
      default: {
        if (!syncedReducer) {
          return [state2, []];
        }
        const patchEffects = [];
        const plainEffects = [];
        const sync = () => {
          patchEffects.push((patches2) => () => {
            syncObj.appendPatch(patches2);
            syncObj.sync();
          });
        };
        const delegate = (actionOverride) => {
          plainEffects.push(() => {
            sendAction(actionOverride ?? action);
          });
        };
        const [newState, patches] = produceWithPatches(syncedReducer)(
          castImmutable(state2),
          action,
          sync,
          delegate
        );
        return [
          newState,
          [...plainEffects, ...patchEffects.map((f) => f(patches))]
        ];
      }
    }
  };
  const [[state, effects], dispatch] = useReducer(wrappedReducer, [
    initialState,
    []
  ]);
  useEffect4(() => {
    if (effects.length === 0) return;
    effects.forEach((f) => f());
    effects.splice(0, effects.length);
  });
  const setState = (newState) => {
    dispatch({ type: setEvent(key), data: newState });
  };
  const patchState = (patch) => {
    dispatch({ type: patchEvent(key), data: patch });
  };
  const actionState = (action) => {
    dispatch(action);
  };
  const latestStateRef = useRef(state);
  latestStateRef.current = state;
  useEffect4(() => {
    return syncObj.registerHandlers(
      () => latestStateRef.current,
      setState,
      patchState,
      actionState
    );
  }, [syncObj]);
  const setters = useMemo(() => {
    const result = {};
    Object.keys(initialState).forEach((attr) => {
      const attrStr = String(attr);
      const upper = attrStr.charAt(0).toUpperCase() + attrStr.slice(1);
      const setter = (newValue) => {
        const patch = [
          { op: "replace", path: `/${attrStr}`, value: newValue }
        ];
        patchState(patch);
      };
      const syncer = (newValue) => {
        const patch = [
          { op: "replace", path: `/${attrStr}`, value: newValue }
        ];
        patchState(patch);
        const immerPatches = convertShallowUpdateToImmerPatch({
          [attrStr]: newValue
        });
        syncObj.appendPatch(immerPatches);
        syncObj.sync();
      };
      result[`set${upper}`] = setter;
      result[`sync${upper}`] = syncer;
    });
    return result;
  }, [initialState, patchState, key, session, syncObj]);
  const stateWithSync = useMemo(
    () => ({
      ...state,
      ...setters,
      fetchRemoteState: syncObj.fetchRemoteState.bind(syncObj),
      sendState: (s) => syncObj.sendState(s),
      sendAction,
      startTask,
      cancelTask,
      sendBinary
    }),
    [state, setters, syncObj, sendAction, startTask, cancelTask, sendBinary]
  );
  return [stateWithSync, dispatch];
}
function useSynced(key, initialState, overrideSession = null, sendOnInit = false) {
  const [stateWithSync] = useSyncedReducer(
    key,
    void 0,
    initialState,
    overrideSession,
    sendOnInit
  );
  return stateWithSync;
}
function useObserved(key, initialState, overrideSession = null) {
  const [stateWithSync] = useSyncedReducer(
    key,
    void 0,
    initialState,
    overrideSession,
    false
  );
  const readonlyState = useMemo(() => {
    const result = {};
    Object.keys(initialState).forEach((k) => {
      result[k] = stateWithSync[k];
    });
    result.fetchRemoteState = stateWithSync.fetchRemoteState;
    return result;
  }, [stateWithSync, initialState]);
  return readonlyState;
}

// src/remote-toast.ts
import { useEffect as useEffect5 } from "react";
var useRemoteToast = (session, toast, prefix = "") => {
  useEffect5(() => {
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
        default:
          toast(prefix + message);
      }
    });
    return () => {
      session?.deregisterEvent("_TOAST");
    };
  }, [session, toast, prefix]);
};

// src/zustand/synced-store.ts
import { applyReducer as applyReducer2, deepClone as deepClone2 } from "fast-json-patch";
import { enablePatches as enablePatches3, produceWithPatches as produceWithPatches2 } from "immer";
import "zustand/middleware";
enablePatches3();
var syncedImpl = (stateCreator, syncOptions) => (set, get, store) => {
  const newStore = store;
  const syncObj = new Sync(
    syncOptions.key,
    syncOptions.session,
    syncOptions.sendOnInit
  );
  store.setState = (updater, replace, ...args) => {
    if (typeof updater === "function") {
      const userFn = updater;
      const producer = (draft) => {
        const result = userFn(draft);
        if (result && typeof result === "object") {
          Object.assign(draft, result);
        }
      };
      const newStateCreator = produceWithPatches2(producer);
      const current = get();
      const [newState, patches] = newStateCreator(current);
      syncObj.appendPatch(patches, current);
      return set(newState, replace, ...args);
    } else {
      const newState = updater;
      syncObj.appendPatch(
        convertShallowUpdateToImmerPatch(newState),
        get()
      );
      return set(newState, replace, ...args);
    }
  };
  const cleanup = syncObj.registerHandlers(
    () => get(),
    (s) => {
      set(s, true);
    },
    (patches) => {
      const next = patches.reduce(applyReducer2, deepClone2(get()));
      set(next, true);
    },
    (action) => {
      const currentState = get();
      const handler = currentState[action.type];
      if (typeof handler === "function") {
        const payload = { ...action };
        delete payload.type;
        try {
          handler(payload);
        } catch (err) {
          console.error(
            `[zustand synced] error invoking action handler for ${action.type}:`,
            err
          );
        }
      }
    }
  );
  const callableSync = syncObj.sync.bind(syncObj);
  callableSync.obj = syncObj;
  callableSync.cleanup = cleanup;
  callableSync.createDelegators = syncObj.createDelegators.bind(syncObj);
  callableSync.sendAction = syncObj.sendAction.bind(syncObj);
  callableSync.startTask = syncObj.startTask.bind(syncObj);
  callableSync.cancelTask = syncObj.cancelTask.bind(syncObj);
  callableSync.sendBinary = syncObj.sendBinary.bind(syncObj);
  callableSync.fetchRemoteState = syncObj.fetchRemoteState.bind(syncObj);
  callableSync.sendState = syncObj.sendState.bind(syncObj);
  callableSync.registerExposedActions = syncObj.registerExposedActions.bind(syncObj);
  callableSync.useExposedActions = syncObj.useExposedActions.bind(syncObj);
  newStore.sync = callableSync;
  return stateCreator(store.setState, get, newStore);
};
var synced = syncedImpl;
export {
  DefaultSessionContext,
  Session,
  SessionProvider,
  synced,
  useObserved,
  useRemoteToast,
  useSynced,
  useSyncedReducer
};
//# sourceMappingURL=index.mjs.map