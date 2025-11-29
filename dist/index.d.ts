import * as react_jsx_runtime from 'react/jsx-runtime';
import { Context } from 'react';
import { Operation } from 'fast-json-patch';
import { Patch, Draft } from 'immer';
import { StoreMutatorIdentifier, StateCreator } from 'zustand/vanilla';

declare const DefaultSessionContext: Context<Session | null>;
interface SessionOptions {
    url: string;
    label?: string;
    toast?: any;
    binaryType?: BinaryType;
    minRetryInterval?: number;
    maxRetryInterval?: number;
    override?: boolean;
}
interface SessionProviderProps {
    url: string;
    label?: string;
    children: React.ReactNode;
    context?: Context<Session | null>;
    autoconnect?: boolean;
    wsAuth?: boolean;
    toast?: any;
    binaryType?: BinaryType;
}
declare const SessionProvider: ({ url, label, toast, children, context, autoconnect, wsAuth, binaryType, }: SessionProviderProps) => react_jsx_runtime.JSX.Element;
declare class Session {
    url: string;
    label: string;
    ws: WebSocket | null;
    binaryType: BinaryType;
    isConnected: boolean;
    onConnectionChange?: (isConnected: boolean) => void;
    minRetryInterval: number;
    maxRetryInterval: number;
    retryInterval: number;
    toast: any;
    private eventHandlers;
    private initHandlers;
    private binaryHandler;
    private binData;
    private retryTimeout;
    private autoReconnect;
    private defaultOverride;
    constructor(options: SessionOptions);
    registerEvent(event: string, callback: (data: any) => void, override?: boolean): void;
    deregisterEvent(event: string): void;
    registerInit(key: string, callback: () => void, override?: boolean): void;
    deregisterInit(key: string): void;
    registerBinary(callback: (data: any) => void, override?: boolean): void;
    deregisterBinary(): void;
    send(event: string, data: any): void;
    sendBinary(event: string, metadata: any, data: ArrayBuffer): void;
    connect(): () => void;
    disconnect(): void;
    handleReceiveEvent(e: MessageEvent): void;
}

type Empty = Record<string, never>;
/**
 * Utility type that creates action functions from a mapping of action names to parameter types.
 *
 * @template NameToKey - Maps action names to parameter type keys
 * @template KeyToParams - Maps parameter type keys to their actual parameter types
 *
 * @example
 * ```typescript
 *
 * type ActionsKeys = {
 *   select: 'SELECT_NOTE';
 *   clear: 'CLEAR_SELECTION';
 * };
 * type ActionsParams = {
 *   SELECT_NOTE: { id: string };
 *   CLEAR_SELECTION: null;
 * };
 *
 * type MyActions = Actions<ActionsKeys, ActionsParams>;
 * // Result: {
 * //   select: (args: { id: string }) => void;
 * //   clear: () => void;
 * // }
 * ```
 */
type Actions<NameToKey extends {
    [N in keyof NameToKey]: keyof KeyToParams;
}, KeyToParams> = {
    [N in keyof NameToKey]: KeyToParams[NameToKey[N]] extends null ? (empty?: Empty) => void : (args: KeyToParams[NameToKey[N]]) => void;
};
/**
 * Utility type that creates task control objects with start/cancel methods.
 *
 * @template NameToKey - Maps task names to parameter type keys
 * @template KeyToParams - Maps parameter type keys to their actual parameter types
 *
 * @example
 * ```typescript
 * type TasksKeys = {
 *   export: 'EXPORT_DATA';
 *   import: 'IMPORT_DATA';
 * };
 * type TasksParams = {
 *   EXPORT_DATA: { format: string };
 *   IMPORT_DATA: { file: string };
 * };
 *
 * type MyTasks = Tasks<TasksKeys, TasksParams>;
 * // Result: {
 * //   export: {
 * //     start: (args: { format: string }) => void;
 * //     cancel: () => void;
 * //   };
 * //   import: {
 * //     start: (args: { file: string }) => void;
 * //     cancel: () => void;
 * //   };
 * // }
 * ```
 */
