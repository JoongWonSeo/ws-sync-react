/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Draft } from "immer";
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
  convertShallowUpdateToImmerPatch,
  Sync as SyncObj,
  SyncParams,
} from "../sync";

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
}

// attached to the store with helpers
type Sync = SyncObj & {
  (params?: SyncParams): void;
  delegate: any; // attach delegate of the store actions
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

    // attach new sync object to the store
    const newStore = store as Mutate<StoreApi<State>, [["sync", Sync]]>;
    const syncObj = new SyncObj(
      syncOptions.key,
      syncOptions.session,
      syncOptions.sendOnInit
    );
    // expose a callable sync function with helper methods bound to syncObj
    const callableSync = syncObj.sync.bind(syncObj) as any;
    Object.assign(callableSync, {
      appendPatch: syncObj.appendPatch.bind(syncObj),
      sendAction: syncObj.sendAction.bind(syncObj),
      startTask: syncObj.startTask.bind(syncObj),
      cancelTask: syncObj.cancelTask.bind(syncObj),
      sendBinary: syncObj.sendBinary.bind(syncObj),
      delegate: {} as any,
    });
    newStore.sync = callableSync as any;

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
        const [newState, patches] = newStateCreator(get());
        // save the patches, so that they can be synced later
        (newStore.sync as any).appendPatch(patches);

        return set(newState as State, replace as any, ...args);
      } else {
        // new state is already given, convert to patch
        const newState = updater;
        // save as patch, so that it can be synced later
        (newStore.sync as any).appendPatch(
          convertShallowUpdateToImmerPatch(newState as Record<string, any>)
        );

        return set(newState, replace as any, ...args);
      }
    };

    // handle incoming actions
    // syncObj.session.registerEvent();

    // create the state with the wrapped setter and the mutated store (note newStore === store same object)
    const initialState = stateCreator(store.setState, get, newStore);

    // save initial state to the sync object

    return initialState;
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
