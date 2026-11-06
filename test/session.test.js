import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers'
import { MudSession } from '../src/session.js'
import { fakeConnector, tick, wait } from './helpers.js'

const CREDS = path.join(os.tmpdir(), `dsh-tool-mud-creds-${process.pid}.json`)

function sessionWith(overrides = {}) {
  fs.writeFileSync(CREDS, JSON.stringify({ id: 'miaoxing', password: 'secret' }))
  const connector = fakeConnector()
  const session = new MudSession({
    host: 'example.invalid',
    port: 8080,
    credentialsPath: CREDS,
    logDir: '',
    resolveAddress: async () => '127.0.0.1',
    createConnection: connector.createConnection,
    pollMs: 5,
    closeDelayMs: 10,
    idleTimeoutMs: 60_000,
    ...overrides,
  })
  return { session, connector }
}

async function connected(overrides = {}) {
  const { session, connector } = sessionWith(overrides)
  const pending = session.connect()
  await tick()
  connector.last.emit('connect')
  await pending
  return { session, connector, socket: connector.last }
}

test('connects and decodes UTF-8 split across chunks', async () => {
  const { session, socket } = await connected()
  assert.equal(session.status().connected, true)

  const bytes = Buffer.from('气血 118/118\n', 'utf8')
  socket.emit('data', bytes.subarray(0, 4))
  socket.emit('data', bytes.subarray(4))

  assert.equal(session.take(), '气血 118/118\n')
  assert.equal(session.take(), '')
})

test('answers the login prompts in order and masks the password', async () => {
  const { session, socket } = await connected()
  socket.emit('data', Buffer.from('Input 1 for GBK, 2 for UTF8, 3 for BIG5\r\n'))
  socket.emit('data', Buffer.from('您的英文名字：\r\n'))
  socket.emit('data', Buffer.from('请输入您的密码：\r\n'))

  const output = await session.login({ timeoutMs: 2000, quietMs: 40 })

  assert.deepEqual(socket.writes.filter((line) => !line.startsWith('\x1b')), ['2\n', 'miaoxing\n', 'secret\n'])
  assert.match(output, />>> \*\*\*\*\*\*/)
  assert.ok(!output.includes('secret'), 'the password must not be echoed back')
})

test('sends one line and returns what the server answers', async () => {
  const { session, socket } = await connected()
  socket.on('written', (line) => {
    if (line.trim() === 'hp') {
      delay(() => socket.emit('data', Buffer.from('精神 126/126\r\n气血 118/118\r\n')), 5)
    }
  })

  const output = await session.send('hp', { quietMs: 30 })
  assert.match(output, /精神 126\/126/)
  assert.match(output, /气血 118\/118/)
})

test('refuses an empty command', async () => {
  const { session } = await connected()
  await assert.rejects(() => session.send(''), /non-empty/)
})

test('flags a fullme captcha and clears the flag once it is submitted', async () => {
  const { session, socket } = await connected()
  socket.emit('data', Buffer.from('http://fullme.pkuxkx.net/robot.php?filename=179397480154412\r\n'))

  assert.equal(session.status().needsHuman.kind, 'fullme')

  socket.on('written', (line) => {
    if (line.startsWith('fullme ')) delay(() => socket.emit('data', Buffer.from('OK\r\n')), 2)
  })
  await session.send('fullme 自己', { quietMs: 20 })
  assert.equal(session.status().needsHuman, null)
})

test('a session held by a human refuses model commands', async () => {
  const { session, socket } = await connected()
  session.lockSession('fullme')

  await assert.rejects(() => session.send('hp'), /人工接管/)
  await assert.rejects(() => session.login(), /人工接管/)
  assert.equal(socket.writes.length, 0)
  assert.equal(session.status().lock.reason, 'fullme')

  // The fullme flow itself is the human's own action and may bypass the lock.
  socket.on('written', (line) => {
    if (line.trim() === 'fullme') delay(() => socket.emit('data', Buffer.from('x\r\n')), 2)
  })
  await session.send('fullme', { quietMs: 20, bypassLock: true })
  session.unlock()
  assert.equal(session.status().lock, null)
})

test('idle logout sends save + quit and hangs up', async () => {
  const { session, socket } = await connected({ idleTimeoutMs: 1000 })
  session.lastActivity = Date.now() - 5000

  assert.equal(session.checkIdle(), true)
  assert.deepEqual(socket.writes, ['save\nquit\n'])

  await wait(30)
  assert.equal(socket.destroyed, true)
  assert.equal(session.status().connected, false)
  assert.ok(session.status().lastIdleLogout)
})

test('a human-held session is never idle-logged-out', async () => {
  const { session, socket } = await connected({ idleTimeoutMs: 10 })
  session.lockSession('fullme')
  session.lastActivity = Date.now() - 60_000

  assert.equal(session.checkIdle(), false)
  assert.equal(socket.destroyed, false)
})

test('does not disconnect while the session is being used', async () => {
  const { session, socket } = await connected({ idleTimeoutMs: 60_000 })
  session.touch()
  assert.equal(session.checkIdle(), false)
  assert.equal(socket.destroyed, false)
})

test('writes a transcript with the password masked', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mud-logs-'))
  const { session, socket } = await connected({ logDir: dir })
  socket.emit('data', Buffer.from('您的英文名字：\r\n请输入您的密码：\r\n'))
  await session.login({ timeoutMs: 2000, quietMs: 40 })
  session.close()

  const file = fs.readdirSync(dir).find((name) => name.startsWith('mud-'))
  assert.ok(file, 'a daily log file should exist')
  await wait(50)
  const body = fs.readFileSync(path.join(dir, file), 'utf8')
  assert.ok(!body.includes('secret'), 'the password must never reach the transcript')
  assert.match(body, /\*\*\*\*\*\*/)
})
