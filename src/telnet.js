/**
 * Telnet option negotiation and ANSI cleanup.
 *
 * The server opens with a handful of IAC negotiations (MXP, charset, ...) and we
 * refuse every one of them: the agent reads plain UTF-8 text, nothing else. The
 * decoder is stateful on purpose — a negotiation or an escape sequence may be
 * split across TCP chunks, and dropping the head of it would corrupt the stream.
 */

export const IAC = 255
export const DONT = 254
export const DO = 253
export const WONT = 252
export const WILL = 251
export const SB = 250
export const SE = 240

const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>]/g

/** A trailing escape sequence with no terminator yet — carried to the next chunk. */
const PARTIAL_ESCAPE = /\x1b(?:\[[0-9;?]*|\][^\x07\x1b]*|[()])?$/

/**
 * Create a telnet byte-stream decoder.
 *
 * @param {object} [options]
 * @param {(reply: Buffer) => void} [options.reply] - called with the refusal bytes
 *   for each WILL/DO the server sends (`IAC DONT <opt>` / `IAC WONT <opt>`).
 * @returns {{ push(chunk: Buffer): Buffer, readonly pendingBytes: number }}
 */
export function createTelnetStream({ reply = () => {} } = {}) {
  /** Bytes held back because they start a sequence that has not arrived whole. */
  let pending = Buffer.alloc(0)

  return {
    push(chunk) {
      const buf = pending.length ? Buffer.concat([pending, chunk]) : chunk
      pending = Buffer.alloc(0)
      const out = []
      let i = 0

      while (i < buf.length) {
        const byte = buf[i]

        if (byte !== IAC) {
          out.push(byte)
          i += 1
          continue
        }

        // A lone IAC at the end: wait for the command byte.
        if (i + 1 >= buf.length) {
          pending = buf.subarray(i)
          break
        }

        const command = buf[i + 1]

        if (command === IAC) {
          out.push(IAC)
          i += 2
          continue
        }

        if (command === SB) {
          // Subnegotiation: skip to IAC SE, or wait for more bytes.
          let j = i + 2
          let end = -1
          while (j + 1 < buf.length) {
            if (buf[j] === IAC && buf[j + 1] === SE) {
              end = j
              break
            }
            j += 1
          }
          if (end < 0) {
            pending = buf.subarray(i)
            break
          }
          i = end + 2
          continue
        }

        if (command === DO || command === DONT || command === WILL || command === WONT) {
          // Option byte missing: wait for it.
          if (i + 2 >= buf.length) {
            pending = buf.subarray(i)
            break
          }
          const option = buf[i + 2]
          if (command === DO) reply(Buffer.from([IAC, WONT, option]))
          else if (command === WILL) reply(Buffer.from([IAC, DONT, option]))
          i += 3
          continue
        }

        // Any other two-byte IAC command: drop it.
        i += 2
      }

      return Buffer.from(out)
    },

    get pendingBytes() {
      return pending.length
    },
  }
}

/**
 * Strip ANSI escapes, keeping a trailing partial escape for the next chunk.
 *
 * @param {string} text
 * @returns {{ text: string, carry: string }}
 */
export function stripAnsi(text) {
  const match = PARTIAL_ESCAPE.exec(text)
  const carry = match ? match[0] : ''
  const body = carry ? text.slice(0, text.length - carry.length) : text
  return { text: body.replace(ANSI, ''), carry }
}

/** Normalize line endings to `\n`. */
export function normalizeNewlines(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}
