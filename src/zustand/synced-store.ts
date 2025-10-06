/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Operation as JsonPatch } from "fast-json-patch";
import { applyReducer, deepClone } from "fast-json-patch";
import type { Draft, Patch as ImmerPatch } from "immer";
import { enablePatches, produceWithPatches } from "immer";
import "zustand/middleware";
import {
  Mutate,
  StateCreator,
  StoreApi,
  StoreMutatorIdentifier,
} from "zustand/vanilla";
import { Session } from "../session";
import {
  Action,
  convertShallowUpdateToImmerPatch,
  Sync as SyncObj,
  SyncParams,
  TaskCancel,
  TaskStart,
} from "../sync";
import { Actions } from "../zustand/utils";

// ========== type helpers ========== //
// "Overwrite" the keys of T with the keys of U.
type Write<T extends object, U extends object> = Omit<T, keyof U> & U;
// "Cast" T to U, unless T is already a type of U.
type Cast<T, U> = T extends U ? T : U;

// ========== immer typing helpers (mirrors official zustand/immer) ========== //
type SkipTwo<T> = T extends { length: 0 }
  ? []
  : T extends { length: 1 }
  ? []
  : T extends { length: 0 | 1 }
  ? []
  : T extends [unknown, unknown, ...infer A]
  ? A
  : T extends [unknown, unknown?, ...infer A]
  ? A
  : T extends [unknown?, unknown?, ...infer A]
  ? A
  : never;

type SetStateType<T extends unknown[]> = Exclude<T[0], (...args: any[]) => any>;

type StoreImmer<S> = S extends {
  setState: infer SetState;
}
  ? SetState extends {
      (...args: infer A1): infer Sr1;
      (...args: infer A2): infer Sr2;
    }
    ? {
        setState(
          nextStateOrUpdater:
            | SetStateType<A2>
            | Partial<SetStateType<A2>>
            | ((state: Draft<SetStateType<A2>>) => void),
          shouldReplace?: false,
          ...args: SkipTwo<A1>
        ): Sr1;
        setState(
          nextStateOrUpdater:
            | SetStateType<A2>
            | ((state: Draft<SetStateType<A2>>) => void),
          shouldReplace: true,
          ...args: SkipTwo<A2>
        ): Sr2;
      }
    : never
  : never;

// ========== externally visible type of the middleware ========== //
// Pass the store mutators between parent <-> child middlewares

// to initialize the middleware
export interface SyncOptions {
  key: string;
  session: Session;
  sendOnInit?: boolean;
  syncAttributes?: string[] | Record<string, unknown>;
}

// attached to the store with helpers
type CreateDelegatorsFn = {
  <KeyToParams extends object>(): <
    NameToKey extends Record<string, keyof KeyToParams>
  >(
    nameToKey: NameToKey
  ) => Actions<NameToKey, KeyToParams>;
  <
    KeyToParams extends object,
    NameToKey extends Record<string, keyof KeyToParams>
  >(
    nameToKey: NameToKey
  ): Actions<NameToKey, KeyToParams>;
};

type Sync = {
  obj: SyncObj; // attach the original syncObj
  cleanup: () => void; // cleanup function, for deleting dynamic stores

  // syntactic sugar for easier access
  (params?: SyncParams): void; // callable sync function
  createDelegators: CreateDelegatorsFn;
  sendAction: (action: Action) => void;
  startTask: (task: TaskStart) => void;
  cancelTask: (task: TaskCancel) => void;
  sendBinary: (action: Action, data: ArrayBuffer) => void;
  fetchRemoteState: () => void;
  sendState: <S>(state: S) => void;
  registerExposedActions: <
    Handlers extends Record<string, (...args: any[]) => void>
  >(
    handlers: Handlers
  ) => () => void;
  useExposedActions: <
    Handlers extends Record<string, (...args: any[]) => void>
  >(
    handlers: Handlers
  ) => void;
  useIsSynced: () => boolean;
};

