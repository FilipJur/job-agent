/** Class strings shared by several components; everything else is styled inline with utilities. */

export const control =
  "h-9 rounded-lg border border-line bg-raised px-3 text-sm text-fg transition-colors hover:border-muted/60 focus-visible:border-accent disabled:opacity-50";

export const linkButton =
  "text-sm text-accent underline decoration-accent/40 underline-offset-4 transition-colors hover:decoration-accent";

export const primaryButton =
  "inline-flex h-9 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-bg no-underline transition hover:brightness-110 active:brightness-95 disabled:opacity-50";

/** Pill button that reads `aria-pressed`. */
export const pill =
  "rounded-full border border-line px-3 py-1 text-sm text-fg/85 transition-colors hover:border-muted/70 aria-pressed:border-accent aria-pressed:bg-accent/15 aria-pressed:text-accent";

/** Inline row of facts separated by middots. */
export const meta =
  "flex flex-wrap items-center gap-x-2 text-sm text-muted [&>span+span]:before:mr-2 [&>span+span]:before:text-muted/50 [&>span+span]:before:content-['·']";
