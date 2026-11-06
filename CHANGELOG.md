# Changelog

## 0.3.0 — 2026-11-06

右侧栏面板 + 人工 fullme 接管，以及一轮针对“会话会不会被锁死 / 进程会不会被打死”的加固。

### Added
- 右侧栏 **MUD** 页：日志 / AI 操作 / 下一步 / 日记四个只读视图，会话头部 `🐱 MUD` 按钮打开。
- `journal`：有界事件环（默认 500 条，带 `seq` 游标），区分服务器输出、模型命令、系统事件。
- `notes`：计划与日记文件的有界尾部读取（按 mtime 缓存，最多 6000 字）。
- 人工 fullme 流程：面板一键取图 → 人读两个汉字 → 提交；期间 `lockSession` 暂停模型操作。
- 六个 HTTP 端点（`status` / `journal` / `notes` / `fullme/start|submit|cancel`），全部走 `connection` 鉴权围栏。
- `panelRoutePrefix` / `planPath` / `diaryPath` 配置项；路径支持 `~` 展开。

### Fixed
- **锁比 socket 活得久**：连接断开、`close`、取图失败都会释放人工接管，不再需要重载 profile 才能让模型继续。
- **交还会话即被踢**：`unlock()` 重置闲置计时，人看验证码的那几十秒不再累积成“闲置 3 分钟”。
- **托管日志能杀死宿主进程**：写入流补 `'error'` 监听，EISDIR/ENOSPC/EACCES 只关闭日志，不抛到进程。
- **`read` 会偷走进行中 `send` 的输出**：两者走同一条串行队列。
- **`idleTimeoutMs: 0` 语义**：看门狗真正关闭，`status` 报 `watchdog: false` / `idleLogoutInMs: null`，面板显示“看门狗关闭”。
- **连接竞态**：并发 `connect()` 共享同一个 in-flight promise；超时会 `destroy()` 掉半开的 socket。
- **闲置下线宽限期内重连**：只销毁当初决定退出的那条 socket，新连接不会被误杀。
- **fullme 重复点**：`start()` 单飞；取图 10 秒超时；`submit` 只在真的送达后才清掉 challenge。
- **无效提交**：没有进行中的验证码时 `fullme/submit` 返回 409，而不是假装成功。
- **`cancel()` 残留**：同时清掉 `needsHuman`，面板不再一直挂着“fullme 待处理”。
- **notes 代理对截断**：尾部切片不再以半个 emoji 开头。
- **鉴权围栏失败即放行**：`connection` 服务缺失时按 403 拒绝，而不是当作已授权。

### Tests
- 83 个用例，全离线（假 socket / 假 fetch）；无 DSH 运行时的裸克隆里 9 个接线用例自动跳过。

## 0.2.0 — 2026-11-06

首个可用版本：`mud` 工具（`login` / `send` / `read` / `status` / `close`），常驻 telnet 会话，
有状态 IAC 协商、流式 UTF-8、登录提示按位置匹配、按日转录、闲置 3 分钟自动 `save` + `quit`。
