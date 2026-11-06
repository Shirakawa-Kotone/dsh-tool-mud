/**
 * Read-only views of the agent's own notes — the plan and the diary it keeps for
 * the character — so the panel can show them instead of making you open files.
 *
 * Only the tail is returned: a diary grows without bound, and the panel wants
 * "what happened lately", not the whole log.
 */
import fs from 'node:fs'

/** Characters returned per file by default. */
export const DEFAULT_NOTE_CHARS = 6000

/**
 * @param {object} options
 * @param {string} [options.planPath] - absolute path; empty disables the section
 * @param {string} [options.diaryPath]
 * @param {number} [options.maxChars]
 * @returns {{ read(): { plan: object|null, diary: object|null } }}
 */
export function createNotes({ planPath = '', diaryPath = '', maxChars = DEFAULT_NOTE_CHARS } = {}) {
  function readOne(file) {
    if (!file) return null
    try {
      const stat = fs.statSync(file)
      const text = fs.readFileSync(file, 'utf8')
      const tail = text.length > maxChars ? text.slice(text.length - maxChars) : text
      return {
        path: file,
        mtime: stat.mtime.toISOString(),
        truncated: text.length > tail.length,
        text: tail,
      }
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
