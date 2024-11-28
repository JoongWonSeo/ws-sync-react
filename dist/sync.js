"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useSynced = exports.useSyncedReducer = void 0;
const react_1 = require("react");
const fast_json_patch_1 = require("fast-json-patch");
const session_1 = require("./session");
const immer_1 = require("immer");
(0, immer_1.enablePatches)();
const setEvent = (key) => "_SET:" + key;
const getEvent = (key) => "_GET:" + key;
const patchEvent = (key) => "_PATCH:" + key;
const actionEvent = (key) => "_ACTION:" + key;
const taskStartEvent = (key) => "_TASK_START:" + key;
const taskCancelEvent = (key) => "_TASK_CANCEL:" + key;
function useSyncedReducer(key, syncedReducer, initialState, overrideSession = null, sendOnInit = false) {
    const session = overrideSession !== null && overrideSession !== void 0 ? overrideSession : (0, react_1.useContext)(session_1.DefaultSessionContext);
    // Syncing: Local -> Remote
    const fetchRemoteState = (0, react_1.useCallback)(() => {
        session === null || session === void 0 ? void 0 : session.send(getEvent(key), {});
    }, [session, key]);
    const sendState = (0, react_1.useCallback)((newState) => {
        session === null || session === void 0 ? void 0 : session.send(setEvent(key), newState);
    }, [session, key]);
    const sendPatch = (0, react_1.useCallback)((patch) => {
        session === null || session === void 0 ? void 0 : session.send(patchEvent(key), patch);
    }, [session, key]);
    const sendAction = (0, react_1.useCallback)((action) => {
        session === null || session === void 0 ? void 0 : session.send(actionEvent(key), action);
    }, [session, key]);
    const startTask = (0, react_1.useCallback)((task) => {
        session === null || session === void 0 ? void 0 : session.send(taskStartEvent(key), task);
    }, [session, key]);
    const cancelTask = (0, react_1.useCallback)((task) => {
        session === null || session === void 0 ? void 0 : session.send(taskCancelEvent(key), task);
    }, [session, key]);
    const sendBinary = (0, react_1.useCallback)((action, data) => {
        session === null || session === void 0 ? void 0 : session.sendBinary(actionEvent(key), action, data);
    }, [session, key]);
    // State Management
    // reducer must be wrapped to handle the remote events, and also return a queue of side effects to perform, i.e. sync and sendAction
    const wrappedReducer = ([state, _], action) => {
        switch (action.type) {
            case setEvent(key): {
                const newState = action.data;
                return [newState, []];
            }
            case patchEvent(key): {
                const patch = action.data;
                const newState = patch.reduce(fast_json_patch_1.applyReducer, (0, fast_json_patch_1.deepClone)(state));
                return [newState, []];
            }
            default: {
                if (!syncedReducer) {
                    return [state, []];
                }
                // sync and delegate enqueues the patch and action to be sent to the remote, will actually be executed in the useEffect after the reducer
                const createEffect = [];
                const sync = () => {
                    createEffect.push((patch) => () => {
                        if (patch.length > 0) {
                            //convert "Immer" patches to standard json patches
                            patch.forEach((p) => {
                                // if path is an array, join it into a string
                                if (Array.isArray(p.path)) {
                                    p.path = p.path.join("/");
                                }
                                // if it does not start with /, add it
                                if (!p.path.startsWith("/")) {
                                    p.path = "/" + p.path;
                                }
                            });
                            sendPatch(patch);
                        }
                    });
                };
                const delegate = (actionOverride) => {
                    createEffect.push((patch) => () => {
                        sendAction(actionOverride !== null && actionOverride !== void 0 ? actionOverride : action);
                    });
                };
                const withPatch = (0, immer_1.produceWithPatches)(syncedReducer);
                const [newState, patch, inverse] = withPatch((0, immer_1.castImmutable)(state), action, sync, delegate);
                return [newState, createEffect.map((f) => f(patch))];
            }
        }
    };
    // The underlying state holder and reducer
    const [[state, effects], dispatch] = (0, react_1.useReducer)(wrappedReducer, [
        initialState,
        [],
    ]);
    // Execute the side effects (after render)
    (0, react_1.useEffect)(() => {
        if (effects.length === 0)
            return;
        effects.forEach((f) => f());
        effects.splice(0, effects.length); // clear the effects
    });
    // Syncing: Remote -> Local
    // callbacks to handle remote events
    const setState = (0, react_1.useCallback)((newState) => {
        dispatch({ type: setEvent(key), data: newState });
    }, [key]);
    const patchState = (0, react_1.useCallback)((patch) => {
        dispatch({ type: patchEvent(key), data: patch });
    }, [key]);
    const actionState = (0, react_1.useCallback)((action) => {
        dispatch(action);
    }, []);
    (0, react_1.useEffect)(() => {
        session === null || session === void 0 ? void 0 : session.registerEvent(getEvent(key), () => sendState(state)); //TODO: closure correct?
        session === null || session === void 0 ? void 0 : session.registerEvent(setEvent(key), setState);
        session === null || session === void 0 ? void 0 : session.registerEvent(patchEvent(key), patchState);
        session === null || session === void 0 ? void 0 : session.registerEvent(actionEvent(key), actionState);
        // TODO: allow binary handler
        if (sendOnInit) {
            // Optionally, send the initial state or an initial action
            session === null || session === void 0 ? void 0 : session.registerInit(key, () => sendState(state));
        }
        return () => {
            session === null || session === void 0 ? void 0 : session.deregisterEvent(getEvent(key));
            session === null || session === void 0 ? void 0 : session.deregisterEvent(setEvent(key));
            session === null || session === void 0 ? void 0 : session.deregisterEvent(patchEvent(key));
            session === null || session === void 0 ? void 0 : session.deregisterEvent(actionEvent(key));
            if (sendOnInit) {
                session === null || session === void 0 ? void 0 : session.deregisterInit(key);
            }
        };
    }, [session, key]);
    // Dynamically create setters and syncers for each attribute
    const setters = (0, react_1.useMemo)(() => Object.keys(initialState).reduce((acc, attr) => {
        const upper = attr.charAt(0).toUpperCase() + attr.slice(1);
        const setter = (newValue) => {
            const patch = [{ op: "replace", path: `/${attr}`, value: newValue }];
            patchState(patch); // local update
        };
        const syncer = (newValue) => {
            const patch = [{ op: "replace", path: `/${attr}`, value: newValue }];
            patchState(patch); // local update
            sendPatch(patch); // sync to remote
        };
        acc[`set${upper}`] = setter;
        acc[`sync${upper}`] = syncer;
        return acc;
    }, {}), [initialState, patchState, sendPatch]);
    // expose the state with setters and syncers
    const stateWithSync = (0, react_1.useMemo)(() => (Object.assign(Object.assign(Object.assign({}, state), setters), { fetchRemoteState, // explicitly fetch the entire state from remote
        sendAction,
        startTask,
        cancelTask,
        sendBinary })), [
        state,
        setters,
        fetchRemoteState,
        sendAction,
        startTask,
        cancelTask,
        sendBinary,
    ]);
    return [stateWithSync, dispatch];
}
exports.useSyncedReducer = useSyncedReducer;
function useSynced(key, initialState, overrideSession = null, sendOnInit = false) {
    const [stateWithSync, dispatch] = useSyncedReducer(key, undefined, initialState, overrideSession, sendOnInit);
    return stateWithSync;
}
exports.useSynced = useSynced;
