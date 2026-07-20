/**
 * 单卡回复运行时：全程保留 header。
 * - running：header「回复中」+ 最终可见正文流式刷新 + [停止]
 * - 不展示工具/阶段过程
 * - 流式刷新：时间间隔 + 最小新增字符 双阈值，减轻整卡重绘闪动
 */
import { randomUUID } from "node:crypto";
import {
  buildReplyCard,
  defaultFinalNote,
  type ReplyCardStatus,
} from "./card-builder.js";
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
  updateFromEvent(event: unknown): void;
  stopImmediately(note?: string): Promise<void>;
  finish(status: Exclude<ReplyCardStatus, "running" | "inactive">, note?: string): Promise<void>;
  append(delta: string): void;
  ensureFinal(text: string): void;
};

export type ReplyCardStreamOptions = {
  /** 是否边生成边刷新（默认 true） */
  enabled?: boolean;
  /** 最小 patch 间隔 ms（默认 1200） */
  flushMs?: number;
  /** 触发 patch 的最少新增字符（默认 24） */
  minChars?: number;
  /** 正文最大字符（默认 12000） */
  maxBodyChars?: number;
};

type ReplyCardTransport = {
  replyCard(messageId: string, card: object): Promise<string | undefined>;
  updateCard(messageId: string, card: object): Promise<void>;
};

const DEFAULT_FLUSH_MS = 400;
const DEFAULT_MIN_CHARS = 1;
const DEFAULT_MAX_BODY = 12000;

function resolveStreamOptions(override?: ReplyCardStreamOptions): Required<ReplyCardStreamOptions> {
  const cfg = loadConfig();
  return {
    enabled: override?.enabled ?? cfg?.streamingReply !== false,
    flushMs: Math.max(200, override?.flushMs ?? cfg?.streamFlushMs ?? DEFAULT_FLUSH_MS),
    minChars: Math.max(1, override?.minChars ?? cfg?.streamMinChars ?? DEFAULT_MIN_CHARS),
    maxBodyChars: Math.max(500, override?.maxBodyChars ?? cfg?.streamMaxBodyChars ?? DEFAULT_MAX_BODY),
  };
}

export class ReplyCard implements ReplyCardSink {
  readonly runId = randomUUID();
  private cardMessageId: string | undefined;
  private status: ReplyCardStatus = "running";
  private body = "";
  private note: string | undefined;
  /** 上次成功 patch 到飞书的正文（用于算新增量、避免无意义重绘） */
  private lastPatchedBody = "";
  private streamTimer: NodeJS.Timeout | undefined;
  private flushInFlight = false;
  private patchQueue: Promise<void> = Promise.resolve();
  private readonly stream: Required<ReplyCardStreamOptions>;
  private readonly key: string;
  private readonly replyToMessageId: string;
  private readonly transport: ReplyCardTransport;

  constructor(
    key: string,
    replyToMessageId: string,
    transport: ReplyCardTransport,
    streamOptions?: ReplyCardStreamOptions,
  ) {
    this.key = key;
    this.replyToMessageId = replyToMessageId;
    this.transport = transport;
    this.stream = resolveStreamOptions(streamOptions);
  }

  get messageId() {
    return this.cardMessageId;
  }

  async start() {
    try {
      this.cardMessageId = await this.transport.replyCard(
        this.replyToMessageId,
        buildReplyCard({
          key: this.key,
          runId: this.runId,
          status: "running",
          body: "",
        }),
      );
      this.lastPatchedBody = "";
      debugLog("feishu.reply_card.started", {
        key: this.key,
        runId: this.runId,
        cardMessageId: this.cardMessageId,
        stream: this.stream,
      });
    } catch (error) {
      debugLog("feishu.reply_card.start_error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 工具/阶段过程不进入卡片 */
  updateFromEvent(_event: unknown) {
    // no-op
  }

  /** 累加最终可见文本；按双阈值节流 patch */
  append(delta: string) {
    if (this.status !== "running" || !delta) return;
    if (!this.stream.enabled) {
      // 关闭流式时只攒字，等 completeWithAnswer
      this.body += delta;
      this.truncateBody();
      return;
    }
    this.body += delta;
    this.truncateBody();
    this.scheduleStreamFlush();
  }

  ensureFinal(text: string) {
    if (!text) return;
    if (!this.body.trim() || text.length >= this.body.length) {
      this.body = text;
    }
    this.truncateBody();
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

  private truncateBody() {
    const max = this.stream.maxBodyChars;
    if (this.body.length > max) {
      this.body = `${this.body.slice(0, max)}\n…(truncated)`;
    }
  }

  private pendingChars() {
    return Math.max(0, this.body.length - this.lastPatchedBody.length);
  }

  private scheduleStreamFlush() {
    if (this.status !== "running" || !this.stream.enabled) return;
    if (this.streamTimer) return;
    this.streamTimer = setTimeout(() => {
      this.streamTimer = undefined;
      void this.flushStream();
    }, this.stream.flushMs);
    this.streamTimer.unref?.();
  }

  private async flushStream() {
    if (this.status !== "running" || this.flushInFlight || !this.stream.enabled) return;

    const pending = this.pendingChars();
    // 既没新内容，或内容与上次 patch 完全一致
    if (pending <= 0 || this.body === this.lastPatchedBody) return;

    // 字数未达阈值：再等一轮（完成时 finishFinal 会强制刷）
    if (pending < this.stream.minChars) {
      this.scheduleStreamFlush();
      return;
    }

    this.flushInFlight = true;
    try {
      await this.patch(
        buildReplyCard({
          key: this.key,
          runId: this.runId,
          status: "running",
          body: this.body,
        }),
      );
      this.lastPatchedBody = this.body;
    } finally {
      this.flushInFlight = false;
    }

    if (this.pendingChars() > 0) this.scheduleStreamFlush();
  }

  private async finishFinal(
    status: Exclude<ReplyCardStatus, "running" | "inactive">,
    note: string | undefined,
  ) {
    if (this.status !== "running") return;
    this.status = status;
    this.clearStreamTimer();
    this.note = note ?? defaultFinalNote(status);
    await this.patch(
      buildReplyCard({
        key: this.key,
        runId: this.runId,
        status,
        note: status === "done" ? undefined : this.note,
        body: this.body,
      }),
      { final: true },
    );
    this.lastPatchedBody = this.body;
  }

  private async patch(card: object, options: { final?: boolean } = {}) {
    if (!this.cardMessageId) return;
    const messageId = this.cardMessageId;
    const next = this.patchQueue
      .catch(() => undefined)
      .then(async () => {
        if (!options.final && this.status !== "running") return;
        try {
          await this.transport.updateCard(messageId, card);
          debugLog("feishu.reply_card.update_done", {
            key: this.key,
            runId: this.runId,
            messageId,
            final: Boolean(options.final),
            status: this.status,
            bodyLen: this.body.length,
          });
        } catch (error) {
          debugLog("feishu.reply_card.update_error", {
            key: this.key,
            runId: this.runId,
            messageId,
            final: Boolean(options.final),
            error: error instanceof Error ? error.message : String(error),
          });
          if (options.final) await this.retryFinalPatch(messageId, card);
        }
      });
    this.patchQueue = next;
    await next;
  }

  private async retryFinalPatch(messageId: string, card: object) {
    await sleep(300);
    try {
      await this.transport.updateCard(messageId, card);
    } catch (error) {
      debugLog("feishu.reply_card.final_retry_error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private clearStreamTimer() {
    if (this.streamTimer) {
      clearTimeout(this.streamTimer);
      this.streamTimer = undefined;
    }
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
