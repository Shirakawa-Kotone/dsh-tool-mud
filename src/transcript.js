/**
 * Append-only session transcript: `mud-YYYY-MM-DD.log`, one line per event.
 *
 * Logging must never break play, so every filesystem failure here is swallowed
 * and simply disables logging.
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * @param {object} options
 * @param {string} options.dir - directory for the daily files
 * @param {() => Date} [options.now]
 * @returns {{ line(kind: string, text: string): void, close(): void, get file(): string | null }}
 */
export function createTranscript({ dir, now = () => new Date() }) {
  let stream = null
  let day = null
  let file = null

  function open() {
    const today = now().toISOString().slice(0, 10)
    if (today === day && stream) return stream
    close()
    try {
      fs.mkdirSync(dir, { recursive: true })
      file = path.join(dir, `mud-${today}.log`)
      stream = fs.createWriteStream(file, { flags: 'a' })
      day = today
    } catch {
      stream = null
      day = null
      file = null
    }
    return stream
  }

  function close() {
    try {
      stream?.end()
    } catch {
      /* ignore */
    }
    stream = null
  }

  return {
    line(kind, text) {
      const target = open()
      if (!target) return
      const stamp = now().toISOString().slice(11, 19)
      try {
        const body = String(text).replace(/\r/g, '')
        for (const line of body.split('\n')) {
          if (line.trim() === '') continue
          target.write(`${stamp} ${kind} ${line}\n`)
        }
      } catch {
        /* ignore */
      }
    },
    close,
    get file() {
      return file
    },
  }
}
