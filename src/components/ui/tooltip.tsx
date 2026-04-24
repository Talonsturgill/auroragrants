"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Lightweight tooltip primitive built on the HTML `title` attribute plus a
 * visual popover for pointer users. We intentionally avoid adding
 * `@radix-ui/react-tooltip` (not yet in package.json) and instead render
 * an aria-described popover that shows on hover or keyboard focus.
 *
 * The tooltip is exposed to screen readers through `aria-describedby` on
 * the trigger plus a hidden live description. For browsers without JS,
 * the `title` attribute provides a fallback.
 *
 * This is a deliberately small surface. If the product ever needs rich
 * placement logic (collisions, arrows), swap in the Radix primitive and
 * keep this API.
 */

interface TooltipProps {
  /** The element that receives hover/focus (rendered as a wrapper span). */
  children: React.ReactNode;
  /** Tooltip body. Shown on hover/focus. */
  content: React.ReactNode;
  /** Accessible plain-text version of `content` for screen readers. */
  ariaLabel?: string;
  /** Optional class passed to the wrapper. */
  className?: string;
  /** Optional class passed to the popover. */
  contentClassName?: string;
  /** Default open state for testing and SSR. */
  defaultOpen?: boolean;
}

let tooltipIdCounter = 0;
function useTooltipId(): string {
  // Stable id per mount. Using useId would be fine too; this keeps
  // server/client ids identical in tests without React.useId SSR footgun.
  const [id] = React.useState(() => {
    tooltipIdCounter += 1;
    return `tooltip-${tooltipIdCounter}`;
  });
  return id;
}

export function Tooltip({
  children,
  content,
  ariaLabel,
  className,
  contentClassName,
  defaultOpen = false,
}: TooltipProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = useTooltipId();

  const labelText = ariaLabel ?? (typeof content === "string" ? content : "");

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={id} aria-label={labelText || undefined}>
        {children}
      </span>
      <span
        role="tooltip"
        id={id}
        data-state={open ? "open" : "closed"}
        className={cn(
          "pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-max max-w-xs -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md transition-opacity",
          open ? "opacity-100" : "opacity-0",
          contentClassName,
        )}
      >
        {content}
      </span>
    </span>
  );
}
