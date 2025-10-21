import type { Operation as JsonPatch } from "fast-json-patch";
import { applyReducer, deepClone } from "fast-json-patch";
import {
  castImmutable,
  enablePatches,
  Patch as ImmerPatch,
  produceWithPatches,
} from "immer";
import { useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { DefaultSessionContext, Session } from "../session";
import {
  Action,
  convertShallowUpdateToImmerPatch,
  patchEvent,
  setEvent,
  Sync as SyncObj,
  TaskCancel,
  TaskStart,
} from "../sync";
enablePatches();

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
export type Sync = () => void;
export type Delegate = (actionOverride?: Action) => void;
export type SyncedReducer<S> = (
  draft: S,
  action: Action,
  sync: Sync,
  delegate: Delegate
) => S | void;

export type StateWithSync<S> = S &
  SetterMethodNames<S> &
  SyncerMethodNames<S> & {
    fetchRemoteState: () => void;
    sendState: (state: S) => void;
    sendAction: (action: Action) => void;
    startTask: (task: TaskStart) => void;
    cancelTask: (task: TaskCancel) => void;
    sendBinary: (action: Action, data: ArrayBuffer) => void;
  };

export function useSyncedReducer<S extends Record<string, unknown>>(
  key: string,
  syncedReducer: SyncedReducer<S> | undefined,
  initialState: S,
  overrideSession: Session | null = null,
  sendOnInit = false
): [StateWithSync<S>, (action: Action) => void] {
  const session = overrideSession ?? useContext(DefaultSessionContext);
  if (!session) {
    throw new Error(
      "useSyncedReducer requires a Session from context or overrideSession"
    );
  }

  // Underlying sync helper
  const syncObj = useMemo(
    () => new SyncObj(key, session, sendOnInit),
    [session, key, sendOnInit]
  );

  // Syncing: Local -> Remote handled by syncObj
  const sendAction = syncObj.sendAction.bind(syncObj);
  const startTask = syncObj.startTask.bind(syncObj);
  const cancelTask = syncObj.cancelTask.bind(syncObj);
  const sendBinary = syncObj.sendBinary.bind(syncObj);

  // State Management
  // reducer must be wrapped to handle the remote events, and also return a queue of side effects to perform, i.e. sync and sendAction
  type Effect = () => void;
  const wrappedReducer = (
    [state]: [S, Effect[]],
    action: Action
  ): [S, Effect[]] => {
    switch (action.type) {
      // completely overwrite the state, usually sent by the remote on init or to refresh
      case setEvent(key): {
        const newState = action.data as S;
        return [newState, []];
      }

      // apply a patch to the state, usually sent by the remote on sync
      case patchEvent(key): {
        const patch: JsonPatch[] = action.data as JsonPatch[];
        const newState = patch.reduce(applyReducer, deepClone(state));
        return [newState, []];
      }

      // any other user-defined action, either locally or by the remote
      default: {
        if (!syncedReducer) {
          return [state, []];
        }
        // sync and delegate enqueue the patch and action to be sent to the remote, using Sync helper, as a side-effect to be executed after reducer
        // this is because render/reducer must be side-effect-free (and will be double-triggered in strict mode to enforce this)
        const patchEffects: ((patches: ImmerPatch[]) => Effect)[] = [];
        const plainEffects: Effect[] = [];
        const sync = () => {
          patchEffects.push((patches: ImmerPatch[]) => () => {
            syncObj.appendPatch(patches);
            syncObj.sync();
          });
        };
        const delegate = (actionOverride?: Action) => {
          plainEffects.push(() => {
            sendAction(actionOverride ?? action);
          });
        };
        // call the user-defined reducer, and get the new state and patches
        const [newState, patches] = produceWithPatches(syncedReducer)(
          castImmutable(state),
          action,
          sync,
          delegate
        );
        return [
          newState,
          [...plainEffects, ...patchEffects.map((f) => f(patches))],
        ];
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
  const setState = (newState: S) => {
    dispatch({ type: setEvent(key), data: newState });
  };
  const patchState = (patch: JsonPatch[]) => {
    dispatch({ type: patchEvent(key), data: patch });
  };
  const actionState = (action: Action) => {
    dispatch(action);
  };

  // avoid re-registering handlers on every state update
  const latestStateRef = useRef(state);
  latestStateRef.current = state;

  useEffect(() => {
    return syncObj.registerHandlers(
      () => latestStateRef.current,
      setState,
      patchState,
      actionState
    );
  }, [syncObj]);

  // Dynamically create setters and syncers for each attribute with proper typing
  const setters = useMemo(() => {
    const result = {} as Partial<SetterMethodNames<S> & SyncerMethodNames<S>>;

    (Object.keys(initialState) as Array<keyof S>).forEach((attr) => {
      const attrStr = String(attr);
      const upper = attrStr.charAt(0).toUpperCase() + attrStr.slice(1);

      const setter = (newValue: S[typeof attr]) => {
        const patch: JsonPatch[] = [
          { op: "replace", path: `/${attrStr}`, value: newValue },
        ];
        patchState(patch); // local update
      };
      const syncer = (newValue: S[typeof attr]) => {
        const patch: JsonPatch[] = [
          { op: "replace", path: `/${attrStr}`, value: newValue },
        ];
        patchState(patch); // local update
        // also append as Immer patch and flush via Sync
        const immerPatches = convertShallowUpdateToImmerPatch({
          [attrStr]: newValue,
        } as Record<string, unknown>);
        syncObj.appendPatch(immerPatches);
        syncObj.sync();
      };

      // Assign with proper typing
      (result as unknown as SetterMethodNames<S>)[
        `set${upper}` as keyof SetterMethodNames<S>
      ] = setter as SetterMethodNames<S>[keyof SetterMethodNames<S>];
      (result as unknown as SyncerMethodNames<S>)[
        `sync${upper}` as keyof SyncerMethodNames<S>
      ] = syncer as SyncerMethodNames<S>[keyof SyncerMethodNames<S>];
    });

    return result as SetterMethodNames<S> & SyncerMethodNames<S>;
  }, [initialState, patchState, key, session, syncObj]);

  // expose the state with setters and syncers
  const stateWithSync = useMemo<StateWithSync<S>>(
    () => ({
      ...state,
      ...setters,
      fetchRemoteState: syncObj.fetchRemoteState.bind(syncObj),
      sendState: (s: S) => syncObj.sendState(s),
      sendAction,
      startTask,
      cancelTask,
      sendBinary,
    }),
    [state, setters, syncObj, sendAction, startTask, cancelTask, sendBinary]
  );

  return [stateWithSync, dispatch];
}

export function useSynced<S extends Record<string, unknown>>(
  key: string,
  initialState: S,
  overrideSession: Session | null = null,
  sendOnInit = false
): StateWithSync<S> {
  const [stateWithSync] = useSyncedReducer(
    key,
    undefined,
    initialState,
    overrideSession,
    sendOnInit
  );
  return stateWithSync;
}

// Only states
export type StateWithFetch<S> = S & {
  fetchRemoteState: () => void;
};

export function useObserved<S extends Record<string, unknown>>(
  key: string,
  initialState: S,
  overrideSession: Session | null = null
): StateWithFetch<S> {
  const [stateWithSync] = useSyncedReducer(
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
    (Object.keys(initialState) as Array<keyof S>).forEach((k) => {
      (result as unknown as S)[k] = stateWithSync[k];
    });

    // Add the fetchRemoteState method
    result.fetchRemoteState = stateWithSync.fetchRemoteState;

    return result;
  }, [stateWithSync, initialState]);

  return readonlyState;
}
