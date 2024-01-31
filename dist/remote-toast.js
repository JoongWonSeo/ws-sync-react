"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useRemoteToast = void 0;
const react_1 = require("react");
const sonner_1 = require("sonner");
// remote toast handler
const useRemoteToast = (session, prefix = "") => {
    (0, react_1.useEffect)(() => {
        session === null || session === void 0 ? void 0 : session.registerEvent("_TOAST", ({ message, type }) => {
            switch (type) {
                case 'default':
                    (0, sonner_1.toast)(prefix + message);
                    break;
                case 'message':
                    sonner_1.toast.message(prefix + message);
                    break;
                case 'success':
                    sonner_1.toast.success(prefix + message);
                    break;
                case 'info':
                    sonner_1.toast.info(prefix + message);
                    break;
                case 'warning':
                    sonner_1.toast.warning(prefix + message);
                    break;
                case 'error':
                    sonner_1.toast.error(prefix + message);
                    break;
                default:
                    (0, sonner_1.toast)(prefix + message);
            }
        });
        return () => session === null || session === void 0 ? void 0 : session.deregisterEvent("_TOAST");
    }, []);
};
exports.useRemoteToast = useRemoteToast;
