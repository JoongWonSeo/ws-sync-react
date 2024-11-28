import { Session } from "./session";
export type Action = {
    type: string;
} & Record<string, any>;
export type TaskStart = {
    type: string;
} & Record<string, any>;
export type TaskCancel = {
    type: string;
};
export type Sync<S> = () => void;
export type Delegate = (actionOverride?: Action) => void;
export type SyncedReducer<S> = (draft: S, action: Action, sync: Sync<S>, delegate: Delegate) => S | void;
type StateWithSync<S> = S & {
    fetchRemoteState: () => void;
    sendAction: (action: Action) => void;
    startTask: (task: TaskStart) => void;
    cancelTask: (task: TaskCancel) => void;
    sendBinary: (action: Action, data: ArrayBuffer) => void;
};
export declare function useSyncedReducer<S>(key: string, syncedReducer: SyncedReducer<S> | undefined, initialState: S, overrideSession?: Session | null, sendOnInit?: boolean): [StateWithSync<S>, (action: Action) => void];
export declare function useSynced<S>(key: string, initialState: S, overrideSession?: Session | null, sendOnInit?: boolean): StateWithSync<S>;
export {};