type Synced = <
  State,
  Mps extends [StoreMutatorIdentifier, unknown][] = [], // store mutators from parent middlewares
  Mcs extends [StoreMutatorIdentifier, unknown][] = [] // store mutators from child middlewares
>(
  stateCreator: StateCreator<State, [...Mps, ["sync", Sync]], Mcs>, // forward the mutators from our parent middlewares along with our mutation to the child middleware
  syncOptions: SyncOptions
) => StateCreator<State, Mps, [["sync", Sync], ...Mcs]>; // forward our mutation along with the mutators from our child middlewares

// register our store mutator with zustand
declare module "zustand/vanilla" {
  interface StoreMutators<S, A> {
    sync: Write<Cast<S, object>, { sync: A }> & StoreImmer<S>;
  }
}

// ========== implementation of the middleware ========== //
type SyncedImpl = <State>(
  stateCreator: StateCreator<State, [], []>,
  syncOptions: SyncOptions
) => StateCreator<State, [], []>;

enablePatches();

const syncedImpl: SyncedImpl =
  (stateCreator, syncOptions) => (set, get, store) => {
    type State = ReturnType<typeof stateCreator>;

    const syncAttributes: Set<string> | null = Array.isArray(
      syncOptions.syncAttributes
    )
      ? new Set(syncOptions.syncAttributes)
      : syncOptions.syncAttributes !== undefined
      ? new Set(Object.keys(syncOptions.syncAttributes))
      : null;

    const extractSyncedSubset = <T extends Record<string, unknown>>(
      source: T
    ): Partial<T> => {
      if (!syncAttributes) {
        // implicitly sync all attributes
        return source;
      }
      const result: Partial<T> = {};
      for (const key of syncAttributes) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          result[key as keyof T] = source[key as keyof T];
        }
      }
      return result;
    };

    const filterImmerPatches = (patches: ImmerPatch[]): ImmerPatch[] => {
      if (!syncAttributes) {
        // implicitly sync all attributes
        return patches;
      }
      return patches.filter((patch) => {
        const root = patch.path[0];
        if (typeof root === "string") {
          return syncAttributes.has(root);
        }
        return false;
      });
    };

    // attach new sync object to the store
    const newStore = store as Mutate<StoreApi<State>, [["sync", Sync]]>;
    const syncObj = new SyncObj(
      syncOptions.key,
      syncOptions.session,
      syncOptions.sendOnInit
    );

    // wrap the setter to add immer support along with saving the generated patches
    store.setState = (updater, replace?: boolean, ...args) => {
      if (typeof updater === "function") {
        // Build a producer that supports both mutation-style and return-style updaters
        const userFn = updater as (s: State) => State | Partial<State> | void;
        const producer = (draft: State) => {
          const result = userFn(draft as State);
          if (result && typeof result === "object") {
            Object.assign(draft as unknown as object, result as object);
          }
        };
        const newStateCreator = produceWithPatches(producer as any);
        // apply the producer to the current state, save the patches
        const current = get();
        const [newState, patches] = newStateCreator(current);
        const filteredPatches = filterImmerPatches(patches);
        syncObj.appendPatch(filteredPatches, current as unknown as object);
        // save the patches with base snapshot for optional compression
        return set(newState as State, replace as any, ...args);
      } else {
        // new state is already given, convert to patch
        const newState = updater;
        const shallowUpdate = extractSyncedSubset(
          (newState as Record<string, any>) ?? {}
        ) as Record<string, unknown>;
        // save as patch with base snapshot, so that it can be synced later
        syncObj.appendPatch(
          convertShallowUpdateToImmerPatch(shallowUpdate),
          get() as unknown as object
        );

        return set(newState, replace as any, ...args);
      }
    };

    // Register session handlers to support remote -> local updates
    const cleanup = syncObj.registerHandlers<State>(
      () => extractSyncedSubset(get() as Record<string, unknown>) as State,
      (s: State) => {
        // replace entire state
        const nextState = extractSyncedSubset(
          s as Record<string, unknown>
        ) as State;
        set(nextState);
      },
      (patches: JsonPatch[]) => {
        const current = extractSyncedSubset(get() as Record<string, unknown>);
        const next = patches.reduce(applyReducer, deepClone(current)) as State;
        set(next);
      },
      (action: Action) => {
        const currentState = get() as Record<string, any>;
        const handler = currentState[action.type];
        if (typeof handler === "function") {
          const payload = { ...(action as Record<string, any>) };
          delete payload.type;
          try {
            handler(payload);
          } catch (err) {
            // swallow handler errors to avoid breaking socket pipeline
            // users can handle their own errors inside action methods
            console.error(
              `[zustand synced] error invoking action handler for ${action.type}:`,
              err
            );
          }
        }
      }
    );

    // expose a callable sync function with helper methods bound to syncObj
    const callableSync = syncObj.sync.bind(syncObj) as Sync;
    callableSync.obj = syncObj;
    callableSync.cleanup = cleanup;

    // attach only the public helpers we want to expose
    callableSync.createDelegators = syncObj.createDelegators.bind(syncObj);
    callableSync.sendAction = syncObj.sendAction.bind(syncObj);
    callableSync.startTask = syncObj.startTask.bind(syncObj);
    callableSync.cancelTask = syncObj.cancelTask.bind(syncObj);
    callableSync.sendBinary = syncObj.sendBinary.bind(syncObj);
    callableSync.fetchRemoteState = syncObj.fetchRemoteState.bind(syncObj);
    callableSync.sendState = (<S>(state: S) => {
      const subset = extractSyncedSubset(state as Record<string, unknown>);
      syncObj.sendState(subset);
    }) as Sync["sendState"];
    callableSync.registerExposedActions =
      syncObj.registerExposedActions.bind(syncObj);
    callableSync.useExposedActions = syncObj.useExposedActions.bind(syncObj);
    callableSync.useIsSynced = syncObj.useIsSynced.bind(syncObj);

    newStore.sync = callableSync;

    // create the state with the wrapped setter and the mutated store (note newStore === store same object)
    return stateCreator(store.setState, get, newStore);
  };