type Tasks<NameToKey extends {
    [N in keyof NameToKey]: keyof KeyToParams;
}, KeyToParams> = {
    [N in keyof NameToKey]: {
        start: KeyToParams[NameToKey[N]] extends null ? (empty?: Empty) => void : (args: KeyToParams[NameToKey[N]]) => void;
        cancel: () => void;
    };
};

interface SyncParams {
    debounceMs?: number;
    maxWaitMs?: number;
}
declare class Sync$2 {
    readonly key: string;
    sendOnInit: boolean;
    readonly session: Session;
    private _patches;
    private _lastSyncTime;
    private _actionHandlers;
    private _debounceTimer;
    private _maxWaitTimer;
    private _firstPatchAt;
    private _baseSnapshot;
    private _isSyncedSubscribers;
    compressThreshold: number | null;
    get lastSyncTime(): number;
    constructor(key: string, session: Session, sendOnInit?: boolean);
    sync(params?: SyncParams): void;
    flush(): void;
    private _clearTimers;
    private _discardPendingPatches;
    appendPatch(patches: Patch[], baseState?: unknown): void;
    private compressImmerPatches;
    sendAction(action: Action): void;
    startTask(task: TaskStart): void;
    cancelTask(task: TaskCancel): void;
    sendBinary(action: Action, data: ArrayBuffer): void;
    fetchRemoteState(): void;
    sendState<S>(state: S): void;
    registerHandlers<S>(getState: () => S, setState: (state: S) => void, patchState: (patch: Operation[]) => void, actionHandler: (action: Action) => void): () => void;
    registerExposedActions<Handlers extends Record<string, (...args: any[]) => void>>(handlers: Handlers): () => void;
    useExposedActions<Handlers extends Record<string, (...args: any[]) => void>>(handlers: Handlers): void;
    private _subscribeIsSynced;
    private _emitIsSyncedChanged;
    useIsSynced(): boolean;
    createDelegators<KeyToParams extends object, NameToKey extends Record<string, keyof KeyToParams>>(nameToKey: NameToKey): Actions<NameToKey, KeyToParams>;
    createDelegators<KeyToParams extends object>(): <NameToKey extends Record<string, keyof KeyToParams>>(nameToKey: NameToKey) => Actions<NameToKey, KeyToParams>;
    createTaskDelegators<KeyToParams extends object, NameToKey extends Record<string, keyof KeyToParams>>(nameToKey: NameToKey): Tasks<NameToKey, KeyToParams>;
    createTaskDelegators<KeyToParams extends object>(): <NameToKey extends Record<string, keyof KeyToParams>>(nameToKey: NameToKey) => Tasks<NameToKey, KeyToParams>;
}
type Action = {
    type: string;
} & Record<string, unknown>;
type TaskStart = {
    type: string;
} & Record<string, unknown>;
type TaskCancel = {
    type: string;
};

type Capitalize<S extends string> = S extends `${infer F}${infer R}` ? `${Uppercase<F>}${R}` : S;
type SetterMethodNames<T> = {
    [K in keyof T as `set${Capitalize<string & K>}`]: (value: T[K]) => void;
};
type SyncerMethodNames<T> = {
    [K in keyof T as `sync${Capitalize<string & K>}`]: (value: T[K]) => void;
};
type Sync$1 = () => void;
type Delegate = (actionOverride?: Action) => void;
type SyncedReducer<S> = (draft: S, action: Action, sync: Sync$1, delegate: Delegate) => S | void;
type StateWithSync<S> = S & SetterMethodNames<S> & SyncerMethodNames<S> & {
    fetchRemoteState: () => void;
    sendState: (state: S) => void;
    sendAction: (action: Action) => void;
    startTask: (task: TaskStart) => void;
    cancelTask: (task: TaskCancel) => void;
    sendBinary: (action: Action, data: ArrayBuffer) => void;
};
declare function useSyncedReducer<S extends Record<string, unknown>>(key: string, syncedReducer: SyncedReducer<S> | undefined, initialState: S, overrideSession?: Session | null, sendOnInit?: boolean): [StateWithSync<S>, (action: Action) => void];
declare function useSynced<S extends Record<string, unknown>>(key: string, initialState: S, overrideSession?: Session | null, sendOnInit?: boolean): StateWithSync<S>;
type StateWithFetch<S> = S & {
    fetchRemoteState: () => void;
};
declare function useObserved<S extends Record<string, unknown>>(key: string, initialState: S, overrideSession?: Session | null): StateWithFetch<S>;

