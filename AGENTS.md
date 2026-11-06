# AGENTS.md — 给下一个 agent 的配置指南

你要把这个插件装进一台已经装了 DeepSeek Harness（DSH）0.2.x 的机器上，并让它跑起来。
按下面的顺序做，**每一步都有可验证的结果**，不要跳过验证去猜。

---

## 0. 先搞清楚这是什么

一个 DSH 插件包，两个半身：

| 半身 | 文件 | 干什么 |
|---|---|---|
| 主机半 | `src/` | 注册 `mud` 工具，维持一条到 `mud.pkuxkx.net:8080` 的 telnet 连接；另外在 `ctx.webServer` 上开 6 个 JSON 路由 |
| 浏览器半 | `client/index.js` | 右侧栏的 **MUD** 页（日志 / AI 操作 / 下一步 / 日记）+ 会话头部的 `🐱 MUD` 按钮 |

没有构建步骤，没有 `npm install` 的必要（运行时依赖只有 DSH 自带的那几个包）。
测试是纯离线的，**跑测试不会连接游戏服务器**。

---

## 1. 前置检查（缺一个都别往下走）

```bash
node --version                 # 需要 >= 22
ls -d ~/.dsh/profiles/web      # 目标 profile 存在
ls ~/.dsh/profiles/web/cordis.patch.yml
```

确认要装的是哪个 profile。本机默认是 `web`；如果对方用的是别的 profile 名，把下面所有 `web` 换掉。

> ⚠️ **先问人：现在有没有人在玩？**
> 同一个角色只允许一条 telnet 连接。改 `cordis.patch.yml` 会触发 profile 热重载，
> 正在跑的那条连接会被重建——正在玩的人会被踢下线。有人在玩就先停下，等空档。

---

## 2. 装包：软链进 profile

```bash
ln -sfn "$(pwd)" ~/.dsh/profiles/web/node_modules/dsh-tool-mud
ls -l ~/.dsh/profiles/web/node_modules/dsh-tool-mud     # 应指向本仓库
```

如果这个路径已经存在且指向**另一个版本**（比如旧的 `agent-xkx/dsh-tool-mud`），
`ln -sfn` 会直接覆盖。覆盖前先记下它原来指向哪里，回滚要用。

---

## 3. 准备账号文件

插件**不会**帮你创建这个文件，也不会 chmod。它必须存在且字段完整，否则 `login` 会直接报错
（这是故意的：缺凭据时往游戏里打空行，看起来像“登录坏了”）。

```bash
mkdir -p ~/.dsh-tool-mud
printf '{"id":"你的英文名","password":"你的密码"}' > ~/.dsh-tool-mud/creds.json
chmod 600 ~/.dsh-tool-mud/creds.json
```

字段只有两个：`id`、`password`。文件是 JSON，不要写成 `{id: ...}`。

如果这台机器上已经有别处存着的 pkuxkx 凭据（例如 `~/pkuxkx/state/creds.json`），
**不要去复制或打印它**，直接把 `credentialsPath` 指过去就行。

---

## 4. 写配置：`cordis.patch.yml`

在 `~/.dsh/profiles/web/cordis.patch.yml` 里加一段（放在文件末尾即可，注意 YAML 缩进）：

```yaml
- insert:
    - id: tool-mud
      name: 'dsh-tool-mud'
      config:
        toolName: mud                     # 想和别的实例并存就改成 mud_dev
        host: mud.pkuxkx.net
        port: 8080
        encoding: utf-8
        encodingMenu: '2'                 # 服务器开场菜单里 UTF-8 的按键
        credentialsPath: ~/.dsh-tool-mud/creds.json
        logDir: ~/.dsh-tool-mud/logs      # 每日转录；空串 = 关闭
        fallbackAddresses:
          - 47.110.45.145                 # DNS 挂了时的兜底 IP
        idleTimeoutMs: 180000             # 3 分钟无工具调用自动 save+quit；0 = 关闭看门狗
        # planPath: ~/notes/PROGRESS.md   # 可选：右侧栏「下一步」页
        # diaryPath: ~/notes/DIARY.md     # 可选：右侧栏「日记」页
```

要点：

- **`credentialsPath` 必须写**，否则默认值 `~/.dsh-tool-mud/creds.json` 可能不存在（见第 3 步）；
- 所有路径支持 `~/`，插件会用 `os.homedir()` 展开；
- **不要**加 `panelRoutePrefix`——面板前缀固定为 `/dsh-tool-mud`，客户端硬编码了它，做成配置只会静默 404；
- 改完这个文件会热重载，等于重启那条 telnet 连接。

### 想新旧版本并存

```yaml
    - id: tool-mud-dev
      name: 'dsh-tool-mud'
      config:
        toolName: mud_dev                 # ← 关键：工具名不同就不会抢同一个工具
        # 其余同上
```

