/**
 * The in-memory journal behind the MUD panel: what the server said, what the
 * agent typed, and the events in between (connect, idle logout, fullme lock).
 *
 * It is a bounded ring buffer with monotonic `seq` numbers, so a browser panel
 * can ask for "everything after N" without diffing strings. The on-disk
 * transcript stays the durable record; this is only for watching live.
 */

/** Server lines kept before the oldest are dropped. */
export const DEFAULT_JOURNAL_LIMIT = 500

/**
 * @param {object} [options]
 * @param {number} [options.limit] - max entries retained
 * @param {() => Date} [options.now]
 * @returns {{ record(kind: string, text: string, meta?: object): void, since(n?: number): {cursor: number, entries: object[]}, clear(): void, readonly size: number }}
 */
export function createJournal({ limit = DEFAULT_JOURNAL_LIMIT, now = () => new Date() } = {}) {
  /** @type {Array<{seq: number, at: string, kind: string, text: string, actor?: string}>} */
  let entries = []
  let seq = 0

  return {
    record(kind, text, meta = {}) {
      const body = String(text ?? '').replace(/\r/g, '')
      // A server chunk can hold several lines; keep them as separate rows so the
      // panel can render one line per row without re-splitting.
      for (const line of body.split('\n')) {
        const trimmed = line.replace(/\s+$/, '')
        if (trimmed.trim() === '') continue
        entries.push({ seq: ++seq, at: now().toISOString(), kind, text: trimmed, ...meta })
      }
      if (entries.length > limit) entries = entries.slice(entries.length - limit)
    },

    since(cursor = 0) {
      const from = Number.isFinite(cursor) ? Math.max(0, cursor) : 0
      const page = from >= seq ? [] : entries.filter((entry) => entry.seq > from)
      return {
        cursor: seq,
        entries: page,
        // True when the caller asked for entries the ring already dropped, so
        // the panel can say "there is a gap" instead of silently showing less.
        dropped: page.length > 0 && page[0].seq > from + 1,
      }
    },

    clear() {
      entries = []
      seq = 0
    },

    get size() {
      return entries.length
    },
  }
}
