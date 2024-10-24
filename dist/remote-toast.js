"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useRemoteToast = void 0;
const react_1 = require("react");
// remote toast handler
const useRemoteToast = (session, toast, prefix = "") => {
    (0, react_1.useEffect)(() => {
        session === null || session === void 0 ? void 0 : session.registerEvent("_TOAST", ({ message, type }) => {
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
        });
        return () => session === null || session === void 0 ? void 0 : session.deregisterEvent("_TOAST");
    }, []);
};
exports.useRemoteToast = useRemoteToast;
