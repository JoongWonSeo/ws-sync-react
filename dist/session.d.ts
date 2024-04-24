import { Context } from 'react';
export declare const DefaultSessionContext: Context<Session | null>;
interface SessionProviderProps {
    url: string;
    label?: string;
    children: React.ReactNode;
    context?: Context<Session | null>;
    autoconnect?: boolean;
    wsAuth?: boolean;
    toast?: any;
}
export declare const SessionProvider: ({ url, label, toast, children, context, autoconnect, wsAuth }: SessionProviderProps) => import("react/jsx-runtime").JSX.Element;
export declare class Session {
    url: string;
    label: string;
    ws: WebSocket | null;
    isConnected: boolean;
    onConnectionChange?: ((arg0: boolean) => void);
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
    constructor(url: string, label?: string, toast?: any, minRetryInterval?: number, maxRetryInterval?: number);
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
export {};
