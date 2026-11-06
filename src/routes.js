/**
 * The HTTP side of the MUD panel, served to the plugin's own browser half.
 *
 * Plain node:http handlers registered on `ctx.webServer` — the browser half
 * needs no typert codegen, just same-origin `fetch`. Every route answers JSON
 * and never throws out of the handler.
 *
 *   GET  <prefix>/status          connection + fullme state
 *   GET  <prefix>/journal?since=N new panel events after cursor N
 *   GET  <prefix>/notes           the agent's plan and diary tails
 *   POST <prefix>/fullme/start    ask the server for a captcha
 *   POST <prefix>/fullme/submit   submit the two characters a human read
 *   POST <prefix>/fullme/cancel   release the session without submitting
 */

const MAX_BODY_BYTES = 4096

/**
 * The one place the panel prefix is decided. The browser bundle hardcodes the
 * same string, so this is deliberately NOT a config knob: a prefix the client
 * cannot learn would silently 404 the whole panel.
 */
export const PANEL_PREFIX = '/dsh-tool-mud'

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  return raw ? JSON.parse(raw) : {}
}

function query(req) {
  return new URL(req.url ?? '/', 'http://panel.invalid').searchParams
}

/**
 * @param {object} options
 * @param {import('./fullme.js').FullmeFlow} options.flow
 * @param {ReturnType<import('./journal.js').createJournal>} options.journal
 * @param {ReturnType<import('./notes.js').createNotes>} options.notes
 * @param {import('./session.js').MudSession} options.session
 * @param {string} [options.prefix]
 */
export function createPanelRoutes({ flow, journal, notes, session, prefix = PANEL_PREFIX }) {
  const status = {
    kind: 'exact',
    path: `${prefix}/status`,
    async handler(_req, res) {
      const state = session.status()
      sendJson(res, 200, {
        ok: true,
        connected: state.connected,
        host: state.host,
        lock: state.lock,
        watchdog: state.watchdog,
        idleTimeoutMs: state.idleTimeoutMs,
        needsHuman: state.needsHuman,
        idleLogoutInMs: state.idleLogoutInMs,
        lastIdleLogout: state.lastIdleLogout,
        ...flow.state(),
      })
    },
  }

  const journalRoute = {
    kind: 'exact',
    path: `${prefix}/journal`,
    async handler(req, res) {
      const cursor = Number(query(req).get('since') ?? 0)
      const page = journal.since(Number.isFinite(cursor) ? cursor : 0)
      sendJson(res, 200, { ok: true, cursor: page.cursor, entries: page.entries })
    },
  }

  const notesRoute = {
    kind: 'exact',
    path: `${prefix}/notes`,
    async handler(_req, res) {
      sendJson(res, 200, { ok: true, ...notes.read() })
    },
  }

  const start = {
    kind: 'exact',
    path: `${prefix}/fullme/start`,
    async handler(_req, res) {
      try {
        const state = await flow.start()
        sendJson(res, 200, { ok: true, ...state })
      } catch (error) {
        sendJson(res, 502, { ok: false, error: String(error?.message ?? error), ...flow.state() })
      }
    },
  }

  const submit = {
    kind: 'exact',
    path: `${prefix}/fullme/submit`,
    async handler(req, res) {
      try {
        // A double-click on 提交 must not look like a second answer.
        if (flow.state().phase !== 'waiting') {
          sendJson(res, 409, { ok: false, error: '没有进行中的 fullme 验证', ...flow.state() })
          return
        }
        const body = await readJson(req)
        const result = await flow.submit(body.answer)
        sendJson(res, 200, {
          ok: true,
          output: result.output,
          ...result.state,
          needsHuman: session.needsHuman,
        })
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message ?? error), ...flow.state() })
      }
    },
  }

  const cancel = {
    kind: 'exact',
    path: `${prefix}/fullme/cancel`,
    async handler(_req, res) {
      sendJson(res, 200, { ok: true, ...flow.cancel() })
    },
  }

  return [status, journalRoute, notesRoute, start, submit, cancel]
}
