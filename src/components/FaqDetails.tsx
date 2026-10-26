"use client";

import { useId, useState, type ReactNode } from "react";

// Native disclosure controls work before JavaScript arrives. Hydrate from the browser's
// current open state so an early click is preserved rather than reset to the server default.
export function FaqDetails({ initiallyOpen = false, children }: { initiallyOpen?: boolean; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(() => {
    if (typeof document === "undefined") return initiallyOpen;
    return document.getElementById(id)?.hasAttribute("open") ?? initiallyOpen;
  });
  return <details id={id} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>{children}</details>;
}
