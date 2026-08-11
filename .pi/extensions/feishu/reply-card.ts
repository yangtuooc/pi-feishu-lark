/**
 * 回复呈现：
 * - 默认 CardKit streaming_mode：客户端逐字打印（print_step=1）
 * - 关闭流式时：先「回复中」卡，结束一次写入全文
 * - 过程展示（参考 Hermes streaming-card）：运行中显示「思考与工具」timeline，
 *   完成后收起过程区块，保留最终答案 + 统计页脚（时长/模型/工具次数/tokens）
 */
import { randomUUID } from "node:crypto";
import {
  buildReplyCard,
  defaultFinalNote,
  type ReplyCardStatus,
} from "./card-builder.js";
import { CardKitStream } from "./cardkit-stream.js";
import { loadConfig } from "./config.js";
import { debugLog } from "./debug.js";

export type { ReplyCardStatus } from "./card-builder.js";
export {
  buildReplyCard,
  parseStopTaskActionValue,
  STOP_ACTION,
} from "./card-builder.js";

export type ReplyCardSink = {
  readonly runId: string;
  readonly bodyText: string;
  updateFromEvent(event: unknown): void;
  stopImmediately(note?: string): Promise<void>;
  finish(status: Exclude<ReplyCardStatus, "running" | "inactive">, note?: string): Promise<void>;
  append(delta: string): void;
  ensureFinal(text: string): void;
};

export type ReplyCardStreamOptions = {
  enabled?: boolean;
  /** CardKit 客户端打印间隔 ms（默认 50） */
  printFrequencyMs?: number;
  /** CardKit 每次打印字符数（默认 1） */
  printStep?: number;
  /** 服务端推送 fullText 到 CardKit 的间隔 ms（默认 120） */
  pushIntervalMs?: number;
};

type ReplyCardTransport = {
  replyCard(messageId: string, card: object): Promise<string | undefined>;
  updateCard(messageId: string, card: object): Promise<void>;
  replyPlainText?(messageId: string, text: string): Promise<string | undefined>;
  updateText?(messageId: string, text: string): Promise<void>;
  /** 记录本 bot 出站消息，供 groupAlsoOnReply */
  rememberOutboundMessageId?(messageId: string): void;
};

function resolveStreamOptions(override?: ReplyCardStreamOptions) {
  const cfg = loadConfig();
  return {
    enabled: override?.enabled ?? cfg?.streamingReply !== false,
    printFrequencyMs: Math.max(
      20,
      override?.printFrequencyMs
        ?? parseEnvInt("FEISHU_STREAM_PRINT_FREQUENCY_MS")
        ?? cfg?.streamPrintFrequencyMs
        ?? 50,
    ),
    printStep: Math.max(
      1,
      override?.printStep
        ?? parseEnvInt("FEISHU_STREAM_PRINT_STEP")
        ?? cfg?.streamPrintStep
        ?? 1,
    ),
    pushIntervalMs: Math.max(
      50,
      override?.pushIntervalMs
        ?? parseEnvInt("FEISHU_STREAM_PUSH_INTERVAL_MS")
        ?? cfg?.streamPushIntervalMs
        ?? 120,
    ),
  };
}

