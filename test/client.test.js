import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createPanelRoutes } from '../src/routes.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const BUNDLE = path.join(here, '..', 'client', 'index.js')
const source = fs.readFileSync(BUNDLE, 'utf8')

/** A React shim: apply() never renders, it only registers. */
function fakeReact() {
  const noop = () => undefined
  return {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Fragment: 'Fragment',
    useState: () => [undefined, noop],
    useEffect: noop,
    useRef: () => ({ current: null }),
    useSyncExternalStore: () => undefined,
  }
}

function loadBundle() {
  let registration
  const window = { __ModuleLoader__: { load: (entry) => { registration = entry } } }
  const module = { exports: {} }
  // The bundle is a plain script: run it with a window global, then call the factory.
  new Function('window', 'module', 'exports', source)(window, module, module.exports)
  assert.ok(registration, 'bundle did not register itself')
  return registration
}

function fakeContext() {
  const slotCalls = []
  const ctx = {
    slotCalls,
    get: () => undefined,
    effect: (factory) => { factory() },
    inject: (_names, callback) => { callback(ctx) },
    slots: {
      register: (options, component) => { slotCalls.push({ options: options.name, key: options.key, component }) },
      inject: (_name, callback) => callback(),
    },
    sidebarRightTabs: { register: (definition) => { ctx.tabType = definition } },
    sidebarRight: { openTab: () => {} },
  }
  return ctx
}

test('bundle id is the package name, so the loader can find it', () => {
  const registration = loadBundle()
  assert.equal(registration.id, 'dsh-tool-mud')
})

test('apply registers the tab type, the tab body and the header button', () => {
  const registration = loadBundle()
  const mod = registration.factory((id) => {
    if (id === 'react') return fakeReact()
    throw new Error(`unexpected module ${id}`)
  })
  const ctx = fakeContext()
  mod.apply(ctx)

  assert.equal(ctx.tabType.id, 'dsh-tool-mud')
  assert.equal(ctx.tabType.kind, 'mud-panel')
  // Switching tabs must not unmount the feed (cursor, scroll, typed answer).
  assert.equal(ctx.tabType.keepMounted, true)
  // Guide entries are sorted by `order`; a missing one yields NaN.
  assert.equal(typeof ctx.tabType.guide[0].order, 'number')
  const seats = ctx.slotCalls.map((call) => call.options)
  assert.deepEqual(seats.sort(), ['conversation.session.header.utilities', 'sidebar.right.pane.tab'])
  // The body seat must be keyed by the definition id, not by the kind.
  const body = ctx.slotCalls.find((call) => call.options === 'sidebar.right.pane.tab')
  assert.equal(body.key, ctx.tabType.id)
})

test('the endpoint the client fetches matches the routes the host registers', () => {
  const match = /const ENDPOINT = '([^']+)'/.exec(source)
  assert.ok(match, 'client ENDPOINT constant not found')
  const prefix = `/${match[1]}`

  const session = { connected: false, status: () => ({ connected: false, watchdog: true }), lock: null }
  const flow = { state: () => ({ phase: 'idle' }), submit: async () => ({}), start: async () => ({}), cancel: () => ({}) }
  const routes = createPanelRoutes({
    flow,
    session,
    journal: { since: () => ({ cursor: 0, entries: [] }) },
    notes: { read: () => ({ plan: null, diary: null }) },
  })
  for (const route of routes) {
    assert.ok(route.path.startsWith(`${prefix}/`), `${route.path} is not under ${prefix}`)
  }
  // Every path the client builds must exist on the host.
  const clientPaths = [
    `${prefix}/status`,
    `${prefix}/journal`,
    `${prefix}/notes`,
    `${prefix}/fullme/start`,
    `${prefix}/fullme/submit`,
    `${prefix}/fullme/cancel`,
  ]
  const hostPaths = new Set(routes.map((route) => route.path))
  for (const candidate of clientPaths) {
    assert.ok(hostPaths.has(candidate), `client calls ${candidate}, host has no such route`)
  }
})
