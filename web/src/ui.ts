/** Class strings shared by several components; everything else is styled inline with utilities. */

export const control =
  "h-8 border border-line bg-bg px-2 text-sm text-fg transition-colors hover:border-line-strong focus-visible:border-signal disabled:opacity-50";

/** Wrapper that draws a ▾ over an appearance-none select. */
export const selectWrap = "relative inline-flex after:pointer-events-none after:absolute after:top-1/2 after:right-2 after:-translate-y-1/2 after:text-faint after:content-['▾']";

export const selectControl = "appearance-none pr-6";

export const linkButton = "text-sm text-fg underline decoration-line-strong underline-offset-4 transition-colors hover:text-signal hover:decoration-signal";

/** Inverse video: the one filled button. */
export const primaryButton =
  "inline-flex h-8 items-center justify-center bg-signal px-3 text-xs font-semibold tracking-[0.12em] text-bg uppercase no-underline transition-colors hover:bg-fg hover:text-bg disabled:opacity-50";

/** Checkbox-style toggle; pair with the `cb` utility. */
export const checkbox = "text-sm text-muted transition-colors hover:text-fg aria-pressed:text-fg";

/** Radio-style choice; pair with the `rb` utility. */
export const radio = "text-sm text-muted transition-colors hover:text-fg aria-pressed:text-fg";

/** Inline row of facts separated by a thin bar. */
export const meta =
  "flex flex-wrap items-center gap-x-2 text-sm text-muted [&>span:not(:last-child)]:after:ml-2 [&>span:not(:last-child)]:after:text-line-strong [&>span:not(:last-child)]:after:content-['│']";

/** Chrome label: tiny, tracked, uppercase. Short text only. */
export const fieldLabel = "text-[0.75rem] font-medium tracking-[0.16em] text-faint uppercase";

/** Inline tag (source, verdict, fit): same voice as labels, a touch tighter. */
export const tag = "text-[0.75rem] font-medium tracking-[0.12em] uppercase";

/** Commentary voice: the model's remarks, quotes, hints. Italic is reserved for this. */
export const note = "italic";

/** Verdict and action buttons: a 44 px hit area on phones and touch screens, text-sized with a mouse. */
export const touchTarget =
  "max-sm:inline-flex max-sm:min-h-11 max-sm:min-w-11 max-sm:items-center max-sm:gap-[1ch] max-sm:pr-3 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center pointer-coarse:gap-[1ch] pointer-coarse:pr-3";

/** Row of box-drawing characters used as a horizontal rule; clipped, never wraps. */
export const RULE = "─".repeat(300);
