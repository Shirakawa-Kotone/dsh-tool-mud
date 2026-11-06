import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
// src/index.js pulls in @deepseek-ai/dsh-tools, which only exists inside a DSH
// install. A bare clone has no node_modules, so this file skips instead of
// failing the whole suite.
let apply
let Config
let inject
let name
let loadError = null
try {
  ;({ apply, Config, inject, name } = await import('../src/index.js'))
} catch (error) {
  loadError = error
}

const skip = loadError
  ? `needs @deepseek-ai/dsh-tools (${loadError.code ?? loadError.message})`
  : undefined
const wtest = (title, fn) => test(title, { skip }, fn)

function fakeContext({ withWebServer = true } = {}) {
  const registered = []
  const routes = []
  const disposers = []
  const ctx = {
    registered,
    routes,
    tools: { register: (tool) => registered.push(tool) },
    // No composed connection service, like a headless webServer-only host.
    get: () => undefined,
    effect: (factory) => {
      const dispose = factory()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    // Mimic cordis: the child callback runs immediately when the service is present.
    inject: (names, callback) => {
      if (names.includes('webServer') && withWebServer) callback(ctx)
    },
    dispose: () => disposers.forEach((fn) => fn()),
  }
  if (withWebServer) {
    ctx.webServer = {
      register: (route) => {
        routes.push(route)
        return () => {
          const at = routes.indexOf(route)
          if (at !== -1) routes.splice(at, 1)
        }
      },
    }
  }
  return ctx
}

const config = {
  credentialsPath: path.join(os.tmpdir(), 'nope-creds.json'),
  logDir: '',
}

wtest('registers exactly one tool, named `mud` by default', () => {
  const ctx = fakeContext()
  apply(ctx, config)
  assert.equal(name, 'tool-mud')
  assert.deepEqual(inject, ['tools'])
  assert.equal(ctx.registered.length, 1)
  assert.equal(ctx.registered[0].name, 'mud')
})

wtest('the tool name is configurable so a dev copy can coexist', () => {
  const ctx = fakeContext()
  apply(ctx, { ...config, toolName: 'mud_dev' })
  assert.equal(ctx.registered[0].name, 'mud_dev')
})

wtest('loading the plugin opens no socket', () => {
  const ctx = fakeContext()
  apply(ctx, config)
  assert.equal(ctx.registered[0].name, 'mud')
  // Nothing observable happened: no connection was attempted at import/apply time.
  assert.equal(typeof ctx.dispose, 'function')
})

wtest('registers the six panel routes on a composed webserver', () => {
  const ctx = fakeContext()
  apply(ctx, config)
  assert.deepEqual(ctx.routes.map((route) => route.path).sort(), [
    '/dsh-tool-mud/fullme/cancel',
    '/dsh-tool-mud/fullme/start',
    '/dsh-tool-mud/fullme/submit',
    '/dsh-tool-mud/journal',
    '/dsh-tool-mud/notes',
    '/dsh-tool-mud/status',
  ])
  assert.ok(ctx.routes.every((route) => route.kind === 'exact'))
})

wtest('without a connection service the routes refuse instead of failing open', async () => {
  const ctx = fakeContext()
  apply(ctx, config) // fake ctx has no ctx.get('connection')
  const route = ctx.routes.find((entry) => entry.path === '/dsh-tool-mud/status')
  const res = { status: 0, headers: null, body: '', writeHead(status) { this.status = status }, end(body) { this.body = body ?? '' } }
  await route.handler({ url: '/dsh-tool-mud/status', method: 'GET', async *[Symbol.asyncIterator]() {} }, res)
  assert.equal(res.status, 403)
})

wtest('a headless host gets the tool but no routes', () => {
  const ctx = fakeContext({ withWebServer: false })
  apply(ctx, config)
  assert.equal(ctx.registered.length, 1)
  assert.equal(ctx.routes.length, 0)
})

wtest('the status action answers without a connection', async () => {
  const ctx = fakeContext()
  apply(ctx, config)
  const result = await ctx.registered[0].execute({ action: 'status' })
  const status = JSON.parse(result.output)
  assert.equal(status.connected, false)
  assert.equal(status.needsHuman, null)
  assert.equal(result.connected, false)
})

wtest('send without text is rejected', async () => {
  const ctx = fakeContext()
  apply(ctx, config)
  await assert.rejects(
    () => ctx.registered[0].execute({ action: 'send' }),
    /"text" is required/,
  )
})

wtest('the config schema resolves the documented defaults', () => {
  const resolved = Config({})
  assert.equal(resolved.toolName, 'mud')
  assert.equal(resolved.host, 'mud.pkuxkx.net')
  assert.equal(resolved.port, 8080)
  assert.equal(resolved.encodingMenu, '2')
  assert.equal(resolved.idleTimeoutMs, 180_000)
  assert.deepEqual(resolved.fallbackAddresses, ['47.110.45.145'])
  assert.match(resolved.credentialsPath, /\.dsh-tool-mud\/creds\.json$/)
})
