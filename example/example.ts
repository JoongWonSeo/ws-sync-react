import { synced, type SyncOptions } from "ws-sync";
import { create } from "zustand";
import {
  devtools,
  persist,
  type DevtoolsOptions,
  type PersistOptions,
} from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

// a simple wrapper to define all middleware in one place
export function createMyStoreHook<State>(
  stateCreator: () => State,
  {
    persistOptions,
    devtoolsOptions,
  }: {
    persistOptions: PersistOptions<State>;
    devtoolsOptions?: DevtoolsOptions;
  }
) {
  // prettier-ignore
  const useStore = create<State>()(
    devtools(
      immer(
        persist( // to localStorage
          stateCreator,
          persistOptions,
        ),
      ),
      devtoolsOptions,
    )
  );
  return useStore;
}

// a simple wrapper to define all middleware in one place
export function createSyncedStoreHook<State>(
  stateCreator: () => State,
  {
    syncOptions,
    devtoolsOptions,
  }: {
    syncOptions: SyncOptions;
    devtoolsOptions?: DevtoolsOptions;
  }
) {
  // prettier-ignore
  const useStore = create<State>()(
    devtools(
      synced(
          stateCreator,
        syncOptions,
      ),
      devtoolsOptions,
    )
  );
  return useStore;
}
