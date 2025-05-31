import { useReducer, useContext, useEffect, useMemo, useCallback } from "react";
import { applyReducer, deepClone } from "fast-json-patch";
import { Session, DefaultSessionContext } from "./session";
import { castImmutable, produceWithPatches, enablePatches } from "immer";
enablePatches();

const setEvent = (key: string) => "_SET:" + key;
const getEvent = (key: string) => "_GET:" + key;
const patchEvent = (key: string) => "_PATCH:" + key;
const actionEvent = (key: string) => "_ACTION:" + key;
const taskStartEvent = (key: string) => "_TASK_START:" + key;
const taskCancelEvent = (key: string) => "_TASK_CANCEL:" + key;

export type Action = {
  type: string;
} & Record<string, any>;

export type TaskStart = {
  type: string;
} & Record<string, any>;

export type TaskCancel = {
  type: string;
};

// Utility types for type-safe setters and syncers
type Capitalize<S extends string> = S extends `${infer F}${infer R}`
  ? `${Uppercase<F>}${R}`
  : S;

// Generate setter method names: setFoo, setBar, etc.
type SetterMethodNames<T> = {
  [K in keyof T as `set${Capitalize<string & K>}`]: (value: T[K]) => void;
};

// Generate syncer method names: syncFoo, syncBar, etc.
type SyncerMethodNames<T> = {
  [K in keyof T as `sync${Capitalize<string & K>}`]: (value: T[K]) => void;
};

// sync object that can calculate the json patch and send it to remote
export type Sync<S> = () => void;
export type Delegate = (actionOverride?: Action) => void;
export type SyncedReducer<S> = (
  draft: S,
  action: Action,
  sync: Sync<S>,
  delegate: Delegate
) => S | void;

type StateWithSync<S> = S &
  SetterMethodNames<S> &
  SyncerMethodNames<S> & {
    fetchRemoteState: () => void;
    sendAction: (action: Action) => void;
    startTask: (task: TaskStart) => void;
    cancelTask: (task: TaskCancel) => void;
    sendBinary: (action: Action, data: ArrayBuffer) => void;
  };

