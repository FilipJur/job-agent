import { useEffect, useRef } from "react";

/** The element a keystroke is typed into, if any: shortcuts must not fire there. */
function typingElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ? target : null;
}

type KeyHandler = (event: KeyboardEvent) => void;
type LeaderHandler = (key: string) => boolean;

const LEADER_MS = 1000;
const handlers = new Set<KeyHandler>();
let leader: LeaderHandler | null = null;
let leaderUntil = 0;

/**
 * The one window keydown listener of the app. It ignores modified keys, never fires while typing (Escape blurs
 * the field instead) and owns the `g <key>` leader sequence, so a view never sees the second key of `g h`.
 */
function onKeyDown(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const typing = typingElement(event.target);
  if (typing !== null) {
    if (event.key === "Escape") typing.blur();
    return;
  }
  if (leaderUntil > Date.now()) {
    leaderUntil = 0;
    if (leader?.(event.key)) event.preventDefault();
    return;
  }
  if (event.key === "g" && leader !== null && !event.repeat) {
    leaderUntil = Date.now() + LEADER_MS;
    return;
  }
  for (const handler of handlers) handler(event);
}

function subscribe(): () => void {
  if (handlers.size === 0 && leader === null) window.addEventListener("keydown", onKeyDown);
  return () => {
    if (handlers.size === 0 && leader === null) window.removeEventListener("keydown", onKeyDown);
  };
}

/** Subscribe a view's shortcut handler for as long as it is mounted; the latest closure is always used. */
export function useKeys(handler: KeyHandler): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const call: KeyHandler = (event) => latest.current(event);
    const unsubscribe = subscribe();
    handlers.add(call);
    return () => {
      handlers.delete(call);
      unsubscribe();
    };
  }, []);
}

/** `g <key>` sequences: `onKey` returns true when it consumed the key. Mount once, in the app shell. */
export function useLeaderKeys(onKey: LeaderHandler): void {
  const latest = useRef(onKey);
  latest.current = onKey;
  useEffect(() => {
    const call: LeaderHandler = (key) => latest.current(key);
    const unsubscribe = subscribe();
    leader = call;
    return () => {
      leader = null;
      unsubscribe();
    };
  }, []);
}
