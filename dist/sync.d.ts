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
type Capitalize<S extends string> = S extends `${infer F}${infer R}` ? `${Uppercase<F>}${R}` : S;
type SetterMethodNames<T> = {
    [K in keyof T as `set${Capitalize<string & K>}`]: (value: T[K]) => void;
};
type SyncerMethodNames<T> = {
    [K in keyof T as `sync${Capitalize<string & K>}`]: (value: T[K]) => void;
};
export type Sync<S> = () => void;
export type Delegate = (actionOverride?: Action) => void;
export type SyncedReducer<S> = (draft: S, action: Action, sync: Sync<S>, delegate: Delegate) => S | void;
type StateWithSync<S> = S & SetterMethodNames<S> & SyncerMethodNames<S> & {
    fetchRemoteState: () => void;
    sendAction: (action: Action) => void;
    startTask: (task: TaskStart) => void;
    cancelTask: (task: TaskCancel) => void;
    sendBinary: (action: Action, data: ArrayBuffer) => void;
};
export declare function useSyncedReducer<S extends Record<string, any>>(key: string, syncedReducer: SyncedReducer<S> | undefined, initialState: S, overrideSession?: Session | null, sendOnInit?: boolean): [StateWithSync<S>, (action: Action) => void];
export declare function useSynced<S extends Record<string, any>>(key: string, initialState: S, overrideSession?: Session | null, sendOnInit?: boolean): StateWithSync<S>;
type StateWithFetch<S> = S & {
    fetchRemoteState: () => void;
};
export declare function useObserved<S extends Record<string, any>>(key: string, initialState: S, overrideSession?: Session | null): StateWithFetch<S>;
export {};
