export declare function useLocalStorage<T>(key: string, initialValue: T | (() => T)): [T, (value: T | ((val: T) => T)) => void];
export declare function useSessionStorage<T>(key: string, initialValue: T | (() => T)): [T, (value: T | ((val: T) => T)) => void];
