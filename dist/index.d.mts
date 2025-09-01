import * as react_jsx_runtime from 'react/jsx-runtime';
import { Context } from 'react';
import { Operation } from 'fast-json-patch';
import { Patch } from 'immer';
import { StoreMutatorIdentifier, StateCreator } from 'zustand';

declare const DefaultSessionContext: Context<Session | null>;
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
    constructor(url: string, label?: string, toast?: any, binaryType?: BinaryType, minRetryInterval?: number, maxRetryInterval?: number);
    registerEvent(event: string, callback: (data: any) => void): void;
    deregisterEvent(event: string): void;
    registerInit(key: string, callback: () => void): void;
    deregisterInit(key: string): void;
    registerBinary(callback: (data: any) => void): void;
    deregisterBinary(): void;
    send(event: string, data: any): void;
    sendBinary(event: string, metadata: any, data: ArrayBuffer): void;
    connect(): () => void;
    disconnect(): void;
    handleReceiveEvent(e: MessageEvent): void;
}

interface SyncParams {
    debounceMs?: number;
}
declare class Sync$2 {
    readonly key: string;
    sendOnInit: boolean;
    readonly session: Session;
    private _patches;
    private _lastSyncTime;
    get lastSyncTime(): number;
    constructor(key: string, session: Session, sendOnInit?: boolean);
    sync(): void;
    appendPatch(patches: Patch[]): void;
    sendAction(action: Action): void;
    startTask(task: TaskStart): void;
    cancelTask(task: TaskCancel): void;
    sendBinary(action: Action, data: ArrayBuffer): void;
    fetchRemoteState(): void;
    sendState(state: unknown): void;
    registerHandlers<S>(getState: () => S, setState: (state: S) => void, patchState: (patch: Operation[]) => void, actionHandler: (action: Action) => void): () => void;
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
interface SyncOptions {
    key: string;
    session: Session;
    sendOnInit?: boolean;
}
type Sync = Sync$2 & {
    (params?: SyncParams): void;
    delegate: any;
};
type Synced = <State, Mps extends [StoreMutatorIdentifier, unknown][] = [], // store mutators from parent middlewares
Mcs extends [StoreMutatorIdentifier, unknown][] = []>(stateCreator: StateCreator<State, [...Mps, ["sync", Sync]], Mcs>, // forward the mutators from our parent middlewares along with our mutation to the child middleware
syncOptions: SyncOptions) => StateCreator<State, Mps, [["sync", Sync], ...Mcs]>;
declare module "zustand" {
    interface StoreMutators<S, A> {
        sync: Write<Cast<S, object>, {
            sync: A;
        }>;
    }
}
declare const synced: Synced;

export { type Action, DefaultSessionContext, type Delegate, Session, SessionProvider, type StateWithFetch, type StateWithSync, type Sync$1 as Sync, type SyncOptions, type SyncedReducer, type TaskCancel, type TaskStart, synced, useObserved, useRemoteToast, useSynced, useSyncedReducer };
