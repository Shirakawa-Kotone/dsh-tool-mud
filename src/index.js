/**
 * dsh-tool-mud — one `mud` tool backed by a single long-lived telnet session.
 *
 * Everything is configurable, nothing connects at import time: a profile that
 * loads this plugin but never calls the tool opens no socket at all.
 */
import os from 'node:os'
import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DEFAULT_IDLE_MS, MudSession } from './session.js'
import { FullmeFlow } from './fullme.js'
import { createNotes } from './notes.js'
import { createPanelRoutes } from './routes.js'

export const name = 'tool-mud'
export const inject = ['tools']

const dataHome = path.join(os.homedir(), '.dsh-tool-mud')

export const Config = z.object({
  toolName: z.string().default('mud').description('Name the tool is registered under.'),
  host: z.string().default('mud.pkuxkx.net').description('MUD host name.'),
  port: z.number().step(1).min(1).max(65535).default(8080).description('MUD telnet port.'),
  encoding: z.string().default('utf-8').description('TextDecoder encoding for the stream.'),
  encodingMenu: z.string().default('2').description('Key to type at the server encoding menu.'),
  credentialsPath: z.string().default(path.join(dataHome, 'creds.json'))
    .description('JSON file with { "id": ..., "password": ... }.'),
  logDir: z.string().default(path.join(dataHome, 'logs'))
    .description('Directory for daily transcript files; empty string disables logging.'),
  fallbackAddresses: z.array(z.string()).default(['47.110.45.145'])
    .description('Addresses tried in order when DNS resolution fails.'),
  idleTimeoutMs: z.number().step(1).min(0).default(DEFAULT_IDLE_MS)
    .description('Idle time before the session saves and quits itself; 0 disables the watchdog.'),
  panelRoutePrefix: z.string().default('/dsh-tool-mud')
    .description('Base path of the MUD panel endpoints, served when a webServer is composed.'),
  planPath: z.string().default('').description('File shown as the plan section; empty hides it.'),
  diaryPath: z.string().default('').description('File shown as the diary section; empty hides it.'),
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function clip(text, max = 6000) {
  if (text.length <= max) return text
  return `…[${text.length - max} chars trimmed]…\n` + text.slice(-max)
}

/**
 * Apply the host's own browser fence (Host/Origin checks plus the session cookie)
 * to our routes. A custom webServer route is public by default; this is the only
 * thing standing between a stray request and a session that types into the game.
 */
function fence(ctx, handler) {
  return async (req, res) => {
    const connection = ctx.get('connection')
    // Fail closed: a route that types into the game must never be reachable
    // just because the connection service is not composed (or not yet active).
    const rejection = connection ? connection.requestRejection(req) : 403
    if (rejection !== undefined) {
      res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
      return
    }
    await handler(req, res)
  }
}

function needsHumanNote(session) {
  if (!session.needsHuman) return ''
  const { kind, since } = session.needsHuman
  return `\n>>> [needs-human] ${kind} 验证码在等人工处理（自 ${since}）。先用 \`fullme\` 取图，人读出后 \`fullme <字>\`。\n`
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config
 */
export function apply(ctx, config = {}) {
  const idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_MS
  const session = new MudSession({
    host: config.host ?? 'mud.pkuxkx.net',
    port: config.port ?? 8080,
    encoding: config.encoding ?? 'utf-8',
    encodingMenu: config.encodingMenu ?? '2',
    credentialsPath: config.credentialsPath ?? path.join(dataHome, 'creds.json'),
    logDir: config.logDir === undefined ? path.join(dataHome, 'logs') : config.logDir,
    fallbackAddresses: config.fallbackAddresses ?? ['47.110.45.145'],
    idleTimeoutMs,
  })

  ctx.effect(() => () => session.close())

  const flow = new FullmeFlow({ session })
  // A dropped socket ends the challenge; the lock must not outlive it.
  session.onDisconnect = () => flow.abort()
  const notes = createNotes({
    planPath: config.planPath ?? '',
    diaryPath: config.diaryPath ?? '',
  })
  const routePrefix = config.panelRoutePrefix ?? '/dsh-tool-mud'

  // The panel routes exist only where a browser-facing webserver is composed;
  // a headless host still gets the tool, just no panel.
  ctx.inject(['webServer'], (child) => {
    child.effect(() => {
      const disposers = createPanelRoutes({
        flow,
        journal: session.journal,
        notes,
        session,
        prefix: routePrefix,
      })
        .map((route) => child.webServer.register({ ...route, handler: fence(child, route.handler) }))
      return () => disposers.forEach((dispose) => dispose())
    })
  })

  const toolName = config.toolName ?? 'mud'

  ctx.tools.register(defineTool({
    name: toolName,
    description:
      'Interact with the 北大侠客行 MUD through one persistent telnet session. '
      + 'action "login" connects and types the stored id/password (nothing else); '
      + '"send" types one command and returns the new output; "read" returns output that '
      + 'arrived since the last call; "status" reports the connection; "close" hangs up. '
      + 'The session saves and disconnects itself after '
      + `${Math.round(idleTimeoutMs / 60000)} minutes with no tool call. `
      + 'fullme captchas are only detected, never solved: a human has to read the image.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['login', 'send', 'read', 'status', 'close'],
        description: 'What to do.',
      },
      text: {
        type: 'string',
        description: 'The command line to type (required for "send").',
      },
      wait: {
        type: 'number',
        description: 'Seconds to keep reading after sending (default 1.2, max 30).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          output: { type: 'string', required: true },
          connected: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.output }],
    },
    async execute(args) {
      session.touch()
      const waitMs = Math.min(Math.max(Number(args.wait ?? 1.2), 0.3), 30) * 1000
      let output = ''

      switch (args.action) {
        case 'login':
          output = await session.login()
          break
        case 'send': {
          if (typeof args.text !== 'string') throw new Error(`mud: "text" is required for action "send"`)
          if (!session.connected) await session.connect()
          output = await session.send(args.text, { quietMs: waitMs })
          break
        }
        case 'read':
          await sleep(Math.min(waitMs, 5000))
          output = session.take()
          break
        case 'status':
          output = JSON.stringify(session.status())
          break
        case 'close':
          session.close()
          output = 'closed'
          break
        default:
          throw new Error(`mud: unknown action ${args.action}`)
      }

      const note = needsHumanNote(session)
      if (note) output += note
      if (!output.trim()) output = '(no new output)'
      return { output: clip(output), connected: session.connected }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `MUD: ${args.action}${args.text ? ` ${args.text}` : ''}`,
      kind: 'other',
      rawInput: args.text ?? args.action,
    }),
  }))
}
