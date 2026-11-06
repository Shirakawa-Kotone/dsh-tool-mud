/**
 * dsh-tool-mud — browser half.
 *
 * One surface, two seats:
 *   sidebarRightTabs + sidebar.right.pane.tab → the "MUD" right-sidebar panel
 *   conversation.session.header.utilities    → a button that opens it
 *
 * The panel is a viewer, not a client: it asks the host half for three things
 * (status, journal, notes) and renders them. Its only actions are the fullme
 * ones, because a captcha needs a human and nothing else does.
 *
 * Hand-written in the loader's bundle form, so the package needs no build step.
 */
window.__ModuleLoader__.load({
  id: 'dsh-tool-mud',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement

    /** Tab identity: unique across every registration, and the body's slot key. */
    const TAB_ID = 'dsh-tool-mud'
    const TAB_KIND = 'mud-panel'
    // Document-relative, like every shipped bundle: the shell serves the app
    // with `<base href="./">`, so an absolute path breaks behind a path prefix.
    const ENDPOINT = 'dsh-tool-mud'

    async function request(path, body) {
      const response = body === undefined
        ? await fetch(path, { headers: { accept: 'application/json' } })
        : await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      if (response.status === 404) throw new Error('主机端没有响应（面板路由未注册）')
      try {
        return await response.json()
      } catch {
        throw new Error(`面板接口返回了非 JSON 响应（HTTP ${response.status}）`)
      }
    }

    const api = {
      status: () => request(`${ENDPOINT}/status`),
      journal: (since) => request(`${ENDPOINT}/journal?since=${since}`),
      notes: () => request(`${ENDPOINT}/notes`),
      fullme: (action, body) => request(`${ENDPOINT}/fullme/${action}`, body),
    }

    const styles = {
      root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, font: '12px/1.5 system-ui, -apple-system, sans-serif' },
      header: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexWrap: 'wrap',
        padding: '10px 12px 8px',
        borderBottom: '1px solid var(--dsh-colors-border, rgba(127,127,127,0.22))',
      },
      chip: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '1px 7px',
        borderRadius: '999px',
        border: '1px solid var(--dsh-colors-border, rgba(127,127,127,0.3))',
        fontSize: '11px',
        whiteSpace: 'nowrap',
      },
      dot: (on) => ({
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: on ? 'var(--dsh-colors-success, #3fb950)' : 'var(--dsh-colors-text-tertiary, #8b8b8b)',
      }),
      tabs: {
        display: 'flex',
        gap: '2px',
        padding: '6px 8px',
        borderBottom: '1px solid var(--dsh-colors-border, rgba(127,127,127,0.22))',
      },
      tab: (active) => ({
        padding: '3px 9px',
        borderRadius: '6px',
        border: 'none',
        cursor: 'pointer',
        fontSize: '12px',
        color: active ? 'var(--dsh-colors-text-primary, inherit)' : 'var(--dsh-colors-text-secondary, #8b8b8b)',
        background: active ? 'rgba(127,127,127,0.16)' : 'transparent',
      }),
      body: { flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 10px 14px' },
      pre: {
        margin: 0,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11px',
        lineHeight: 1.55,
      },
      row: { display: 'flex', gap: '6px', alignItems: 'baseline', marginBottom: '1px' },
      time: { opacity: 0.45, fontFamily: 'ui-monospace, monospace', fontSize: '10px', flex: '0 0 auto' },
      actor: (actor) => ({
        fontSize: '10px',
        padding: '0 4px',
        borderRadius: '3px',
        flex: '0 0 auto',
        background: actor === 'human'
          ? 'rgba(63,185,80,0.18)'
          : actor === 'login' ? 'rgba(127,127,127,0.22)' : 'rgba(79,124,255,0.18)',
      }),
      button: {
        height: '24px',
        padding: '0 9px',
        borderRadius: '6px',
        border: '1px solid var(--dsh-colors-border, rgba(127,127,127,0.3))',
        background: 'transparent',
        color: 'inherit',
        fontSize: '12px',
        cursor: 'pointer',
      },
      primary: {
        height: '26px',
        padding: '0 12px',
        borderRadius: '6px',
        border: '1px solid transparent',
        background: 'var(--dsh-colors-accent, #4f7cff)',
        color: '#fff',
        fontSize: '12px',
        fontWeight: 600,
        cursor: 'pointer',
      },
      input: {
        flex: 1,
        minWidth: 0,
        height: '26px',
        padding: '0 8px',
        borderRadius: '6px',
        border: '1px solid var(--dsh-colors-border, rgba(127,127,127,0.3))',
        background: 'transparent',
        color: 'inherit',
        fontSize: '13px',
      },
      fullme: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '8px 12px',
        borderBottom: '1px solid var(--dsh-colors-border, rgba(127,127,127,0.22))',
      },
      warn: { fontSize: '11px', color: 'var(--dsh-colors-warning, #d98c24)' },
      error: { fontSize: '11px', color: 'var(--dsh-colors-danger, #e5534b)' },
      muted: { fontSize: '11px', opacity: 0.6 },
      image: { width: '100%', maxWidth: '220px', borderRadius: '6px', background: '#fff' },
      empty: { fontSize: '11px', opacity: 0.55, padding: '10px 0' },
    }

    const VIEWS = [
      { id: 'log', label: '日志' },
      { id: 'ops', label: 'AI 操作' },
      { id: 'plan', label: '下一步' },
      { id: 'diary', label: '日记' },
    ]

    function actorLabel(entry) {
      if (entry.kind === 'event') return '事件'
      if (entry.actor === 'human') return '人工'
      if (entry.actor === 'login') return '登录'
      return '模型'
    }

    /**
     * The panel. Polls while mounted: the journal on a short tick (it is the live
     * feed), status and notes on a slower one. Nothing here is authoritative —
     * the host's session state always wins, this only renders what it reports.
     */
    function MudPanel() {
      const [tab, setTab] = React.useState('log')
      const [status, setStatus] = React.useState(null)
      const [entries, setEntries] = React.useState([])
      const [notes, setNotes] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [answer, setAnswer] = React.useState('')
      const [output, setOutput] = React.useState('')
      const cursor = React.useRef(0)
      const scroller = React.useRef(null)

      React.useEffect(() => {
        let alive = true
        let journalTimer
        let slowTimer

        const pollJournal = async () => {
          try {
            const page = await api.journal(cursor.current)
            if (!alive) return
            cursor.current = page.cursor
            if (page.entries.length) {
              setEntries((previous) => previous.concat(page.entries).slice(-800))
            }
            setError(null)
          } catch (failure) {
            if (alive) setError(String(failure.message ?? failure))
          }
          if (alive) journalTimer = setTimeout(pollJournal, 1000)
        }

        const pollSlow = async () => {
          try {
            const [nextStatus, nextNotes] = await Promise.all([api.status(), api.notes()])
            if (!alive) return
            setStatus(nextStatus)
            setNotes(nextNotes)
            setError(null)
          } catch (failure) {
            if (alive) setError(String(failure.message ?? failure))
          }
          if (alive) slowTimer = setTimeout(pollSlow, 3000)
        }

        pollJournal()
        pollSlow()
        return () => {
          alive = false
          clearTimeout(journalTimer)
          clearTimeout(slowTimer)
        }
      }, [])

      // Keep the live feed pinned to the bottom while it grows.
      React.useEffect(() => {
        const node = scroller.current
        if (node) node.scrollTop = node.scrollHeight
      }, [entries.length, tab])

      const startChallenge = async () => {
        setBusy(true)
        setError(null)
        setOutput('')
        try {
          const data = await api.fullme('start', {})
          if (!data.ok) throw new Error(data.error ?? '取验证码失败')
          setStatus((previous) => ({ ...(previous ?? {}), ...data }))
        } catch (failure) {
          setError(String(failure.message ?? failure))
        } finally {
          setBusy(false)
        }
      }

      const submitAnswer = async () => {
        if (!answer.trim()) {
          setError('先填两个汉字')
          return
        }
        setBusy(true)
        setError(null)
        try {
          const data = await api.fullme('submit', { answer: answer.trim() })
          if (!data.ok) throw new Error(data.error ?? '提交失败')
          setAnswer('')
          setOutput(data.output ?? '')
          setStatus((previous) => ({ ...(previous ?? {}), ...data }))
        } catch (failure) {
          setError(String(failure.message ?? failure))
        } finally {
          setBusy(false)
        }
      }

      const cancelHandoff = async () => {
        setBusy(true)
        setError(null)
        try {
          const data = await api.fullme('cancel', {})
          setStatus((previous) => ({ ...(previous ?? {}), ...data }))
        } catch (failure) {
          setError(String(failure.message ?? failure))
        } finally {
          setBusy(false)
        }
      }

      const waiting = status?.phase === 'waiting'
      const locked = Boolean(status?.lock)

      const header = h('div', { style: styles.header },
        h('span', { style: styles.chip },
          h('span', { style: styles.dot(Boolean(status?.connected)) }),
          status?.connected ? `已连接 ${status.host ?? ''}`.trim() : '未连接'),
        locked ? h('span', { style: styles.chip }, '🐱 人工接管中') : null,
        status?.needsHuman ? h('span', { style: styles.chip }, 'fullme 待处理') : null,
        status?.watchdog === false
          ? h('span', { style: styles.muted }, '看门狗关闭')
          : status?.idleLogoutInMs != null && !locked
            ? h('span', { style: styles.muted }, `${Math.max(0, Math.round(status.idleLogoutInMs / 1000))}s 后闲置下线`)
            : null)

      const fullmeBar = waiting
        ? h('div', { style: { ...styles.fullme, background: 'rgba(217,140,36,0.06)' }, 'data-panel': 'fullme' },
          h('div', { style: styles.warn }, '验证码待人工处理，模型操作已暂停'),
          status?.imageUrl
            ? h('img', { src: status.imageUrl, alt: 'fullme 验证码', style: styles.image })
            : h('div', { style: styles.muted }, '正在取图…'),
          h('div', { style: { display: 'flex', gap: '6px' } },
            h('input', {
              value: answer,
              placeholder: '两个汉字，不要空格',
              style: styles.input,
              onChange: (event) => setAnswer(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') submitAnswer() },
            }),
            h('button', {
              type: 'button',
              'data-action': 'fullme-submit',
              style: styles.primary,
              disabled: busy,
              onClick: () => submitAnswer(),
            }, '提交'),
            h('button', {
              type: 'button',
              'data-action': 'fullme-cancel',
              style: styles.button,
              disabled: busy,
              onClick: () => cancelHandoff(),
            }, '取消接管')))
        : h('div', { style: styles.fullme },
          h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
            h('button', {
              type: 'button',
              'data-action': 'fullme-start',
              style: styles.button,
              disabled: busy || !status?.connected,
              onClick: () => startChallenge(),
            }, busy ? '取图中…' : '开始 fullme 验证'),
            h('span', { style: styles.muted }, '需要人眼读图；期间模型操作会暂停')))

      const tabsBar = h('div', { style: styles.tabs },
        VIEWS.map((view) => h('button', {
          key: view.id,
          type: 'button',
          style: styles.tab(tab === view.id),
          'data-tab': view.id,
          onClick: () => setTab(view.id),
        }, view.label)))

      let body
      if (tab === 'log' || tab === 'ops') {
        const rows = entries.filter((entry) => (tab === 'log'
          ? entry.kind === 'server'
          : entry.kind === 'agent' || entry.kind === 'event'))
        body = rows.length
          ? rows.map((entry) => h('div', { key: entry.seq, style: styles.row },
            h('span', { style: styles.time }, entry.at.slice(11, 19)),
            entry.kind === 'server'
              ? h('span', { style: { flex: 1, wordBreak: 'break-word' } }, entry.text)
              : h(React.Fragment, null,
                h('span', { style: styles.actor(entry.actor) }, actorLabel(entry)),
                h('span', { style: { flex: 1, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word' } }, entry.text))))
          : h('div', { style: styles.empty }, tab === 'log' ? '还没有服务器输出' : '模型还没有操作')
      } else {
        const section = tab === 'plan' ? notes?.plan : notes?.diary
        body = section === null || section === undefined
          ? h('div', { style: styles.empty }, '没有配置这个文件')
          : h('div', null,
            h('div', { style: styles.muted },
              `${section.path}${section.mtime ? ` · ${section.mtime.slice(0, 19).replace('T', ' ')}` : ''}${section.truncated ? ' · 只显示结尾' : ''}`),
            section.error
              ? h('div', { style: styles.error }, `读取失败：${section.error}`)
              : h('pre', { style: styles.pre }, section.text))
      }

      return h('div', { style: styles.root, 'data-panel': 'mud' },
        header,
        fullmeBar,
        error ? h('div', { style: { ...styles.error, padding: '4px 12px' } }, error) : null,
        tabsBar,
        h('div', { ref: scroller, style: styles.body }, body),
        output
          ? h('pre', { style: { ...styles.pre, padding: '6px 12px', borderTop: '1px solid rgba(127,127,127,0.2)', maxHeight: '120px', overflow: 'auto' } }, output)
          : null)
    }

    /** Header button: bring the panel up for the current session. */
    function OpenTabButton({ openTab }) {
      return h('button', {
        type: 'button',
        title: '打开 MUD 面板（日志 / AI 操作 / 计划）',
        'data-action': 'mud-open',
        style: { ...styles.button, height: '26px', padding: '0 8px' },
        onClick: () => openTab(),
      }, '🐱 MUD')
    }

    // Only `slots` is a hard dependency: the header button is useful even if the
    // right sidebar never loads. The sidebar services are waited for separately,
    // so a missing one cannot hold the whole plugin at `pending` forever.
    const inject = ['slots']

    function apply(ctx) {
      const openPanel = () => {
        const sidebar = ctx.get('sidebarRight')
        if (sidebar && typeof sidebar.openTab === 'function') sidebar.openTab(TAB_KIND, {})
      }

      ctx.slots.inject('conversation.session.header.utilities', () =>
        ctx.slots.register(
          { name: 'conversation.session.header.utilities', id: 'dsh-tool-mud.open', order: -20 },
          () => h(OpenTabButton, { openTab: openPanel }),
        ))

      // The body seat is keyed by the definition id, so chip and body always
      // agree on which type they belong to.
      ctx.inject(['sidebarRightTabs'], (scoped) => {
        scoped.effect(() => scoped.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          title: () => 'MUD',
          guide: [{
            id: 'open',
            title: () => 'MUD',
            description: () => '实时日志、AI 操作、下一步计划与日记',
          }],
        }), 'dsh-tool-mud: sidebar tab type')

        scoped.slots.inject('sidebar.right.pane.tab', () => {
          return scoped.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, MudPanel)
        })
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