function parseEnvInt(name: string): number | undefined {
  const v = process.env[name]?.trim();
  if (!v) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

export type ReplyCardInfo = {
  /** 展示在完成页脚的模型名（如 deepseek-v4-flash） */
  model?: string;
};

type ToolEntry = {
  id: string;
  name: string;
  status: "running" | "done" | "failed";
  startedAt: number;
  endedAt?: number;
};

type UsageTokens = { input?: number; output?: number };

const THINKING_MAX_CHARS = 64; // 约 2 行：固定过程区块高度，避免卡片跳动闪烁
const TOOLS_MAX_SHOWN = 3;
const PROCESS_FLUSH_MS = 120;

function formatTokenCount(n?: number): string | undefined {
  if (n == null || !Number.isFinite(n)) return undefined;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

export class ReplyCard implements ReplyCardSink {
  readonly runId = randomUUID();
  private status: ReplyCardStatus = "running";
  private body = "";
  private note: string | undefined;
  private cardkit: CardKitStream | undefined;
  private fallbackCardId: string | undefined;
  private readonly streamOpts: ReturnType<typeof resolveStreamOptions>;
  private readonly key: string;
  private readonly replyToMessageId: string;
  private readonly transport: ReplyCardTransport;
  private readonly cardShowProcess: boolean;
  private readonly modelName?: string;
  /** 过程展示状态 */
  private tools: ToolEntry[] = [];
  private thinking = "";
  private thinkingVisible = false;
  private startedAt = Date.now();
  private finishedAt: number | undefined;
  private usage: UsageTokens = {};
  private pendingProcess = "";
  private processFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastProcessFlushAt = 0;

  constructor(
    key: string,
    replyToMessageId: string,
    transport: ReplyCardTransport,
    streamOptions?: ReplyCardStreamOptions,
    info?: ReplyCardInfo,
  ) {
    this.key = key;
    this.replyToMessageId = replyToMessageId;
    this.transport = transport;
    this.streamOpts = resolveStreamOptions(streamOptions);
    const cfg = loadConfig();
    this.cardShowProcess = cfg?.cardShowProcess !== false;
    this.modelName = info?.model;
  }

  get messageId() {
    return this.fallbackCardId;
  }

  get bodyText() {
    return this.body;
  }

  async start() {
    const cfg = loadConfig();
    if (this.streamOpts.enabled && cfg?.appId && cfg?.appSecret) {
      this.cardkit = new CardKitStream(
        cfg.appId,
        cfg.appSecret,
        cfg.domain === "lark" ? "lark" : "feishu",
        this.replyToMessageId,
        async (text) => {
          // CardKit 失败：回落为普通最终卡片
          const id = await this.transport.replyCard(
            this.replyToMessageId,
            buildReplyCard({
              key: this.key,
              runId: this.runId,
              status: "done",
              body: text,
            }),
          );
          this.fallbackCardId = id;
        },
        {
          printFrequencyMs: this.streamOpts.printFrequencyMs,
          printStep: this.streamOpts.printStep,
          pushIntervalMs: this.streamOpts.pushIntervalMs,
          conversationKey: this.key,
          runId: this.runId,
          onOutboundMessageId: (id) => this.transport.rememberOutboundMessageId?.(id),
        },
      );
      debugLog("feishu.reply_card.cardkit_ready", {
        key: this.key,
        runId: this.runId,
        ...this.streamOpts,
      });
      return;
    }

    // 非流式：先出「回复中」占位卡
    this.fallbackCardId = await this.transport.replyCard(
      this.replyToMessageId,
      buildReplyCard({
        key: this.key,
        runId: this.runId,
        status: "running",
        body: "",
      }),
    );
    debugLog("feishu.reply_card.started_static", {
      key: this.key,
      runId: this.runId,
      cardMessageId: this.fallbackCardId,
    });
  }

  /**
   * 把 Pi 会话事件映射为卡片内的「思考与工具」过程展示：
   * - tool_execution_start/end：工具 timeline + 运行状态
   * - message_update(thinking_* / text_start / done)：思考摘要、状态切换、usage
   * 过程刷新做了去抖，避免 thinking_delta 高频 PUT。
   */
  updateFromEvent(event: unknown): void {
    if (this.status !== "running") return;
    const ev = event as any;
    if (!ev || typeof ev !== "object") return;

    switch (ev.type) {
      case "tool_execution_start": {
        if (!this.cardShowProcess) break;
        // 提前建卡：工具阶段即可看到 🔧 timeline
        void this.cardkit?.ensureStarted();
        const id = typeof ev.toolCallId === "string" ? ev.toolCallId : `${ev.toolName}-${Date.now()}`;
        this.tools.push({
          id,
          name: typeof ev.toolName === "string" ? ev.toolName : "tool",
          status: "running",
          startedAt: Date.now(),
        });
        // 保留思考行（冻结），只新增工具行：过程区块高度只增不减，避免跳动
        this.refreshProcess();
        break;
      }
      case "tool_execution_end": {
        if (!this.cardShowProcess) break;
        const t = this.tools.find((x) => x.id === ev.toolCallId);
        if (t) {
          t.status = ev.isError || ev.result?.isError ? "failed" : "done";
          t.endedAt = Date.now();
        }
        this.refreshProcess();
        break;
      }
      case "message_update": {
        const ame = ev.assistantMessageEvent;
        if (!ame || typeof ame !== "object") break;
        if (ame.type === "thinking_start") {
          if (this.cardShowProcess) {
            this.thinking = "";
            this.thinkingVisible = true;
            // 提前建卡：让过程区块在思考阶段就展示（正文未开始，无闪烁风险）
            void this.cardkit?.ensureStarted();
            this.refreshProcess();
          }
        } else if (ame.type === "thinking_delta" && typeof ame.delta === "string") {
          if (this.cardShowProcess) {
            this.thinking = (this.thinking + ame.delta).slice(-THINKING_MAX_CHARS * 3);
            this.refreshProcess(true);
          }
        } else if (ame.type === "thinking_end") {
          if (this.cardShowProcess) this.refreshProcess();
        } else if (ame.type === "text_start") {
          // 开始输出正文：过程区块冻结（不隐藏思考行，保持高度稳定），正文流式后不再 PUT
          void this.cardkit?.ensureStarted();
        } else if (ame.type === "done") {
          this.captureUsage(ame);
        }
        break;
      }
      case "message_end": {
        const usage = ev.message?.usage;
        if (usage && typeof usage === "object") {
          this.usage = {
            input: usage.input_tokens ?? usage.input ?? this.usage.input,
            output: usage.output_tokens ?? usage.output ?? this.usage.output,
          };
        }
        break;
      }
      default:
        break;
    }
  }

  private captureUsage(ame: any) {
    const usage = ame.usage ?? ame.partial?.usage;
    if (!usage || typeof usage !== "object") return;
    const input = usage.input_tokens ?? usage.input;
    const output = usage.output_tokens ?? usage.output;
    if (input != null || output != null) {
      this.usage = { input, output };
    }
  }

  /** 过程区块 markdown：思考摘要 + 工具 timeline（固定行数，高度稳定） */
  private buildProcessMarkdown(): string {
    const lines: string[] = [];
    if (this.thinkingVisible) {
      const t = this.thinking.trim().replace(/\s+/g, " ");
      if (t) {
        lines.push(`🧠 ${t.length > THINKING_MAX_CHARS ? `${t.slice(0, THINKING_MAX_CHARS)}…` : t}`);
      } else {
        lines.push("🧠 思考中…");
      }
    }
    const shown = this.tools.slice(0, TOOLS_MAX_SHOWN);
    for (const tool of shown) {
      const icon = tool.status === "running" ? "🔧" : tool.status === "failed" ? "❌" : "✅";
      const suffix =
        tool.status === "running" ? " 运行中…" : tool.endedAt ? ` (${((tool.endedAt - tool.startedAt) / 1000).toFixed(1)}s)` : "";
      lines.push(`${icon} ${tool.name}${suffix}`);
    }
    const overflow = this.tools.length - TOOLS_MAX_SHOWN;
    if (overflow > 0) lines.push(`⋯ 还有 ${overflow} 个工具`);
    return lines.join("\n");
  }

  /** 去抖刷新过程区块（thinking_delta 高频调用走 throttle） */
  private refreshProcess(throttle = false) {
    if (!this.cardkit || !this.cardShowProcess) return;
    const md = this.buildProcessMarkdown();
    if (md === this.pendingProcess && !throttle) return;
    this.pendingProcess = md;
    if (throttle) {
      const now = Date.now();
      if (this.processFlushTimer) return; // 已有排程
      const wait = Math.max(0, PROCESS_FLUSH_MS - (now - this.lastProcessFlushAt));
      this.processFlushTimer = setTimeout(() => {
        this.processFlushTimer = null;
        this.lastProcessFlushAt = Date.now();
        this.cardkit?.updateProcess(this.pendingProcess);
      }, wait);
    } else {
      if (this.processFlushTimer) {
        clearTimeout(this.processFlushTimer);
        this.processFlushTimer = null;
      }
      this.lastProcessFlushAt = Date.now();
      this.cardkit.updateProcess(md);
    }
  }

  /** 完成页脚统计：⏱ 时长 · 🤖 模型 · 🔧 工具次数 · ⬆️/⬇️ tokens */
  private buildFooterMarkdown(): string {
    const parts: string[] = [];
    const dur = ((this.finishedAt ?? Date.now()) - this.startedAt) / 1000;
    parts.push(`⏱ ${dur.toFixed(1)}s`);
    if (this.modelName) parts.push(`🤖 ${this.modelName}`);
    if (this.tools.length) parts.push(`🔧 ${this.tools.length} 次工具`);
    const input = formatTokenCount(this.usage.input);
    const output = formatTokenCount(this.usage.output);
    if (input !== undefined || output !== undefined) {
      parts.push(`⬆️ ${input ?? "?"} / ⬇️ ${output ?? "?"} tokens`);
    }
    return parts.join(" · ");
  }

  append(delta: string) {
    if (this.status !== "running" || !delta) return;
    this.body += delta;
    this.cardkit?.append(delta);
  }

  ensureFinal(text: string) {
    if (!text) return;
    if (!this.body.trim() || text.length >= this.body.length) this.body = text;
    this.cardkit?.ensureFinal(text);
  }

  async stopImmediately(note = "已停止") {
    await this.finishFinal("stopped", note);
  }

  async finish(status: Exclude<ReplyCardStatus, "running" | "inactive">, note?: string) {
    await this.finishFinal(status, note);
  }

  async completeWithAnswer(answer: string) {
    this.ensureFinal(answer || "（无内容）");
    await this.finishFinal("done", undefined);
  }

  private async finishFinal(
    status: Exclude<ReplyCardStatus, "running" | "inactive">,
    note: string | undefined,
  ) {
    if (this.status !== "running") return;
    this.status = status;
    this.note = note ?? defaultFinalNote(status);
    this.finishedAt = Date.now();
    const footer = status === "done" ? this.buildFooterMarkdown() : undefined;

    if (this.cardkit) {
      // 同一张 CardKit 卡上关闭流式并更新 header（回复/已停止/出错了）
      await this.cardkit.close(this.body, status === "failed" ? "failed" : status === "stopped" ? "stopped" : "done", footer);
      return;
    }

    // 静态卡路径
    if (this.fallbackCardId) {
      try {
        await this.transport.updateCard(
          this.fallbackCardId,
          buildReplyCard({
            key: this.key,
            runId: this.runId,
            status,
            note: status === "done" ? undefined : this.note,
            body: this.body,
            footerMarkdown: footer,
          }),
        );
      } catch (error) {
        debugLog("feishu.reply_card.static_final_error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
