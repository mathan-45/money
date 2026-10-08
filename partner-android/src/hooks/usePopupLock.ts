import { useEffect, useRef } from "react";
import { App as CapApp } from "@capacitor/app";

// Open popups: last one in the list is the top-most popup
const closeStack: Array<() => void> = [];
let lockCount = 0;
let listenerAdded = false;

function ensureBackListener() {
  if (listenerAdded) return;
  listenerAdded = true;
  try {
    CapApp.addListener("backButton", ({ canGoBack }) => {
      const top = closeStack[closeStack.length - 1];
      if (top) {
        top(); // close the popup only, app stays open
      } else if (canGoBack) {
        window.history.back();
      } else {
        CapApp.exitApp();
      }
    });
  } catch {
    // not running inside Capacitor (browser), ignore
  }
}

export function usePopupLock(isOpen: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    ensureBackListener();

    const handler = () => closeRef.current();
    closeStack.push(handler);
    lockCount++;
    if (lockCount === 1) document.body.style.overflow = "hidden";

    return () => {
      const i = closeStack.indexOf(handler);
      if (i >= 0) closeStack.splice(i, 1);
      lockCount--;
      if (lockCount === 0) document.body.style.overflow = "";
    };
  }, [isOpen]);
}