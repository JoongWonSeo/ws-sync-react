import { Operation as JsonPatch } from "fast-json-patch";
import type { Draft } from "immer";
import {
  Patch as ImmerPatch,
  applyPatches,
  enablePatches,
  produce,
} from "immer";
import { useEffect, useSyncExternalStore } from "react";
import { Session } from "./session";
import type { Actions } from "./zustand/utils";
enablePatches();

// parameters for the `sync()` operation
export interface SyncParams {
  debounceMs?: number;
  maxWaitMs?: number;
}

export class Sync {
  readonly key: string;
  public sendOnInit: boolean;
  readonly session: Session;
  private _patches: ImmerPatch[] = []; // currently unsynced local changes
  private _lastSyncTime: number = 0; // timestamp of last sync
  private _actionHandlers: Map<
    string,
    (payload: Record<string, unknown>) => void
  > = new Map();
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private _firstPatchAt: number | null = null;
  private _baseSnapshot: object | null = null;
  private _isSyncedSubscribers: Set<() => void> = new Set();

  // If not null, compress when patch count >= threshold
  public compressThreshold: number | null = 5;

  get lastSyncTime(): number {
    return this._lastSyncTime;
  }

  // ========== public methods ========== //
  public constructor(
    key: string,
    session: Session,
    sendOnInit: boolean = false
  ) {
    this.key = key;
    this.session = session;
    this.sendOnInit = sendOnInit;
  }

  // flush the pending local changes to the server
  public sync(params?: SyncParams): void {
    const debounceMs = params?.debounceMs ?? 0;
    const maxWaitMs = params?.maxWaitMs ?? 0;

    // If no debounce requested, flush immediately
    if (debounceMs <= 0) {
      this.flush();
      return;
    }

    // Only schedule timers if there is something to send
    if (this._patches.length === 0) {
      return;
    }

    // Track the first patch time for maxWait enforcement
    if (this._firstPatchAt === null) {
      this._firstPatchAt = Date.now();
    }

    // Debounce timer (resets on each call)
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => this.flush(), debounceMs);

