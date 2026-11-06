import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createPanelRoutes } from '../src/routes.js'
import { FullmeFlow } from '../src/fullme.js'
import { createJournal } from '../src/journal.js'
import { createNotes } from '../src/notes.js'

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
    status() {
      return {
        connected: true,
        host: '127.0.0.1',
        lock: session.lock,
        needsHuman: session.needsHuman,
        idleLogoutInMs: 1000,
        lastIdleLogout: null,
      }
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

async function callRoute(route, { body, url = '/' } = {}) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    url,
    method: body === undefined ? 'GET' : 'POST',
    async *[Symbol.asyncIterator]() {
      yield* payload
    },
  }
  const res = fakeResponse()
  await route.handler(req, res)
  return { status: res.status, json: JSON.parse(res.body) }
}

function routes(overrides = {}) {
  const session = fakeSession()
  const journal = createJournal({ now: () => new Date('2026-11-06T00:00:00Z') })
  const notes = createNotes(overrides.notes ?? {})
  const flow = new FullmeFlow({
    session,
    fetch: async () => ({ ok: true, status: 200, text: async () => PAGE }),
  })
  const byPath = Object.fromEntries(
    createPanelRoutes({ flow, journal, notes, session }).map((route) => [route.path, route]),
  )
  return { session, journal, flow, byPath }
}

test('exposes six exact routes under /dsh-tool-mud', () => {
  const { byPath } = routes()
  assert.deepEqual(Object.keys(byPath).sort(), [
    '/dsh-tool-mud/fullme/cancel',
    '/dsh-tool-mud/fullme/start',
    '/dsh-tool-mud/fullme/submit',
    '/dsh-tool-mud/journal',
    '/dsh-tool-mud/notes',
    '/dsh-tool-mud/status',
  ])
})

test('status reports the session and the fullme phase', async () => {
  const { byPath } = routes()
  const { status, json } = await callRoute(byPath['/dsh-tool-mud/status'])
  assert.equal(status, 200)
  assert.equal(json.phase, 'idle')
  assert.equal(json.connected, true)
})

test('journal returns only what is newer than the cursor', async () => {
  const { byPath, journal } = routes()
  journal.record('server', '第一行\n第二行\n')
  const first = await callRoute(byPath['/dsh-tool-mud/journal'], {
    url: '/dsh-tool-mud/journal?since=0',
  })
  assert.equal(first.json.entries.length, 2)
  const cursor = first.json.cursor

  journal.record('agent', 'hp')
  const second = await callRoute(byPath['/dsh-tool-mud/journal'], {
    url: `/dsh-tool-mud/journal?since=${cursor}`,
  })
  assert.deepEqual(second.json.entries.map((entry) => entry.text), ['hp'])
})

test('journal tolerates a garbage cursor', async () => {
  const { byPath } = routes()
  const { status, json } = await callRoute(byPath['/dsh-tool-mud/journal'], {
    url: '/dsh-tool-mud/journal?since=abc',
  })
  assert.equal(status, 200)
  assert.deepEqual(json.entries, [])
})

test('notes reads the configured plan and diary tails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mud-notes-'))
  const plan = path.join(dir, 'PROGRESS.md')
  const diary = path.join(dir, 'DIARY.md')
  fs.writeFileSync(plan, '# 下一步\n补内力\n')
  fs.writeFileSync(diary, '今天学会了送信\n')

  const { byPath } = routes({ notes: { planPath: plan, diaryPath: diary } })
  const { status, json } = await callRoute(byPath['/dsh-tool-mud/notes'])
  assert.equal(status, 200)
  assert.match(json.plan.text, /补内力/)
  assert.match(json.diary.text, /送信/)
  assert.ok(json.plan.mtime)
})

test('notes reports a missing file instead of failing the panel', async () => {
  const { byPath } = routes({ notes: { planPath: '/nonexistent/mud/plan.md' } })
  const { status, json } = await callRoute(byPath['/dsh-tool-mud/notes'])
  assert.equal(status, 200)
  assert.equal(json.plan.error, 'ENOENT')
  assert.equal(json.diary, null)
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
