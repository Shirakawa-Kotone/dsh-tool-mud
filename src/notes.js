/**
 * Read-only views of the agent's own notes — the plan and the diary it keeps for
 * the character — so the panel can show them instead of making you open files.
 *
 * Only a bounded tail is read: a diary grows without bound, the panel polls every
 * few seconds, and blocking the event loop here would stall the telnet session.
 */
import fs from 'node:fs'

/** Characters returned per file by default. */
export const DEFAULT_NOTE_CHARS = 6000
/** Bytes read at most, so a 200 MB file never lands in memory. */
const BYTE_HEADROOM = 4

/**
 * @param {object} options
 * @param {string} [options.planPath] - path; empty disables the section
 * @param {string} [options.diaryPath]
 * @param {number} [options.maxChars]
 * @returns {{ read(): { plan: object|null, diary: object|null } }}
 */
export function createNotes({ planPath = '', diaryPath = '', maxChars = DEFAULT_NOTE_CHARS } = {}) {
  /** Cached by mtime+size so an unchanged file is not re-read on every poll. */
  const cache = new Map()

  function readTail(file) {
    const stat = fs.statSync(file)
    const cached = cache.get(file)
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value

    const bytes = Math.max(1024, maxChars * BYTE_HEADROOM)
    const start = Math.max(0, stat.size - bytes)
    const length = stat.size - start

    let text = ''
    if (length > 0) {
      const handle = fs.openSync(file, 'r')
      try {
        const buffer = Buffer.alloc(length)
        fs.readSync(handle, buffer, 0, length, start)
        let offset = 0
        // We may have started in the middle of a UTF-8 sequence; skip its
        // continuation bytes so the tail does not begin with U+FFFD.
        while (offset < buffer.length && (buffer[offset] & 0xc0) === 0x80) offset += 1
        text = buffer.subarray(offset).toString('utf8')
      } finally {
        fs.closeSync(handle)
      }
    }

    const truncated = start > 0 || text.length > maxChars
    if (text.length > maxChars) text = text.slice(-maxChars)
    // Never start on a lone low surrogate: that is half an emoji.
    if (/^[\uDC00-\uDFFF]/.test(text)) text = text.slice(1)

    const value = { path: file, mtime: stat.mtime.toISOString(), truncated, text }
    cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value })
    return value
  }

  function readOne(file) {
    if (!file) return null
    try {
      return readTail(file)
    } catch (error) {
      return { path: file, mtime: null, truncated: false, text: '', error: String(error?.code ?? error) }
    }
  }

  return {
    read() {
      return { plan: readOne(planPath), diary: readOne(diaryPath) }
    },
  }
}