    // Max-wait absolute timer (fires once at firstPatch + maxWaitMs)
    if (maxWaitMs > 0 && this._maxWaitTimer === null && this._firstPatchAt) {
      const now = Date.now();
      const fireAt = this._firstPatchAt + maxWaitMs;
      const delay = Math.max(0, fireAt - now);
      this._maxWaitTimer = setTimeout(() => this.flush(), delay);
    }
  }

  public flush(): void {
    this._clearTimers();
    if (this._patches.length > 0) {
      // Optionally compress patches before sending
      if (
        this.compressThreshold !== null &&
        this._patches.length >= this.compressThreshold &&
        this._baseSnapshot !== null
      ) {
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
      this._emitIsSyncedChanged();
    }
    this._firstPatchAt = null;
    this._baseSnapshot = null;
  }

  private _clearTimers(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (this._maxWaitTimer) {
      clearTimeout(this._maxWaitTimer);
      this._maxWaitTimer = null;
    }
  }

  private _discardPendingPatches(): void {
    const hadPatches = this._patches.length > 0;
    this._clearTimers();
    if (hadPatches) {
      this._patches = [];
      this._emitIsSyncedChanged();
    }
    this._firstPatchAt = null;
    this._baseSnapshot = null;
  }

  public appendPatch(patches: ImmerPatch[], baseState?: unknown): void {
    const wasSynced = this._patches.length === 0;
    this._patches.push(...patches);
    if (this._firstPatchAt === null && patches.length > 0) {
      this._firstPatchAt = Date.now();
      if (
        baseState !== undefined &&
        typeof baseState === "object" &&
        baseState !== null
      ) {
        // capture base snapshot once for compression
        this._baseSnapshot = baseState as object;
      }
    }
    const isSynced = this._patches.length === 0;
    if (wasSynced !== isSynced) {
      this._emitIsSyncedChanged();
    }
  }

  // Compress Immer patches by re-applying them to the captured base and
  // re-emitting a minimal patch set for the net effect.
  private compressImmerPatches<S extends object>(
    baseState: S,
    patches: ImmerPatch[]
  ): ImmerPatch[] {
    let compressed: ImmerPatch[] = patches;
    // applyPatches mutates the draft to the final shape; Immer then emits a minimal patch set
    produce(
      baseState,
      (draft: Draft<S>) => {
        applyPatches(draft as unknown as S, patches);
      },
      (p: ImmerPatch[]) => {
        compressed = p;
      }
    );
    return compressed;
  }

  public sendAction(action: Action): void {
    this.flush();
    this.session.send(actionEvent(this.key), action);
  }

  public startTask(task: TaskStart): void {
    this.flush();
    this.session.send(taskStartEvent(this.key), task);
  }

  public cancelTask(task: TaskCancel): void {
    this.flush();
    this.session.send(taskCancelEvent(this.key), task);
  }

  public sendBinary(action: Action, data: ArrayBuffer): void {
    this.flush();
    this.session.sendBinary(actionEvent(this.key), action, data);
  }

  // fetch the remote state by sending _GET
  public fetchRemoteState(): void {
    this._discardPendingPatches();
    this.session.send(getEvent(this.key), {});
  }

  // send the full state via _SET
  public sendState<S>(state: S): void {
    this._discardPendingPatches();
    this.session.send(setEvent(this.key), state);
  }

  // Register session event handlers for a reducer-like consumer and return a cleanup function
  public registerHandlers<S>(
    getState: () => S,
    setState: (state: S) => void,
    patchState: (patch: JsonPatch[]) => void,
    actionHandler: (action: Action) => void
  ): () => void {
    // _GET triggers sending current full state
    this.session.registerEvent(getEvent(this.key), () =>
      this.sendState(getState())
    );
    // _SET replaces state
    this.session.registerEvent(setEvent(this.key), (s) => setState(s as S));
    // _PATCH applies a patch array
    this.session.registerEvent(patchEvent(this.key), (p) =>
      patchState(p as JsonPatch[])
    );
    // _ACTION routes to dynamic handlers first, else forwards to provided handler (usually dispatch)
    this.session.registerEvent(actionEvent(this.key), (a) => {
      const act = a as Action;
      const handler = this._actionHandlers.get(act.type);
      if (handler) {
        const payload: Record<string, unknown> = Object.fromEntries(
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
  public registerExposedActions<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Handlers extends Record<string, (...args: any[]) => void>
  >(handlers: Handlers): () => void {
    const registeredKeys: string[] = [];

    // add to global registry, error if already present
    for (const [key, fn] of Object.entries(handlers)) {
      if (this._actionHandlers.has(key)) {
        console.error(`[Sync] Attempt to re-register action handler: ${key}`);
        throw new Error(`action handler already registered for ${key}`);
      }
      // Store in the generic handler registry
      this._actionHandlers.set(key, ((payload: Record<string, unknown>) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (fn as any)(payload)) as (payload: Record<string, unknown>) => void);
      registeredKeys.push(key);
    }

    // return cleanup to deregister only the keys we added
    return () => {
      for (const key of registeredKeys) {
        this._actionHandlers.delete(key);
      }
    };
  }

  // React convenience: register/deregister within a useEffect
  public useExposedActions<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Handlers extends Record<string, (...args: any[]) => void>
  >(handlers: Handlers): void {
    useEffect(() => this.registerExposedActions(handlers), [this, handlers]);
  }

  // ======== syncing state subscription + hook ======== //
  private _subscribeIsSynced = (onStoreChange: () => void): (() => void) => {
    this._isSyncedSubscribers.add(onStoreChange);
    return () => {
      this._isSyncedSubscribers.delete(onStoreChange);
    };
  };

  private _emitIsSyncedChanged(): void {
    for (const cb of this._isSyncedSubscribers) {
      try {
        cb();
      } catch (err) {
        console.error("[Sync] error in isSynced subscriber", err);
      }
    }
  }

  // React convenience: returns true when no patches are pending to be flushed
  public useIsSynced(): boolean {
    return useSyncExternalStore(
      this._subscribeIsSynced,
      () => this._patches.length === 0,
      () => true
    );
  }

  // Create a set of delegator functions that forward to sendAction
  public createDelegators<
    KeyToParams extends object,
    NameToKey extends Record<string, keyof KeyToParams>
  >(nameToKey: NameToKey): Actions<NameToKey, KeyToParams>;
  public createDelegators<KeyToParams extends object>(): <
    NameToKey extends Record<string, keyof KeyToParams>
  >(
    nameToKey: NameToKey
  ) => Actions<NameToKey, KeyToParams>;
  public createDelegators<
    KeyToParams extends object,
    NameToKey extends Record<string, keyof KeyToParams>
  >(nameToKey?: NameToKey) {
    if (arguments.length === 0) {
      return (ntk: NameToKey) =>
        this.createDelegators<KeyToParams, NameToKey>(ntk);
    }
    const entries = Object.entries(nameToKey as NameToKey) as [
      string,
      keyof KeyToParams
    ][];
    const result = Object.fromEntries(
      entries.map(([localName, remoteKey]) => {
        const fn = (args?: Record<string, unknown> | null) => {
          if (args === null || args === undefined) {
            this.sendAction({ type: String(remoteKey) });
          } else {
            this.sendAction({ type: String(remoteKey), ...(args as object) });
          }
        };
        return [localName, fn];
      })
    );
    return result as Actions<NameToKey, KeyToParams>;
  }
}

export const setEvent = (key: string) => "_SET:" + key;
export const getEvent = (key: string) => "_GET:" + key;
export const patchEvent = (key: string) => "_PATCH:" + key;
export const actionEvent = (key: string) => "_ACTION:" + key;
export const taskStartEvent = (key: string) => "_TASK_START:" + key;
export const taskCancelEvent = (key: string) => "_TASK_CANCEL:" + key;
export type Action = {
  type: string;
} & Record<string, unknown>;

export type TaskStart = {
  type: string;
} & Record<string, unknown>;

export type TaskCancel = {
  type: string;
};

// utils
export const convertImmerPatchesToJsonPatch = (
  immerPatches: ImmerPatch[]
): JsonPatch[] => {
  //convert "Immer" patches to standard json patches
  return immerPatches.map((p) => {
    let stringPath: string = p.path.join("/");
    if (!stringPath.startsWith("/")) {
      stringPath = "/" + stringPath;
    }
    return {
      ...p,
      path: stringPath,
    } as JsonPatch;
  });
};

export const convertShallowUpdateToImmerPatch = (
  shallowUpdate: Record<string, unknown>
): ImmerPatch[] => {
  return Object.entries(shallowUpdate).map(([key, value]) => {
    return {
      op: "replace",
      path: [key],
      value: value,
    } as ImmerPatch;
  });
};
