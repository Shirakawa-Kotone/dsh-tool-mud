import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFullmeRoutes } from '../src/routes.js'
import { FullmeFlow } from '../src/fullme.js'

const REPLY = 'http://fullme.pkuxkx.net/robot.php?filename=179397480154412\n'
const PAGE = '<img src="./b2evo_captcha_tmp/b2evo_captcha_1234.jpg">'

function fakeSession() {
  const session = {
    connected: true,
    lock: null,
    needsHuman: null,
    async connect() {},
    lockSession(reason) {
      session.lock = { reason, since: '2026-11-06T00:00:00.000Z' }
    },
    unlock() {
      session.lock = null
    },
    async send() {
      return REPLY
    },
  }
  return session
}

function fakeResponse() {
  const response = {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) {
      response.status = status
      response.headers = headers
    },
    end(body) {
      response.body = body ?? ''
    },
  }
  return response
}

async function callRoute(route, { body, method = 'POST' } = {}) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    method,
    async *[Symbol.asyncIterator]() {
      yield* payload
    },
  }
  const res = fakeResponse()
  await route.handler(req, res)
  return { status: res.status, json: JSON.parse(res.body) }
}

function routes() {
  const session = fakeSession()
  const flow = new FullmeFlow({
    session,
    fetch: async () => ({ ok: true, status: 200, text: async () => PAGE }),
  })
  const byPath = Object.fromEntries(
    createFullmeRoutes({ flow }).map((route) => [route.path, route]),
  )
  return { session, flow, byPath }
}

test('exposes status/start/submit/cancel as exact routes', () => {
  const { byPath } = routes()
  assert.deepEqual(Object.keys(byPath).sort(), [
    '/dsh-tool-mud/fullme/cancel',
    '/dsh-tool-mud/fullme/start',
    '/dsh-tool-mud/fullme/status',
    '/dsh-tool-mud/fullme/submit',
  ])
})

test('status reports idle before anything starts', async () => {
  const { byPath } = routes()
  const { status, json } = await callRoute(byPath['/dsh-tool-mud/fullme/status'], {})
  assert.equal(status, 200)
  assert.equal(json.phase, 'idle')
})

test('start locks the session and returns the image url', async () => {
  const { byPath, session } = routes()
  const { status, json } = await callRoute(byPath['/dsh-tool-mud/fullme/start'])
  assert.equal(status, 200)
  assert.equal(json.phase, 'waiting')
  assert.match(json.imageUrl, /b2evo_captcha_1234\.jpg$/)
  assert.equal(session.lock.reason, 'fullme')
})

test('submit forwards the answer and releases the lock', async () => {
  const { byPath, session } = routes()
  await callRoute(byPath['/dsh-tool-mud/fullme/start'])
  const { status, json } = await callRoute(byPath['/dsh-tool-mud/fullme/submit'], {
    body: { answer: '自己' },
  })
  assert.equal(status, 200)
  assert.equal(json.phase, 'idle')
  assert.equal(session.lock, null)
})

test('submit without an answer fails cleanly with 400', async () => {
  const { byPath } = routes()
  await callRoute(byPath['/dsh-tool-mud/fullme/start'])
  const { status, json } = await callRoute(byPath['/dsh-tool-mud/fullme/submit'], { body: {} })
  assert.equal(status, 400)
  assert.match(json.error, /不能为空/)
})

test('an oversized body is rejected instead of buffered', async () => {
  const { byPath } = routes()
  const huge = { answer: 'x'.repeat(10_000) }
  const { status, json } = await callRoute(byPath['/dsh-tool-mud/fullme/submit'], { body: huge })
  assert.equal(status, 400)
  assert.match(json.error, /过大/)
})

test('cancel unlocks without sending anything', async () => {
  const { byPath, session } = routes()
  await callRoute(byPath['/dsh-tool-mud/fullme/start'])
  const { status, json } = await callRoute(byPath['/dsh-tool-mud/fullme/cancel'])
  assert.equal(status, 200)
  assert.equal(json.phase, 'idle')
  assert.equal(session.lock, null)
})
