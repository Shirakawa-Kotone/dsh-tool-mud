# dsh-tool-mud

把北大侠客行（pkuxkx）的 telnet 终端做成一个 DSH 插件：注册一个 `mud` 工具，内部维护**一条常驻连接**，
让 agent 一行一行敲命令、只读增量回显。

设计上只有两件事是自动的：**登录时填账号密码**、**闲置 3 分钟自动 `save` + `quit`**。
其余一律由调用方决定——这个插件是终端，不是代打脚本。

```
{ "action": "login" }               // 连接 + 只在这一步自动填 id / password
{ "action": "send", "text": "hp" }  // 敲一行，返回新输出
{ "action": "read" }                // 只返回上次之后的新输出
{ "action": "status" }              // 连接状态 / 闲置倒计时 / 待人工项
{ "action": "close" }               // 挂断
```

## fullme：只检测，不求解

验证码是图片，需要人眼看（见 `agent-xkx/state/captcha/README.md` 里记录的一串失败尝试）。
所以本插件**不做任何 fullme 自动化**：

- 服务器吐回 `fullme.pkuxkx.net/robot.php?filename=…` 或 `指令格式: fullme 验证码` 时，
  会话只把 `needsHuman` 标成 `{ kind: "fullme", since }`；
- `status` 会报出这个标记，每份输出末尾追加一行 `>>> [needs-human] …` 提醒；
- 人读出两个字之后，照常用 `send` 敲 `fullme 自己` 就行，标记随之清掉。

等真人到场的时机再做自动化，是刻意的取舍。

## 安装

插件本身是一个普通的 cordis 插件包（`name` / `inject` / `Config` / `apply`）。

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
| `idleTimeoutMs` | `180000` | 无工具调用多久后自动下线；`0` 关闭看门狗 |

## 实现要点

- **telnet 协商是有状态的**：`IAC` / 子协商可能被 TCP 切断，跨 chunk 的半个序列会留在
  `pending` 里等到下一块，而不是像早期版本那样直接丢掉（那会吃掉后续字节）。
- **UTF-8 用流式解码**，ANSI 转义也会跨 chunk 续上（`stripAnsi` 返回 `carry`）。
- **登录提示按出现位置排序**，不是按正则表顺序，避免 id/密码答反。
- **转录**：`HH:MM:SS << 服务器` / `>> 我发的`，密码一律 `******`。
- **不连接**：插件 import 和 `apply` 都不开 socket，调用 `login` / `send` 才连。
- **DNS 兜底**：`dns.resolve4` 绕过 getaddrinfo（本机 getaddrinfo 会间歇性 `ENOTFOUND`）。

## 开发

```bash
node --test test/     # 30 个用例，全部离线，不碰真服务器
```

| 文件 | 职责 |
|---|---|
| `src/index.js` | 插件入口：`Config` 默认值 + 工具定义 + 动作分发 |
| `src/session.js` | 会话：连接、登录、发送、缓冲、闲置看门狗、fullme 标记 |
| `src/telnet.js` | IAC 协商状态机、ANSI 清理、换行归一 |
| `src/prompts.js` | 登录提示表 + fullme 识别 |
| `src/transcript.js` | 按日转录 |

测试用假 socket（`test/helpers.js`），所以**跑测试不会抢占线上会话**；
同理，本地调试也别在线上那条连接活着的时候 `login`——同一个角色只允许一条连接，
新连会把正在玩的那个踢下去。

## 许可

MIT
