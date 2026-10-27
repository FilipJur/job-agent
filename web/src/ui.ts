/** Class strings shared by several components; everything else is styled inline with utilities. */

export const control =
  "h-8 rounded-md border border-line bg-raised px-2.5 text-sm text-fg transition-colors hover:border-line-strong focus-visible:border-signal disabled:opacity-50";

export const linkButton = "text-sm text-fg underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-signal";

export const primaryButton =
  "inline-flex h-8 items-center justify-center rounded-md bg-signal px-3 text-sm font-semibold text-bg no-underline transition hover:brightness-110 active:brightness-95 disabled:opacity-50";

/** Flat toggle; the pressed state inverts to white-on-graphite instead of tinting. */
export const token =
  "rounded-sm px-1.5 py-0.5 text-sm text-muted transition-colors hover:text-fg aria-pressed:bg-fg aria-pressed:text-bg";

/** Inline row of facts separated by middots. */
export const meta =
  "flex flex-wrap items-center gap-x-2 text-sm text-muted [&>span+span]:before:mr-2 [&>span+span]:before:text-faint [&>span+span]:before:content-['·']";

export const fieldLabel = "text-xs text-faint";
