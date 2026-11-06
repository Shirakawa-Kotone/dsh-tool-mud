# dsh-tool-mud

把北大侠客行（pkuxkx）的 telnet 终端做成一个 DSH 插件：注册一个 `mud` 工具，内部维护**一条常驻连接**，
外加一个右侧栏面板，让**人**能看日志、看 AI 在干什么、读计划和日记，并在验证码出现时接手。

设计上只有两件事是自动的：**登录时填账号密码**、**闲置 3 分钟自动 `save` + `quit`**。
其余一律由调用方决定——这个插件是终端，不是代打脚本。

```
{ "action": "login" }               // 连接 + 只在这一步自动填 id / password
{ "action": "send", "text": "hp" }  // 敲一行，返回新输出
{ "action": "read" }                // 只返回上次之后的新输出
{ "action": "status" }              // 连接状态 / 闲置倒计时 / 人工接管 / fullme
{ "action": "close" }               // 挂断（会同时解除人工接管）
```

## 面板（浏览器端）

右侧栏新增一个 **MUD** 页：会话头部的 `🐱 MUD` 按钮可以打开它，右侧栏的「+」里也有入口。
面板分四页，都是只读视图，数据来自四个 HTTP 端点：

| 页 | 内容 |
|---|---|
| 日志 | 服务器逐行输出（`<<`），自动滚到底 |
| AI 操作 | 模型敲的命令、登录自动填的账号、以及连接/闲置/接管等事件，带角色标签 |
| 下一步 | `planPath` 指向的文件末尾（默认不配） |
| 日记 | `diaryPath` 指向的文件末尾（默认不配） |

顶部状态条显示连接、人工接管、fullme 待处理、闲置倒计时。

## fullme：人工接手，只检测不求解

验证码是图片，需要人眼读（`agent-xkx/state/captcha/README.md` 记了一串失败的 OCR 尝试）。
所以插件**不求解**，只把舞台交给面板：

1. 模型撞到 `fullme` 提示时，`status` 里出现 `needsHuman`，输出末尾追加 `>>> [needs-human] …`；
2. 人在面板里点「开始 fullme 验证」→ 插件敲 `fullme`、取 `robot.php` 里的图片、把图贴出来，
   同时 **`lockSession('fullme')`：期间模型的 `login` / `send` 一律抛错**（暂停模型操作）；
3. 人读出两个字提交 → 插件敲 `fullme 自己`，解除接管；
4. 「取消接管」也可以随时放回模型；
5. 连接掉了会自动解除接管（锁不会比 socket 活得久）。

## 安装

插件本身是一个普通的 cordis 插件包（`name` / `inject` / `Config` / `apply`），
外加 `dsh.client` 声明的浏览器半包（`client/index.js`，手写、无需构建）。

```bash
# 1) 放进 profile 的 node_modules（软链）
#    ⚠️ 这一步会替换掉现有指向 agent-xkx/dsh-tool-mud 的软链 = 切到开发版
ln -sfn /Users/chen/dev/pkuxkx/dsh-tool-mud-dev \
        ~/.dsh/profiles/web/node_modules/dsh-tool-mud

# 2) 在 ~/.dsh/profiles/web/cordis.patch.yml 里插入
#    - insert:
#        - id: tool-mud
#          name: 'dsh-tool-mud'
#          config:
#            credentialsPath: /Users/chen/dev/pkuxkx/agent-xkx/state/creds.json
#            logDir: /Users/chen/dev/pkuxkx/agent-xkx/logs
#            planPath: /Users/chen/dev/pkuxkx/agent-xkx/PROGRESS.md
#            diaryPath: /Users/chen/dev/pkuxkx/agent-xkx/DIARY.md
```

改了 patch 文件会触发 profile 热重载，**那条 telnet 连接会一起重建**——线上正在玩的时候别动它。
想两个版本并存就复制一份 patch 行、把 `id` 和 `toolName` 都改成 `*-dev` / `mud_dev`。

## 配置

