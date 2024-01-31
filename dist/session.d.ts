import { Context } from 'react';
export declare const DefaultSessionContext: Context<Session | null>;
interface SessionProviderProps {
    url: string;
    children: React.ReactNode;
    context: Context<Session | null>;
    autoconnect?: boolean;
    wsAuth?: boolean;
}
export declare const SessionProvider: ({ url, children, context, autoconnect, wsAuth }: SessionProviderProps) => import("react/jsx-runtime").JSX.Element;
export declare class Session {
    url: string;
    ws: WebSocket | null;
    isConnected: boolean;
    onConnectionChange?: ((arg0: boolean) => void);
    minRetryInterval: number;
    maxRetryInterval: number;
    retryInterval: number;
    private eventHandlers;
    private initHandlers;
    private binaryHandler;
    private retryTimeout;
    private autoReconnect;
    constructor(url: string, minRetryInterval?: number, maxRetryInterval?: number);
    registerEvent(event: string, callback: (data: any) => void): void;
    deregisterEvent(event: string): void;
    registerInit(key: string, callback: () => void): void;
    deregisterInit(key: string): void;
    registerBinary(callback: (data: any) => void): void;
    deregisterBinary(): void;
    send(event: string, data: any): void;
    connect(): () => void;
    disconnect(): void;
    handleReceiveEvent(e: MessageEvent): void;
}
export {};
