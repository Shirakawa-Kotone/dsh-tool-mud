/**
 * The manual fullme flow.
 *
 * A fullme captcha is an image with two Chinese characters; solving it needs a
 * human. This module owns exactly the mechanical part: ask the server for a
 * challenge, resolve the image URL, and submit whatever the human typed. While a
 * challenge is open the session is locked, so the model cannot keep playing
 * underneath the person who is looking at the image.
 */

/** `http://fullme.pkuxkx.net/robot.php?filename=179397480154412` */
const FILENAME = /fullme\.pkuxkx\.net\/robot\.php\?filename=(\d+)/i
/** `<img src="./b2evo_captcha_tmp/b2evo_captcha_1234.jpg">` */
const IMAGE = /b2evo_captcha_tmp\/([\w.-]+\.jpg)/i

export const FULLME_HOST = 'https://fullme.pkuxkx.net'

/**
 * Pull the challenge filename out of a `fullme` reply.
 * @param {string} text @returns {string | null}
 */
export function parseFilename(text) {
  const match = FILENAME.exec(text ?? '')
  return match ? match[1] : null
}

/**
 * Pull the captcha image URL out of the challenge page.
 * @param {string} html
 * @param {string} [host]
 * @returns {string | null}
 */
export function parseImageUrl(html, host = FULLME_HOST) {
  const match = IMAGE.exec(html ?? '')
  return match ? `${host}/b2evo_captcha_tmp/${match[1]}` : null
}

/**
 * Drive one fullme challenge end to end.
 *
 * `start()` is idempotent while a challenge is open; `submit()` always releases
 * the lock, because a wrong answer is the human's to retry, not the model's.
 */
export class FullmeFlow {
  /**
   * @param {object} options
   * @param {import('./session.js').MudSession} options.session
   * @param {typeof fetch} [options.fetch]
   * @param {string} [options.host]
   * @param {() => Date} [options.now]
   */
  constructor({ session, fetch: fetchImpl = fetch, host = FULLME_HOST, now = () => new Date() }) {
    this.session = session
    this.fetch = fetchImpl
    this.host = host
    this.now = now
    /** @type {null | {filename: string, imageUrl: string, since: string}} */
    this.pending = null
  }

  state() {
    return {
      phase: this.pending ? 'waiting' : 'idle',
      filename: this.pending?.filename ?? null,
      imageUrl: this.pending?.imageUrl ?? null,
      since: this.pending?.since ?? null,
      locked: this.session.lock,
    }
  }

  /**
   * Ask the server for a challenge and fetch its image.
   * @returns {Promise<{filename: string, imageUrl: string, since: string}>}
   */
  async start() {
    if (this.pending) return this.state()
    if (!this.session.connected) await this.session.connect()

    this.session.lockSession('fullme')
    try {
      const output = await this.session.send('fullme', { quietMs: 1500, bypassLock: true })
      const filename = parseFilename(output)
      if (!filename) {
        throw new Error(`fullme: 服务器没有返回验证码链接：${output.trim().slice(-200) || '(无输出)'}`)
      }
      const page = await this.fetch(`${this.host}/robot.php?filename=${filename}`)
      if (!page.ok) throw new Error(`fullme: 取验证码页面失败 HTTP ${page.status}`)
      const imageUrl = parseImageUrl(await page.text(), this.host)
      if (!imageUrl) throw new Error('fullme: 验证码页面里没有图片链接')

      this.pending = { filename, imageUrl, since: this.now().toISOString() }
      return this.state()
    } catch (error) {
      this.session.unlock()
      this.pending = null
      throw error
    }
  }

  /**
   * Send the two characters a human read. Always releases the lock.
   * @param {string} answer
   */
  async submit(answer) {
    const text = String(answer ?? '').trim()
    if (!text) throw new Error('fullme: 验证码不能为空')
    this.pending = null
    try {
      const output = await this.session.send(`fullme ${text}`, { quietMs: 1500, bypassLock: true })
      return { output, state: this.state() }
    } finally {
      this.session.unlock()
    }
  }

  /** Give up on this challenge and hand the session back to the model. */
  cancel() {
    this.pending = null
    this.session.unlock()
    return this.state()
  }
}