这样 `/mud` 和 `/mud_dev` 各自一条连接。**但同一个角色还是只能有一条**：
两个实例同时 `login`，后登录的会把先登录的踢下线。

---

## 5. 验证（按顺序做，每步都有确定结果）

**5.1 测试套件**

```bash
node --test test/
# 期望：ℹ tests 84 / pass 84 / fail 0
# 裸克隆（没有 node_modules）时：9 个 wiring 用例自动跳过，其余全过
```

**5.2 插件是否被加载**

打开 GUI（DSH 会打印 `http://127.0.0.1:<port>/?token=...`），进「插件」页，
应能看到 `dsh-tool-mud` 且状态是 **active**。

**5.3 路由是否活着**

GUI 的地址带 token；不带 cookie 会被拒（这是设计，不是 bug）：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/dsh-tool-mud/status
# 期望：401 —— 围栏生效
```

带 cookie（用浏览器里那份）访问应返回 JSON：

```json
{"ok":true,"connected":false,"phase":"idle","watchdog":true,...}
```

**5.4 面板是否出现**

在 GUI 里新建/打开一个会话 → 右侧栏 → **MUD** 页应能打开，顶部有连接状态条。
如果只有按钮没有页面，看浏览器控制台：`apply` 抛错会留一条红字。

**5.5 真的连一次（确认没人在玩再执行）**

```jsonc
{"action":"login"}    // 期望：返回登录欢迎语；失败会明确报凭据/网络错误
{"action":"status"}   // 期望：connected: true
{"action":"close"}    // 用完就关，别晾着
```

---

## 6. 故障对照表

| 现象 | 原因 | 处理 |
|---|---|---|
| `凭据文件缺失或不完整` | 第 3 步没做 / `credentialsPath` 写错 | 补文件或改配置 |
| 面板 401/403 | cookie 过期、Host/Origin 不匹配，或插件没拿到 `connection` 服务 | 刷新页面重新认证；确认 profile 里 `connection` 是启用的 |
| 面板 404 | 前缀不对 / 插件没加载 | 前缀固定 `/dsh-tool-mud`；去插件页看 active |
| `会话已被人工接管（fullme），模型操作已暂停` | 人在面板里开了 fullme | **不要绕过**。等人提交或取消，或让人点「取消接管」 |
| 登录后秒被踢 | 同一个角色在别处登录了 | 只保留一条连接 |
| `ENOTFOUND` | 本机 DNS 抽风 | 已经用 `dns.resolve4` + `fallbackAddresses` 兜底；仍失败就查网络 |
| 日志目录报错但游戏没断 | 转录写入失败（EISDIR/ENOSPC） | 预期行为：只关日志，不停会话；修 `logDir` 即可 |
| 面板显示「看门狗关闭」 | `idleTimeoutMs: 0` | 正常，说明没配自动下线 |

---

## 7. 禁令（给 agent 的硬约束）

1. **不要在有人玩的时候改 `cordis.patch.yml`**——会重建连接，把人踢下线。
2. **不要用 `send` 敲密码**。`login` 会自动填，且密码在转录/journal 里都是 `******`；
   `send` 会把它写进缓冲区、返回给模型、写进日志（除非值命中了打码规则）。
3. **不要尝试自动解 fullme**。图片验证码是给人看的；看到 `needsHuman` 就告诉人，让人在面板里点。
4. **不要并发登录同一个角色**。
5. **不要把 `creds.json` 提交进仓库**。仓库的 `.gitignore` 只挡了 `node_modules` / `*.log` / `.DS_Store`。
6. **不要在锁住时绕 `bypassLock`**。只有 fullme 流程内部才用它。

---

## 8. 回滚

```bash
# 1) 删掉 patch 里那段 - insert:
# 2) 恢复原来的软链（如果你覆盖了别的版本）
ln -sfn /原来的/路径 ~/.dsh/profiles/web/node_modules/dsh-tool-mud
# 3) 等热重载，或重启 dsh web
```

配置项写错了导致插件起不来时，最快恢复是先把 `cordis.patch.yml` 里那段整块注释掉。

---

## 9. 给 agent 的工具语义（装好后用得上）

```
login   连接 + 选 UTF-8 + 填 id/password；只在需要登录时调
send    敲一行，返回新输出；默认等 1.2s 静默、最多 15s
read    只返回上次之后的新输出（与 send 串行，不会互相抢）
status  连接 / 缓冲 / 闲置倒计时 / 人工接管 / fullme
close   挂断（同时解除人工接管）
```

- 输出是**增量**的：每次 `send` 只返回这一条命令的响应，不是全屏重绘；
- 服务器是中文 MUD，`hp`、`look`、`i`、`score` 这类命令返回多行文本；
- 战斗/移动类命令建议一次一条，读完再下一条，否则会丢上下文。

更多设计细节见 `README.md`，改动记录见 `CHANGELOG.md`。