// ========== export the middleware ========== //
export const synced = syncedImpl as unknown as Synced;

// // ========== usage example ========== //
// type BearState = {
//   bears: number;
//   setBears: () => void;
//   resetBears: (args: object) => void;
// };

// const useBearStore = create<BearState>()(
//   synced(
//     (set, get, store) => ({
//       // the state
//       bears: 0,
//       // access the store.sync from "inside"
//       setBears: () => {
//         set((state) => {
//           state.bears += 1;
//         });
//         store.sync({ debounceMs: 1000 });
//       },
//       resetBears: (args) => {
//         store.sync.sendAction({ type: "resetBears", ...args });
//       },
//       // resetBears: (args) => {
//       //   delegate.resetBears(args);
//       // },
//       // or: resetBears: delegate.resetBears
//     }),
//     { key: "bear", session: new Session("ws://localhost") }
//   )
// );
// // access the store.foo from "outside"
// console.log(useBearStore.sync());

// // ========== usage example (vanilla store) ========== //
// const bearStore = createStore<BearState>()(
//   synced(
//     (set, get, store) => ({
//       // the state
//       bears: 0,
//       // access the store.sync from "inside"
//       setBears: () => {
//         set((state) => ({ bears: state.bears + 1 }));
//         store.sync({ debounceMs: 1000 });
//       },
//       resetBears: (args) => {
//         store.sync.sendAction({ type: "resetBears", ...args });
//       },
//       // resetBears: (args) => {
//       //   delegate.resetBears(args);
//       // },
//       // or: resetBears: delegate.resetBears
//     }),
//     { key: "bear", session: new Session("ws://localhost") }
//   )
// );
// // access the store.foo from "outside"
// console.log(bearStore.sync());
