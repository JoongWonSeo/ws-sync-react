import { useState, useEffect, useCallback } from "react";

// Define the storage hooks locally
function useStorage<T>(
  storageType: "localStorage" | "sessionStorage",
  key: string,
  initialValue: T | (() => T)
): [T, (value: T | ((val: T) => T)) => void] {
  const storage = window[storageType];

  const readValue = useCallback((): T => {
    // Prevent build errors during server-side rendering
    if (typeof window === "undefined") {
      return initialValue instanceof Function ? initialValue() : initialValue;
    }

    try {
      const item = storage.getItem(key);
      if (item) {
        return JSON.parse(item);
      }
    } catch (error) {
      console.warn(`Error reading ${storageType} key “${key}”:`, error);
    }
    // Return initialValue if no item found or error occurred
    return initialValue instanceof Function ? initialValue() : initialValue;
  }, [key, initialValue, storageType, storage]);

  const [storedValue, setStoredValue] = useState<T>(readValue);

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      // Prevent build errors during server-side rendering
      if (typeof window === "undefined") {
        console.warn(
          `Tried setting ${storageType} key “${key}” even though environment is not a client`
        );
        return;
      }

      try {
        // Allow value to be a function so we have the same API as useState
        const valueToStore =
          value instanceof Function ? value(storedValue) : value;
        // Save state
        setStoredValue(valueToStore);
        // Save to storage
        storage.setItem(key, JSON.stringify(valueToStore));
      } catch (error) {
        console.warn(`Error setting ${storageType} key “${key}”:`, error);
      }
    },
    [key, storedValue, storageType, storage]
  );

  // Read latest value from storage on hook mount
  useEffect(() => {
    setStoredValue(readValue());
  }, []);

  // Listen for changes to the same key from other tabs/windows
  useEffect(() => {
    // Prevent build errors during server-side rendering
    if (typeof window === "undefined") {
      return;
    }

    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea === storage && event.key === key) {
        try {
          setStoredValue(
            event.newValue ? JSON.parse(event.newValue) : initialValue
          );
        } catch (error) {
          console.warn(`Error parsing storage change for key “${key}”:`, error);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [key, initialValue, storage, readValue]); // Include readValue in deps

  return [storedValue, setValue];
}

export function useLocalStorage<T>(
  key: string,
  initialValue: T | (() => T)
): [T, (value: T | ((val: T) => T)) => void] {
  return useStorage("localStorage", key, initialValue);
}

export function useSessionStorage<T>(
  key: string,
  initialValue: T | (() => T)
): [T, (value: T | ((val: T) => T)) => void] {
  return useStorage("sessionStorage", key, initialValue);
}
