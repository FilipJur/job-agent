import { formatDateTime } from "./format";

/** "offline — data z <čas>": shown when the service worker served a cached response. */
export function OfflineLine({ cachedAt }: { cachedAt: string | null }) {
  if (cachedAt === null) return null;
  return (
    <p className="text-sm text-muted" role="status">
      <span className="mr-[1ch] text-[0.75rem] font-semibold tracking-[0.16em] text-faint uppercase">offline</span>
      data z {formatDateTime(cachedAt)}
    </p>
  );
}
