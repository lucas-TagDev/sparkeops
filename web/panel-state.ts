import { useState } from "react";
export function usePanelState(key: string) {
  const storageKey = "foxops-panel:" + key;
  const [state, setState] = useState(() => ({
    key: storageKey,
    open: read(storageKey),
  }));
  const open = state.key === storageKey ? state.open : read(storageKey);
  const setOpen = (value: boolean) => {
    setState({ key: storageKey, open: value });
    try {
      localStorage.setItem(storageKey, value ? "open" : "closed");
    } catch {
      /* Storage may be disabled. */
    }
  };
  return [open, setOpen] as const;
}
function read(key: string) {
  try {
    return localStorage.getItem(key) === "open";
  } catch {
    return false;
  }
}
