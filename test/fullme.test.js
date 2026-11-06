import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FullmeFlow, parseFilename, parseImageUrl } from '../src/fullme.js'

const REPLY = 'http://fullme.pkuxkx.net/robot.php?filename=179397480154412\n还是用这个命令，指令格式: fullme 验证码\n'
const PAGE = '<html><img src="./b2evo_captcha_tmp/b2evo_captcha_1234.jpg"></html>'

function fakeSession({ reply = REPLY } = {}) {
  const sent = []
  const session = {
    connected: true,
    lock: null,
    needsHuman: null,
    sent,
    async connect() {
      session.connected = true
    },
    lockSession(reason) {
      session.lock = { reason, since: '2026-11-06T00:00:00.000Z' }
      return session.lock
    },
    unlock() {
      session.lock = null
    },
    async send(text, options) {
      sent.push({ text, options })
      return reply
    },
  }
  return session
}

function fakeFetch(page = PAGE, ok = true, status = 200) {
  const calls = []
  const impl = async (url) => {
    calls.push(url)
    return { ok, status, text: async () => page }
  }
  return { impl, calls }
}

test('parses the challenge filename from the server reply', () => {
  assert.equal(parseFilename(REPLY), '179397480154412')
  assert.equal(parseFilename('没有任何链接'), null)
})

test('parses the captcha image url out of the challenge page', () => {
  assert.equal(
    parseImageUrl(PAGE),
    'https://fullme.pkuxkx.net/b2evo_captcha_tmp/b2evo_captcha_1234.jpg',
  )
  assert.equal(parseImageUrl('<html></html>'), null)
})

test('start() types fullme, fetches the image, and locks the session', async () => {
  const session = fakeSession()
  const fetcher = fakeFetch()
  const flow = new FullmeFlow({ session, fetch: fetcher.impl })

  const state = await flow.start()

  assert.deepEqual(session.sent.map((call) => call.text), ['fullme'])
  assert.equal(session.sent[0].options.bypassLock, true)
  assert.equal(session.lock.reason, 'fullme')
  assert.equal(state.phase, 'waiting')
  assert.equal(state.filename, '179397480154412')
  assert.match(state.imageUrl, /b2evo_captcha_tmp\/b2evo_captcha_1234\.jpg$/)
  assert.deepEqual(fetcher.calls, ['https://fullme.pkuxkx.net/robot.php?filename=179397480154412'])
})

test('start() is idempotent while a challenge is open', async () => {
  const session = fakeSession()
  const flow = new FullmeFlow({ session, fetch: fakeFetch().impl })

  const first = await flow.start()
  const second = await flow.start()

  assert.deepEqual(first, second)
  assert.equal(session.sent.length, 1)
})

test('two concurrent starts open exactly one challenge', async () => {
  const session = fakeSession()
  let fetches = 0
  const flow = new FullmeFlow({
    session,
    fetch: async (...args) => {
      fetches += 1
      return { ok: true, status: 200, text: async () => PAGE }
    },
  })

  const [a, b] = await Promise.all([flow.start(), flow.start()])

  assert.deepEqual(a, b)
  assert.equal(session.sent.filter((call) => call.text === 'fullme').length, 1)
  assert.equal(fetches, 1)
})

test('a reply without a challenge link unlocks and reports the output', async () => {
  const session = fakeSession({ reply: '你没有请求 fullme 。\n' })
  const flow = new FullmeFlow({ session, fetch: fakeFetch().impl })

  await assert.rejects(() => flow.start(), /服务器没有返回验证码链接/)
  assert.equal(session.lock, null)
  assert.equal(flow.state().phase, 'idle')
})

test('a broken captcha page unlocks instead of leaving the session held', async () => {
  const session = fakeSession()
  const flow = new FullmeFlow({ session, fetch: fakeFetch('<html>maintenance</html>').impl })

  await assert.rejects(() => flow.start(), /没有图片链接/)
  assert.equal(session.lock, null)
})

test('submit() sends the answer and releases the lock', async () => {
  const session = fakeSession()
  const flow = new FullmeFlow({ session, fetch: fakeFetch().impl })
  await flow.start()

  const result = await flow.submit(' 自己 ')

  assert.equal(session.sent.at(-1).text, 'fullme 自己')
  assert.equal(session.lock, null)
  assert.equal(result.state.phase, 'idle')
})

test('submit() rejects an empty answer but keeps the lock', async () => {
  const session = fakeSession()
  const flow = new FullmeFlow({ session, fetch: fakeFetch().impl })
  await flow.start()

  await assert.rejects(() => flow.submit('   '), /不能为空/)
  assert.equal(session.lock.reason, 'fullme')
})

test('cancel() hands the session back without submitting', async () => {
  const session = fakeSession()
  const flow = new FullmeFlow({ session, fetch: fakeFetch().impl })
  await flow.start()

  const state = flow.cancel()

  assert.equal(state.phase, 'idle')
  assert.equal(session.lock, null)
  assert.equal(session.sent.length, 1)
})