export function useSyncedReducer<S extends Record<string, any>>(
  key: string,
  syncedReducer: SyncedReducer<S> | undefined,
  initialState: S,
  overrideSession: Session | null = null,
  sendOnInit = false
): [StateWithSync<S>, (action: Action) => void] {
  const session = overrideSession ?? useContext(DefaultSessionContext);

  // Syncing: Local -> Remote
  const fetchRemoteState = useCallback(() => {
    session?.send(getEvent(key), {});
  }, [session, key]);
  const sendState = useCallback(
    (newState: S) => {
      session?.send(setEvent(key), newState);
    },
    [session, key]
  );
  const sendPatch = useCallback(
    (patch: any) => {
      session?.send(patchEvent(key), patch);
    },
    [session, key]
  );
  const sendAction = useCallback(
    (action: Action) => {
      session?.send(actionEvent(key), action);
    },
    [session, key]
  );
  const startTask = useCallback(
    (task: TaskStart) => {
      session?.send(taskStartEvent(key), task);
    },
    [session, key]
  );
  const cancelTask = useCallback(
    (task: TaskCancel) => {
      session?.send(taskCancelEvent(key), task);
    },
    [session, key]
  );
  const sendBinary = useCallback(
    (action: Action, data: ArrayBuffer) => {
      session?.sendBinary(actionEvent(key), action, data);
    },
    [session, key]
  );

  // State Management
  // reducer must be wrapped to handle the remote events, and also return a queue of side effects to perform, i.e. sync and sendAction
  const wrappedReducer = (
    [state, _]: [S, any[]],
    action: Action
  ): [S, any[]] => {
    switch (action.type) {
      case setEvent(key): {
        const newState = action.data;
        return [newState, []];
      }

      case patchEvent(key): {
        const patch = action.data;
        const newState = patch.reduce(applyReducer, deepClone(state));
        return [newState, []];
      }

      default: {
        if (!syncedReducer) {
          return [state, []];
        }
        // sync and delegate enqueues the patch and action to be sent to the remote, will actually be executed in the useEffect after the reducer
        const createEffect: any[] = [];
        const sync = () => {
          createEffect.push((patch: any[]) => () => {
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
        const delegate = (actionOverride?: Action) => {
          createEffect.push((patch: any[]) => () => {
            sendAction(actionOverride ?? action);
          });
        };
        const withPatch = produceWithPatches(syncedReducer);
        const [newState, patch, inverse] = withPatch(
          castImmutable(state),
          action,
          sync,
          delegate
        );
        return [newState, createEffect.map((f) => f(patch))];
      }
    }
  };

  // The underlying state holder and reducer
  const [[state, effects], dispatch] = useReducer(wrappedReducer, [
    initialState,
    [],
  ]);

  // Execute the side effects (after render)
  useEffect(() => {
    if (effects.length === 0) return;
    effects.forEach((f) => f());
    effects.splice(0, effects.length); // clear the effects
  });

  // Syncing: Remote -> Local
  // callbacks to handle remote events
  const setState = useCallback(
    (newState: S) => {
      dispatch({ type: setEvent(key), data: newState });
    },
    [key]
  );
  const patchState = useCallback(
    (patch: any) => {
      dispatch({ type: patchEvent(key), data: patch });
    },
    [key]
  );
  const actionState = useCallback((action: Action) => {
    dispatch(action);
  }, []);

  useEffect(() => {
    session?.registerEvent(getEvent(key), () => sendState(state)); //TODO: closure correct?
    session?.registerEvent(setEvent(key), setState);
    session?.registerEvent(patchEvent(key), patchState);
    session?.registerEvent(actionEvent(key), actionState);
    // TODO: allow binary handler
    if (sendOnInit) {
      // Optionally, send the initial state or an initial action
      session?.registerInit(key, () => sendState(state));
    }

    return () => {
      session?.deregisterEvent(getEvent(key));
      session?.deregisterEvent(setEvent(key));
      session?.deregisterEvent(patchEvent(key));
      session?.deregisterEvent(actionEvent(key));
      if (sendOnInit) {
        session?.deregisterInit(key);
      }
    };
  }, [session, key]);

  // Dynamically create setters and syncers for each attribute with proper typing
  const setters = useMemo(() => {
    const result = {} as SetterMethodNames<S> & SyncerMethodNames<S>;

    (Object.keys(initialState) as Array<keyof S>).forEach((attr) => {
      const attrStr = String(attr);
      const upper = attrStr.charAt(0).toUpperCase() + attrStr.slice(1);

      const setter = (newValue: S[typeof attr]) => {
        const patch = [{ op: "replace", path: `/${attrStr}`, value: newValue }];
        patchState(patch); // local update
      };
      const syncer = (newValue: S[typeof attr]) => {
        const patch = [{ op: "replace", path: `/${attrStr}`, value: newValue }];
        patchState(patch); // local update
        sendPatch(patch); // sync to remote
      };

      // Type assertion is safe here because we're constructing the exact shape
      (result as any)[`set${upper}`] = setter;
      (result as any)[`sync${upper}`] = syncer;
    });

    return result;
  }, [initialState, patchState, sendPatch]);

  // expose the state with setters and syncers
  const stateWithSync = useMemo<StateWithSync<S>>(
    () => ({
      ...state,
      ...setters,
      fetchRemoteState, // explicitly fetch the entire state from remote
      sendAction,
      startTask,
      cancelTask,
      sendBinary,
    }),
    [
      state,
      setters,
      fetchRemoteState,
      sendAction,
      startTask,
      cancelTask,
      sendBinary,
    ]
  );

  return [stateWithSync, dispatch];
}

export function useSynced<S extends Record<string, any>>(
  key: string,
  initialState: S,
  overrideSession: Session | null = null,
  sendOnInit = false
): StateWithSync<S> {
  const [stateWithSync, dispatch] = useSyncedReducer(
    key,
    undefined,
    initialState,
    overrideSession,
    sendOnInit
  );
  return stateWithSync;
}

// Only states
type StateWithFetch<S> = S & {
  fetchRemoteState: () => void;
};

export function useObserved<S extends Record<string, any>>(
  key: string,
  initialState: S,
  overrideSession: Session | null = null
): StateWithFetch<S> {
  const [stateWithSync, dispatch] = useSyncedReducer(
    key,
    undefined,
    initialState,
    overrideSession,
    false
  );

  // Create a readonly state object with only the state properties and fetchRemoteState
  const readonlyState = useMemo<StateWithFetch<S>>(() => {
    const result = {} as StateWithFetch<S>;

    // Copy only the state properties (those that exist in initialState)
    (Object.keys(initialState) as Array<keyof S>).forEach((key) => {
      (result as any)[key] = stateWithSync[key];
    });

    // Add the fetchRemoteState method
    result.fetchRemoteState = stateWithSync.fetchRemoteState;

    return result;
  }, [stateWithSync, initialState]);

  return readonlyState;
}
