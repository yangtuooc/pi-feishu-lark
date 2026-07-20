# @xjuai/pi-feishu-lark

<p align="center">
  <a href="./README.md">English</a> | <b>简体中文</b>
</p>

飞书 / Lark ↔ [Pi](https://github.com/earendil-works/pi) coding agent 桥接扩展。

基于 [AX1202/pi-feishu-lark](https://github.com/AX1202/pi-feishu-lark) 的重构式 fork（MIT），面向 Docker 守护与生产告警场景增强。

## 相对上游的改动

- **入站 interactive 卡片解析**：告警机器人卡片可转为可读文本进入 agent
- **引用/回复父消息展开**：用户回复卡片并 @bot 时，自动拉取 parent/root 正文
- **可配置超时**：默认 prompt / 队列等待 1h（可用环境变量调整）
- **出站重试**：飞书 API 可重试错误指数退避
- **流式回复**：CardKit 流式卡片，失败回落普通文本
- **保留上游能力**：`/workspace`、resume 卡片、gateway lock、daemon、model 切换
- **命令**：新增 `/status`、`/commands`

## 安装

```bash
# 本地 path（Docker / monorepo）
pi install /path/to/packages/pi-feishu-lark -a

# 或 npm（若已发布）
pi install npm:@xjuai/pi-feishu-lark -a
```

## 使用

```text
/feishu setup
/feishu start
```

**飞书侧命令：** `/new` `/resume` `/model` `/workspace` `/status` `/stop` `/commands`

**Pi 侧管理：** `/feishu setup` `/feishu start` `/feishu stop` `/feishu restart` `/feishu status` `/feishu autostart` `/feishu debug` `/feishu reset`

## 配置

`~/.pi/agent/feishu/config.json` 或环境变量：

| 变量 | 默认 | 说明 |
|------|------|------|
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | — | 应用凭证 |
| `FEISHU_DOMAIN` | `feishu` | `feishu` / `lark` |
| `FEISHU_GROUP_POLICY` | `open` | `open`（群内均可）/ `mention`（需 @ 机器人） |
| `FEISHU_PARSE_INTERACTIVE_CARDS` | `true` | 解析入站 interactive 卡片 |
| `FEISHU_INCLUDE_QUOTED_MESSAGE` | `true` | 展开引用/回复的父消息 |
| `FEISHU_QUOTED_MESSAGE_MAX_CHARS` | `8000` | 引用正文最大字符数 |
| `FEISHU_PROMPT_TIMEOUT_MS` | `3600000` | 单轮 prompt 超时（毫秒） |
| `FEISHU_QUEUE_WAIT_TIMEOUT_MS` | `3600000` | 等待上一轮队列超时 |
| `FEISHU_SEND_MAX_RETRIES` | `2` | 出站 API 重试次数（不含首次） |
| `FEISHU_STREAMING_REPLY` | `true` | 启用 CardKit 流式回复 |
| `FEISHU_AUTO_START` | `true` | Pi 启动时自动连接 |
| `FEISHU_LANGUAGE` | `zh` | `zh` / `en` |

## 落盘路径

| 路径 | 内容 |
|------|------|
| `~/.pi/agent/feishu/config.json` | 凭证与配置 |
| `~/.pi/agent/feishu/state.json` | 飞书 ↔ Pi 会话映射 |
| `~/.pi/agent/feishu/bridge.json` | 定时任务等路由 |
| `~/.pi/agent/feishu/debug.log` | 调试日志 |
| `~/.pi/agent/sessions/` | 各飞书会话对应的 Pi session |

## 开发

```bash
npm install
npm run check
npm test
```

## 常见问题

**机器人不回复？**

- 确认飞书应用与权限已配置
- 确认已执行 `/feishu start`
- 群聊 `mention` 策略下需要 @ 机器人；`open` 还需开通「获取群组中所有消息」

**告警卡片 agent 看不到内容？**

- 确认 `FEISHU_PARSE_INTERACTIVE_CARDS=true`
- 用户回复卡片时确认 `FEISHU_INCLUDE_QUOTED_MESSAGE=true`，并具备消息读取权限

## License

MIT（上游 [AX1202/pi-feishu-lark](https://github.com/AX1202/pi-feishu-lark)）
