/**
 * One long-lived MUD session: connect, log in, type a line, read what came back.
 *
 * The session owns no policy about *what* to type. The only things it does
 * automatically are (a) answering the login prompts and (b) hanging up after the
 * idle timeout, so an abandoned character never sits online.
 */
import dns from 'node:dns/promises'
import fs from 'node:fs'
import net from 'node:net'
import { createTelnetStream, normalizeNewlines, stripAnsi } from './telnet.js'
import { detectFullme, findLoginPrompt } from './prompts.js'
import { createTranscript } from './transcript.js'
import { createJournal } from './journal.js'

export const DEFAULT_IDLE_MS = 180_000
/** How often the idle watchdog wakes up. */
export const IDLE_TICK_MS = 15_000
/** Decoded characters kept before the oldest half is dropped. */
export const MAX_BUFFER_CHARS = 200_000

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Resolve the server address, preferring c-ares over getaddrinfo.
 *
 * `net.connect({ host: name })` goes through the system resolver, which on some
 * machines intermittently returns ENOTFOUND for this host even though DNS itself
 * is fine. `dns.resolve4` bypasses getaddrinfo entirely, so ask it first and only
 * then fall back to the pinned addresses.
 *
 * @param {string} host
 * @param {string[]} fallbacks
 * @returns {Promise<string>}
 */
export async function resolveAddress(host, fallbacks = []) {
  try {
    const list = await dns.resolve4(host)
    if (list && list.length) return list[0]
  } catch {
    /* fall through */
  }
  if (fallbacks.length) return fallbacks[0]
  throw new Error(`mud: cannot resolve ${host} and no fallback address is configured`)
}

