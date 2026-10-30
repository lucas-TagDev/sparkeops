import type { ComponentProps } from "react";
import { usePanelState } from "./panel-state.ts";
export function PersistentDetails({
  storageKey,
  onToggle,
  ...props
}: Omit<ComponentProps<"details">, "open"> & { storageKey: string }) {
  const [open, setOpen] = usePanelState(storageKey);
  return (
    <details
      {...props}
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        onToggle?.(event);
      }}
    />
  );
}
