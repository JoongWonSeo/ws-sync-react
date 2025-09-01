/* eslint-disable @typescript-eslint/no-explicit-any */
import { produceWithPatches } from "immer";
import {
  create,
  type Mutate,
  type StateCreator,
  type StoreApi,
  type StoreMutatorIdentifier,
} from "zustand";
import type { Action, TaskCancel, TaskStart } from "../react/synced-reducer";
import type { Session } from "../session";

// ========== type helpers ========== //
// "Overwrite" the keys of T with the keys of U.
type Write<T extends object, U extends object> = Omit<T, keyof U> & U;
// "Cast" T to U, unless T is already a type of U.
type Cast<T, U> = T extends U ? T : U;

// ========== externally visible type of the middleware ========== //
// Pass the store mutators between parent <-> child middlewares

// to initialize the middleware
export interface SyncOptions {
  syncKey: string;
}

// gets passed to the sync function
export interface SyncParams {
  debounceMs?: number;
}

// gets attached to the store
export interface Sync {
  (syncParams?: SyncParams): void; // makes the object callable
  options: SyncOptions;
  session: Session;
  fetchRemoteState: () => void;
  sendAction: (action: Action) => void;
  startTask: (task: TaskStart) => void;
  cancelTask: (task: TaskCancel) => void;
  sendBinary: (action: Action, data: ArrayBuffer) => void;
}

type Synced = <
  State,
  Mps extends [StoreMutatorIdentifier, unknown][] = [], // store mutators from parent middlewares
  Mcs extends [StoreMutatorIdentifier, unknown][] = [] // store mutators from child middlewares
>(
  stateCreator: StateCreator<State, [...Mps, ["sync", Sync]], Mcs>, // forward the mutators from our parent middlewares along with our mutation to the child middleware
  syncOptions: SyncOptions
) => StateCreator<State, Mps, [["sync", Sync], ...Mcs]>; // forward our mutation along with the mutators from our child middlewares

// register our store mutator with zustand
declare module "zustand" {
  interface StoreMutators<S, A> {
    sync: Write<Cast<S, object>, { sync: A }>;
  }
}

// ========== implementation of the middleware ========== //
type SyncedImpl = <State>(
  stateCreator: StateCreator<State, [], []>,
  syncOptions: SyncOptions
) => StateCreator<State, [], []>;

const syncedImpl: SyncedImpl =
  (stateCreator, syncOptions) => (set, get, store) => {
    type State = ReturnType<typeof stateCreator>;

    // attach new sync object to the store
    const syncFunction = (syncParams?: SyncParams) => {
      console.log("syncing...", syncParams);

      // check for skip due to debounce logic

      // gather the patches produced by the setters, and send them to the server
      // TODO: either for each or merge all patches
      session?.send(patchEvent(key), patches);
      sync.lastSyncTime = Date.now();
    };

    // the patches that will be sent to the server
    const newStore = store as Mutate<StoreApi<State>, [["sync", Sync]]>;
    newStore.sync = Object.assign(syncFunction, {
      options: syncOptions,
    });

    // wrap the setter to add immer support along with saving the generated patches
    store.setState = (updater, replace?: boolean, ...args) => {
      if (typeof updater === "function") {
        const newStateCreator = produceWithPatches(updater as any);
        // apply the producer to the current state, save the patches
        const [newState, patches, inversePatches] = newStateCreator(get());
        // save the patches, so that they can be synced later
        newStore.sync.patches.push(convertImmerPatchesToJsonPatch(patches)); // sync.appendPatch

        return set(newState, replace as any, ...args);
      } else {
        // new state is already given, convert to patch
        const newState = updater;
        // save as patch, so that it can be synced later
        newStore.sync.patches.push(convertShallowUpdateToJsonPatch(newState)); // sync.appendPatch

        return set(newState, replace as any, ...args);
      }
    };

    // create the state with the wrapped setter and the mutated store (note newStore === store same object)
    return stateCreator(store.setState, get, newStore);
  };

// ========== export the middleware ========== //
export const synced = syncedImpl as unknown as Synced;

// ========== usage example ========== //
const useBearStore = create(
  synced(
    (set, get, store) => ({
      // the state
      bears: 0,
      // access the store.sync from "inside"
      setBears: () => {
        set((state) => ({ bears: state.bears + 1 }));
        store.sync({ debounceMs: 1000 });
      },
    }),
    // inject into store
    { syncKey: "synced" }
  )
);
// access the store.foo from "outside"
console.log(useBearStore.sync());
