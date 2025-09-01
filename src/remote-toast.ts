import { useEffect } from "react";
import { Session } from "./session";

export interface Toast {
  (message: string): void;
  message: (message: string) => void;
  success: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
  error: (message: string) => void;
}

// remote toast handler
export const useRemoteToast = (
  session: Session | null,
  toast: Toast,
  prefix: string = ""
) => {
  useEffect(() => {
    session?.registerEvent(
      "_TOAST",
      ({ message, type }: { message: string; type: string }) => {
        switch (type) {
          case "default":
            toast(prefix + message);
            break;
          case "message":
            toast.message(prefix + message);
            break;
          case "success":
            toast.success(prefix + message);
            break;
          case "info":
            toast.info(prefix + message);
            break;
          case "warning":
            toast.warning(prefix + message);
            break;
          case "error":
            toast.error(prefix + message);
            break;
          default:
            toast(prefix + message);
        }
      }
    );
    return () => {
      session?.deregisterEvent("_TOAST");
    };
  }, [session, toast, prefix]);
};
