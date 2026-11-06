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
  /**
   * Set once the sink has failed. A broken log directory (EISDIR, ENOSPC,
   * EACCES, a directory that was rotated away) would otherwise raise an
   * uncaught 'error' event and take the whole host process with it — and with
   * it the idle watchdog that exists to keep the character from idling online.
   */
  let broken = false

  function open() {
    if (broken) return null
    const today = now().toISOString().slice(0, 10)
    if (today === day && stream) return stream
    close()
    try {
      fs.mkdirSync(dir, { recursive: true })
      file = path.join(dir, `mud-${today}.log`)
      stream = fs.createWriteStream(file, { flags: 'a' })
      // Asynchronous fs errors are events, not exceptions: without this the
      // process dies on the first ENOSPC/EACCES after the stream was created.
      stream.on('error', () => {
        broken = true
        close()
      })
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
