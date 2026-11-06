/**
 * The HTTP side of the manual fullme flow, served to the plugin's own panel.
 *
 * Plain node:http handlers registered on `ctx.webServer`, so the browser half
 * needs no typert codegen and no Remote descriptors: same-origin `fetch` is
 * enough. Every route answers JSON and never throws out of the handler.
 */

const MAX_BODY_BYTES = 4096

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

/**
 * @param {object} options
 * @param {import('./fullme.js').FullmeFlow} options.flow
 * @param {string} [options.prefix]
 * @returns {Array<{kind: 'exact', path: string, handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}>}
 */
export function createFullmeRoutes({ flow, prefix = '/dsh-tool-mud/fullme' }) {
  const status = {
    kind: 'exact',
    path: `${prefix}/status`,
    async handler(_req, res) {
      sendJson(res, 200, { ok: true, ...flow.state() })
    },
  }

  const start = {
    kind: 'exact',
    path: `${prefix}/start`,
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
    path: `${prefix}/submit`,
    async handler(req, res) {
      try {
        const body = await readJson(req)
        const result = await flow.submit(body.answer)
        sendJson(res, 200, {
          ok: true,
          output: result.output,
          ...result.state,
          needsHuman: flow.session.needsHuman,
        })
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message ?? error), ...flow.state() })
      }
    },
  }

  const cancel = {
    kind: 'exact',
    path: `${prefix}/cancel`,
    async handler(_req, res) {
      sendJson(res, 200, { ok: true, ...flow.cancel() })
    },
  }

  return [status, start, submit, cancel]
}
