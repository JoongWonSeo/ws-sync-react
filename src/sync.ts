import { Operation as JsonPatch } from "fast-json-patch";
import { Patch as ImmerPatch } from "immer";
import { Session } from "./session";

// parameters for the `sync()` operation
export interface SyncParams {
  debounceMs?: number;
}

export class Sync {
  readonly key: string;
  public sendOnInit: boolean;
  readonly session: Session;
  private _patches: ImmerPatch[] = []; // currently unsynced local changes
  private _lastSyncTime: number = 0; // timestamp of last sync

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
  public sync(): void {
    // TODO: debounce logic: queue the sync

    // send the patches to the server and flush
    if (this._patches.length > 0) {
      this.session.send(
        patchEvent(this.key),
        convertImmerPatchesToJsonPatch(this._patches)
      );
      this._lastSyncTime = Date.now();
      this._patches = [];
    }
  }

  public appendPatch(patches: ImmerPatch[]): void {
    this._patches.push(...patches);
  }

  public sendAction(action: Action): void {
    this.session.send(actionEvent(this.key), action);
  }

  public startTask(task: TaskStart): void {
    this.session.send(taskStartEvent(this.key), task);
  }

  public cancelTask(task: TaskCancel): void {
    this.session.send(taskCancelEvent(this.key), task);
  }

  public sendBinary(action: Action, data: ArrayBuffer): void {
    this.session.sendBinary(actionEvent(this.key), action, data);
  }

  // fetch the remote state by sending _GET
  public fetchRemoteState(): void {
    this.session.send(getEvent(this.key), {});
  }

  // send the full state via _SET
  public sendState(state: unknown): void {
    this.session.send(setEvent(this.key), state as any);
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
    this.session.registerEvent(setEvent(this.key), (s: any) =>
      setState(s as S)
    );
    // _PATCH applies a patch array
    this.session.registerEvent(patchEvent(this.key), (p: any) =>
      patchState(p as JsonPatch[])
    );
    // _ACTION forwards to provided handler (usually dispatch)
    this.session.registerEvent(actionEvent(this.key), (a: any) =>
      actionHandler(a as Action)
    );

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