export class MudSession {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} options.port
   * @param {string} options.encoding
   * @param {string} options.encodingMenu - menu key for the UTF-8 variant
   * @param {string} options.credentialsPath
   * @param {string} options.logDir
   * @param {number} [options.idleTimeoutMs]
   * @param {number} [options.idleTickMs]
   * @param {number} [options.connectTimeoutMs]
   * @param {number} [options.closeDelayMs] - grace period between `quit` and socket teardown
   * @param {number} [options.pollMs] - how long to wait between buffer checks
   * @param {number} [options.maxBufferChars]
   * @param {string[]} [options.fallbackAddresses]
   * @param {typeof net.createConnection} [options.createConnection]
   * @param {(host: string, fallbacks: string[]) => Promise<string>} [options.resolveAddress]
   * @param {(ms: number) => Promise<void>} [options.sleep]
   * @param {() => Date} [options.now]
   */
  constructor(options) {
    this.host = options.host
    this.port = options.port
    this.encoding = options.encoding ?? 'utf-8'
    this.encodingMenu = options.encodingMenu ?? '2'
    this.credentialsPath = options.credentialsPath
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_MS
    this.idleTickMs = options.idleTickMs ?? IDLE_TICK_MS
    this.connectTimeoutMs = options.connectTimeoutMs ?? 20_000
    this.closeDelayMs = options.closeDelayMs ?? 2_000
    this.pollMs = options.pollMs ?? 200
    this.maxBufferChars = options.maxBufferChars ?? MAX_BUFFER_CHARS
    this.fallbackAddresses = options.fallbackAddresses ?? []

    this.createConnection = options.createConnection ?? net.createConnection
    this.resolveAddress = options.resolveAddress
      ?? ((host, fallbacks) => resolveAddress(host, fallbacks))
    this.sleep = options.sleep ?? realSleep
    this.now = options.now ?? (() => new Date())

    this.transcript = options.logDir ? createTranscript({ dir: options.logDir, now: this.now }) : null
    this.journal = options.journal ?? createJournal({ now: this.now })

    this.socket = null
    this.telnet = null
    this.decoder = null
    this.ansiCarry = ''
    this.buffer = ''
    this.cursor = 0
    this.connected = false
    this.error = null
    this.resolvedHost = null
    this.lastActivity = 0
    this.idleTimer = null
    this.lastIdleLogout = null
    /** @type {null | {kind: 'fullme', since: string}} */
    this.needsHuman = null
    /** Set while a human drives the session (a fullme captcha); the tool refuses model calls. */
    /** @type {null | {reason: string, since: string}} */
    this.lock = null
    /** Serializes login/send so two callers never interleave on one buffer. */
    this.queue = Promise.resolve()
    /** In-flight connect, so concurrent callers share one socket. */
    this.connecting = null
    /** Grace timer between `quit` and socket teardown. */
    this.closeTimer = null
    /** Called when the socket closes on its own, so a human-held session is released. */
    this.onDisconnect = null
  }

  /** Run `fn` after every earlier session operation, whatever their outcome. */
  serialize(fn) {
    const run = this.queue.then(fn, fn)
    this.queue = run.then(() => {}, () => {})
    return run
  }

  /** Hand the session to a human: model-driven login/send throw until `unlock()`. */
  lockSession(reason = 'fullme') {
    this.touch()
    this.lock = { reason, since: this.now().toISOString() }
    this.note(`人工接管：${reason}（模型操作已暂停）`)
    return this.lock
  }

  unlock() {
    if (this.lock) this.note('人工接管结束，模型可以继续')
    this.lock = null
    // A human staring at a captcha is activity, not idleness: restart the clock
    // so the first tick after handing back does not log the character out.
    this.touch()
  }

  /** Credentials are read fresh on every login, so a rotated password applies. */
  credentials() {
    try {
      return JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'))
    } catch {
      return {}
    }
  }

  log(kind, text) {
    this.transcript?.line(kind, text)
  }

  /** Record one panel-visible event (connect, idle, lock, ...). */
  note(text) {
    this.journal.record('event', text)
    this.log('--', text)
  }

  sendRaw(bytes) {
    if (this.socket && !this.socket.destroyed) this.socket.write(bytes)
  }

  /** Mark the session as actively driven (called on every tool call). */
  touch() {
    this.lastActivity = Date.now()
  }

  clearIdleWatch() {
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
  }

  startIdleWatch() {
    this.clearIdleWatch()
    this.touch()
    this.idleTimer = setInterval(() => this.checkIdle(), this.idleTickMs)
    if (this.idleTimer.unref) this.idleTimer.unref()
  }

  /** Called by the watchdog; exposed so it can be driven directly in tests. */
  checkIdle() {
    if (!this.connected) return false
    // 0 disables the watchdog entirely (documented as such).
    if (!(this.idleTimeoutMs > 0)) return false
    // A human at the captcha is activity, not idleness: never hang up on them.
    if (this.lock) return false
    const idle = Date.now() - this.lastActivity
    if (idle < this.idleTimeoutMs) return false
    this.idleLogout(idle)
    return true
  }

  idleLogout(idle) {
    this.clearIdleWatch()
    const secs = Math.round(idle / 1000)
    this.lastIdleLogout = this.now().toISOString()
    this.append(`\n>>> [idle] 已有 ${secs} 秒没有操作，自动 save + quit 下线。\n`, { log: true })
    this.note(`闲置 ${secs} 秒，自动 save + quit`)
    this.sendRaw(Buffer.from('save\nquit\n', 'utf8'))
    const socket = this.socket
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null
      // Only the socket we decided to quit is ours to destroy: a reconnect in
      // the grace window must not be killed by an old idle logout.
      if (this.socket !== socket) return
      try {
        socket?.destroy()
      } catch {
        /* ignore */
      }
      this.connected = false
      this.append('>>> [idle] 连接已关闭。\n', { log: true })
    }, this.closeDelayMs)
    if (this.closeTimer.unref) this.closeTimer.unref()
  }

  /** Append decoded server text to the read buffer. */
  append(text, { log = false } = {}) {
    if (!text) return
    this.buffer += text
    if (log) {
      this.log('<<', text)
      this.journal.record('server', text)
    }
    if (detectFullme(text)) {
      this.needsHuman = { kind: 'fullme', since: this.now().toISOString() }
      this.log('!!', 'fullme captcha waiting for a human')
    }
    if (this.buffer.length > this.maxBufferChars) {
      const cut = this.buffer.length - Math.floor(this.maxBufferChars / 2)
      this.buffer = this.buffer.slice(cut)
      this.cursor = Math.max(0, this.cursor - cut)
    }
  }

  onData(chunk) {
    const clean = this.telnet.push(chunk)
    if (!clean.length) return
    const decoded = this.decoder.decode(clean, { stream: true })
    const { text, carry } = stripAnsi(this.ansiCarry + decoded)
    this.ansiCarry = carry
    if (text) this.append(normalizeNewlines(text), { log: true })
  }

  async connect() {
    if (this.socket && !this.socket.destroyed && this.connected) return
    if (this.connecting) return this.connecting
    this.connecting = this.openSocket().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  async openSocket() {
    const address = await this.resolveAddress(this.host, this.fallbackAddresses)
    this.resolvedHost = address
    const socket = this.createConnection({ host: address, port: this.port })

    this.socket = socket
    this.decoder = new TextDecoder(this.encoding)
    this.telnet = createTelnetStream({ reply: (bytes) => this.sendRaw(bytes) })
    this.ansiCarry = ''
    this.error = null

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          socket.destroy()
        } catch {
          /* ignore */
        }
        reject(new Error('connect timeout'))
      }, this.connectTimeoutMs)
      socket.on('data', (chunk) => this.onData(chunk))
      socket.once('connect', () => {
        clearTimeout(timer)
        this.connected = true
        this.note(`已连接 ${address}:${this.port}`)
        this.startIdleWatch()
        resolve()
      })
      socket.on('error', (error) => {
        clearTimeout(timer)
        this.error = String(error)
        this.connected = false
        reject(error)
      })
      socket.on('close', () => {
        if (this.connected) this.note('连接已断开')
        this.connected = false
        this.clearIdleWatch()
        // A dropped socket must not leave a human handoff (and its lock) behind:
        // the captcha is gone with the connection, so hand the session back.
        const hadLock = this.lock !== null
        this.lock = null
        this.onDisconnect?.()
        if (hadLock) this.note('连接断开，人工接管已自动解除')
      })
    })
  }

  /** Pop everything the caller has not read yet. */
  take() {
    const text = this.buffer
    this.buffer = ''
    this.cursor = 0
    return text
  }

  /** Answer login prompts until the server goes quiet. */
  login(options = {}) {
    return this.serialize(() => this.loginNow(options))
  }

  async loginNow({ timeoutMs = 60_000, quietMs = 6_000 } = {}) {
    this.assertUnlocked()
    this.touch()
    await this.connect()
    const creds = this.credentials()
    const deadline = Date.now() + timeoutMs
    let quietSince = Date.now()
    let seenAny = false

    while (Date.now() < deadline) {
      await this.sleep(this.pollMs)
      const prompt = findLoginPrompt(this.buffer, this.cursor, creds, {
        encodingMenu: this.encodingMenu,
      })
      if (prompt) {
        this.cursor = prompt.end
        this.log('>>', prompt.key === 'password' ? '******' : prompt.value)
        this.journal.record('agent', prompt.key === 'password' ? '******' : prompt.value, { actor: 'login' })
        this.sendRaw(Buffer.from(`${prompt.value}\n`, 'utf8'))
        // Echo the masked value back into the read buffer, like a client would.
        this.buffer += `\n>>> ${prompt.key === 'password' ? '******' : prompt.value}\n`
        quietSince = Date.now()
        seenAny = true
        continue
      }
      if (seenAny && Date.now() - quietSince > quietMs) break
    }
    return this.take()
  }

  /**
   * Throw while a human owns the session. `bypassLock` exists for exactly one
   * caller: the fullme flow, which is that human's own action.
   */
  assertUnlocked(bypassLock = false) {
    if (this.lock && !bypassLock) {
      throw new Error(
        `mud: 会话已被人工接管（${this.lock.reason}，自 ${this.lock.since}），模型操作已暂停；`
        + '请在 MUD 面板里完成验证码，或取消接管。',
      )
    }
  }

  /** Type one line and collect output until the stream goes quiet. */
  send(text, options = {}) {
    return this.serialize(() => this.sendNow(text, options))
  }

  async sendNow(text, { quietMs = 1200, maxMs = 15_000, bypassLock = false, actor = 'model' } = {}) {
    if (typeof text !== 'string' || text === '') throw new Error('mud: "text" must be a non-empty string')
    this.assertUnlocked(bypassLock)
    this.touch()
    this.log('>>', text)
    this.journal.record('agent', text, { actor })
    if (/^fullme\s+\S+/i.test(text)) this.needsHuman = null
    this.sendRaw(Buffer.from(`${text}\n`, 'utf8'))

    const start = Date.now()
    let lastLength = this.buffer.length
    let quietAt = Date.now()

    while (Date.now() - start < maxMs) {
      await this.sleep(this.pollMs)
      if (this.buffer.length !== lastLength) {
        lastLength = this.buffer.length
        quietAt = Date.now()
      } else if (Date.now() - quietAt > quietMs) {
        break
      }
    }
    return this.take()
  }

  status() {
    const idleFor = this.lastActivity ? Date.now() - this.lastActivity : 0
    return {
      connected: this.connected,
      buffered: this.buffer.length,
      error: this.error,
      host: this.resolvedHost,
      idleTimeoutMs: this.idleTimeoutMs,
      idleForMs: idleFor,
      idleLogoutInMs: this.connected ? Math.max(0, this.idleTimeoutMs - idleFor) : null,
      lastIdleLogout: this.lastIdleLogout,
      needsHuman: this.needsHuman,
      lock: this.lock,
    }
  }

  close() {
    this.clearIdleWatch()
    if (this.closeTimer) {
      clearTimeout(this.closeTimer)
      this.closeTimer = null
    }
    this.lock = null
    this.onDisconnect?.()
    try {
      this.socket?.destroy()
    } catch {
      /* ignore */
    }
    this.connected = false
    this.transcript?.close()
  }
}