| 键 | 默认值 | 说明 |
|---|---|---|
| `toolName` | `mud` | 工具注册名。改掉它就能让开发副本和线上副本并存 |
| `host` | `mud.pkuxkx.net` | 服务器 |
| `port` | `8080` | telnet 端口 |
| `encoding` | `utf-8` | 解码方式 |
| `encodingMenu` | `2` | 服务器编码菜单里 UTF-8 对应的按键 |
| `credentialsPath` | `~/.dsh-tool-mud/creds.json` | `{ "id": ..., "password": ... }`，600 权限 |
| `logDir` | `~/.dsh-tool-mud/logs` | 每日转录 `mud-YYYY-MM-DD.log`；空串关闭 |
| `fallbackAddresses` | `["47.110.45.145"]` | DNS 解析失败时的兜底地址 |
| `idleTimeoutMs` | `180000` | 无工具调用多久后自动下线；**`0` 关闭看门狗** |
| `panelRoutePrefix` | `/dsh-tool-mud` | 面板端点前缀（与浏览器端硬编码一致，改了两边都要改） |
| `planPath` | 空 | 面板「下一步」页读的文件；空则隐藏 |
| `diaryPath` | 空 | 面板「日记」页读的文件；空则隐藏 |

## 端点

`ctx.webServer` 上的六个 `exact` 路由（`handler(req, res)`，原生 node http）：

```
GET  /dsh-tool-mud/status
GET  /dsh-tool-mud/journal?since=N   → { cursor, entries[] }
GET  /dsh-tool-mud/notes             → { plan, diary }
POST /dsh-tool-mud/fullme/start
POST /dsh-tool-mud/fullme/submit     { answer }
POST /dsh-tool-mud/fullme/cancel
```

自定义路由默认是**公开**的，所以每个 handler 都套了一层 `ctx.connection.requestRejection(req)`
（Host/Origin + 浏览器 cookie 围栏）；服务不存在时按 403 拒绝，而不是放行——
这些端点能往游戏里打字，不能失败即放行。

## 实现要点

- **telnet 协商是有状态的**：`IAC` / 子协商可能被 TCP 切断，跨 chunk 的半个序列会留在
  `pending` 里等到下一块，而不是像早期版本那样直接丢掉。
- **UTF-8 用流式解码**，ANSI 转义也会跨 chunk 续上（`stripAnsi` 返回 `carry`）。
- **登录提示按出现位置排序**，不是按正则表顺序，避免 id/密码答反。
- **串行化**：`login` / `send` 走同一条 promise 队列，并发调用不会互相 `take()` 掉缓冲。
- **单飞连接**：并发 `connect()` 共享同一个 in-flight promise，不会开出两条 socket。
- **转录**：`HH:MM:SS << 服务器` / `>> 我发的`，密码一律 `******`。
- **不连接**：插件 import 和 `apply` 都不开 socket，调用 `login` / `send` 才连。
- **DNS 兜底**：`dns.resolve4` 绕过 getaddrinfo（本机 getaddrinfo 会间歇性 `ENOTFOUND`）。

## 开发

```bash
node --test test/     # 67 个用例，全部离线，不碰真服务器
```

| 文件 | 职责 |
|---|---|
| `src/index.js` | 插件入口：`Config` 默认值、工具定义、路由注册 + 围栏 |
| `src/session.js` | 会话：连接、登录、发送、缓冲、闲置看门狗、人工接管锁 |
| `src/telnet.js` | IAC 协商状态机、ANSI 清理、换行归一 |
| `src/prompts.js` | 登录提示表 + fullme 识别 |
| `src/transcript.js` | 按日转录 |
| `src/journal.js` | 面板用的有界事件环（带 `seq` 游标） |
| `src/notes.js` | 计划/日记文件尾部读取 |
| `src/fullme.js` | 人工 fullme 流程（取图 / 提交 / 取消 / 断线中止） |
| `src/routes.js` | 六个 JSON 端点 |
| `client/index.js` | 浏览器半包：右侧栏页 + 会话头部按钮 |

测试用假 socket（`test/helpers.js`），所以**跑测试不会抢占线上会话**；
同理，本地调试也别在线上那条连接活着的时候 `login`——同一个角色只允许一条连接，
新连会把正在玩的那个踢下去。

独立验证（不碰 `~/.dsh`）：`DSH_HOME=/tmp/dsh-scratch dsh web --port 3099`，
profile 里把 `host` 指到 `127.0.0.1:9`（死端口），这样任何误点都连不到真服务器。

## 许可

MIT