declare const useRemoteToast: (session: Session | null, toast: any, prefix?: string) => void;

type Write<T extends object, U extends object> = Omit<T, keyof U> & U;
type Cast<T, U> = T extends U ? T : U;
type SkipTwo<T> = T extends {
    length: 0;
} ? [] : T extends {
    length: 1;
} ? [] : T extends {
    length: 0 | 1;
} ? [] : T extends [unknown, unknown, ...infer A] ? A : T extends [unknown, unknown?, ...infer A] ? A : T extends [unknown?, unknown?, ...infer A] ? A : never;
type SetStateType<T extends unknown[]> = Exclude<T[0], (...args: any[]) => any>;
type StoreImmer<S> = S extends {
    setState: infer SetState;
} ? SetState extends {
    (...args: infer A1): infer Sr1;
    (...args: infer A2): infer Sr2;
} ? {
    setState(nextStateOrUpdater: SetStateType<A2> | Partial<SetStateType<A2>> | ((state: Draft<SetStateType<A2>>) => void), shouldReplace?: false, ...args: SkipTwo<A1>): Sr1;
    setState(nextStateOrUpdater: SetStateType<A2> | ((state: Draft<SetStateType<A2>>) => void), shouldReplace: true, ...args: SkipTwo<A2>): Sr2;
} : never : never;
interface SyncOptions {
    key: string;
    session: Session;
    sendOnInit?: boolean;
    syncAttributes?: string[] | Record<string, unknown>;
}
type CreateDelegatorsFn = {
    <KeyToParams extends object>(): <NameToKey extends Record<string, keyof KeyToParams>>(nameToKey: NameToKey) => Actions<NameToKey, KeyToParams>;
    <KeyToParams extends object, NameToKey extends Record<string, keyof KeyToParams>>(nameToKey: NameToKey): Actions<NameToKey, KeyToParams>;
};
type CreateTaskDelegatorsFn = {
    <KeyToParams extends object>(): <NameToKey extends Record<string, keyof KeyToParams>>(nameToKey: NameToKey) => Tasks<NameToKey, KeyToParams>;
    <KeyToParams extends object, NameToKey extends Record<string, keyof KeyToParams>>(nameToKey: NameToKey): Tasks<NameToKey, KeyToParams>;
};
type Sync = {
    obj: Sync$2;
    cleanup: () => void;
    (params?: SyncParams): void;
    createDelegators: CreateDelegatorsFn;
    createTaskDelegators: CreateTaskDelegatorsFn;
    sendAction: (action: Action) => void;
    startTask: (task: TaskStart) => void;
    cancelTask: (task: TaskCancel) => void;
    sendBinary: (action: Action, data: ArrayBuffer) => void;
    fetchRemoteState: () => void;
    sendState: <S>(state: S) => void;
    registerExposedActions: <Handlers extends Record<string, (...args: any[]) => void>>(handlers: Handlers) => () => void;
    useExposedActions: <Handlers extends Record<string, (...args: any[]) => void>>(handlers: Handlers) => void;
    useIsSynced: () => boolean;
};
type Synced = <State, Mps extends [StoreMutatorIdentifier, unknown][] = [], // store mutators from parent middlewares
Mcs extends [StoreMutatorIdentifier, unknown][] = []>(stateCreator: StateCreator<State, [...Mps, ["sync", Sync]], Mcs>, // forward the mutators from our parent middlewares along with our mutation to the child middleware
syncOptions: SyncOptions) => StateCreator<State, Mps, [["sync", Sync], ...Mcs]>;
declare module "zustand/vanilla" {
    interface StoreMutators<S, A> {
        sync: Write<Cast<S, object>, {
            sync: A;
        }> & StoreImmer<S>;
    }
}
declare const synced: Synced;

export { type Action, type Actions, DefaultSessionContext, type Delegate, Session, SessionProvider, type StateWithFetch, type StateWithSync, type Sync$1 as Sync, type SyncOptions, type SyncedReducer, type TaskCancel, type TaskStart, type Tasks, synced, useObserved, useRemoteToast, useSynced, useSyncedReducer };
