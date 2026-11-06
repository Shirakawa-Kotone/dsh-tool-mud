import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { apply, Config, inject, name } from '../src/index.js'

function fakeContext() {
  const registered = []
  const disposers = []
  return {
    registered,
    tools: { register: (tool) => registered.push(tool) },
    effect: (factory) => {
      const dispose = factory()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    dispose: () => disposers.forEach((fn) => fn()),
  }
}

const config = {
  credentialsPath: path.join(os.tmpdir(), 'nope-creds.json'),
  logDir: '',
}

test('registers exactly one tool, named `mud` by default', () => {
  const ctx = fakeContext()
  apply(ctx, config)
  assert.equal(name, 'tool-mud')
  assert.deepEqual(inject, ['tools'])
  assert.equal(ctx.registered.length, 1)
  assert.equal(ctx.registered[0].name, 'mud')
})

test('the tool name is configurable so a dev copy can coexist', () => {
  const ctx = fakeContext()
  apply(ctx, { ...config, toolName: 'mud_dev' })
  assert.equal(ctx.registered[0].name, 'mud_dev')
})

test('loading the plugin opens no socket', () => {
  const ctx = fakeContext()
  apply(ctx, config)
  assert.equal(ctx.registered[0].name, 'mud')
  // Nothing observable happened: no connection was attempted at import/apply time.
  assert.equal(typeof ctx.dispose, 'function')
})

test('the status action answers without a connection', async () => {
  const ctx = fakeContext()
  apply(ctx, config)
  const result = await ctx.registered[0].execute({ action: 'status' })
  const status = JSON.parse(result.output)
  assert.equal(status.connected, false)
  assert.equal(status.needsHuman, null)
  assert.equal(result.connected, false)
})

test('send without text is rejected', async () => {
  const ctx = fakeContext()
  apply(ctx, config)
  await assert.rejects(
    () => ctx.registered[0].execute({ action: 'send' }),
    /"text" is required/,
  )
})

test('the config schema resolves the documented defaults', () => {
  const resolved = Config({})
  assert.equal(resolved.toolName, 'mud')
  assert.equal(resolved.host, 'mud.pkuxkx.net')
  assert.equal(resolved.port, 8080)
  assert.equal(resolved.encodingMenu, '2')
  assert.equal(resolved.idleTimeoutMs, 180_000)
  assert.deepEqual(resolved.fallbackAddresses, ['47.110.45.145'])
  assert.match(resolved.credentialsPath, /\.dsh-tool-mud\/creds\.json$/)
})
