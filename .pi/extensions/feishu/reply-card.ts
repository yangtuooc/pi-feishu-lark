/**
 * 单卡回复运行时：全程保留 header。
 * - running：最终可见正文流式刷新 + [停止]（不展示工具/阶段）
 * - 流式：首字尽快上屏；稳态小间隔刷新；in-flight 合并（只发最新 body，避免 API 排队卡顿）
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
  enabled?: boolean;
  /** 稳态 patch 间隔 ms（默认 350） */
  flushMs?: number;
  /** 首次出字延迟 ms（默认 50） */
  firstFlushMs?: number;
  /** 稳态最少新增字符（默认 8） */
  minChars?: number;
  maxBodyChars?: number;
};

type ReplyCardTransport = {
  replyCard(messageId: string, card: object): Promise<string | undefined>;
  updateCard(messageId: string, card: object): Promise<void>;
};

const DEFAULT_FLUSH_MS = 350;
const DEFAULT_FIRST_FLUSH_MS = 50;
const DEFAULT_MIN_CHARS = 8;
const DEFAULT_MAX_BODY = 12000;

function resolveStreamOptions(override?: ReplyCardStreamOptions): Required<ReplyCardStreamOptions> {
  const cfg = loadConfig();
  return {
    enabled: override?.enabled ?? cfg?.streamingReply !== false,
    flushMs: Math.max(100, override?.flushMs ?? cfg?.streamFlushMs ?? DEFAULT_FLUSH_MS),
    firstFlushMs: Math.max(0, override?.firstFlushMs ?? cfg?.streamFirstFlushMs ?? DEFAULT_FIRST_FLUSH_MS),
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
  private lastPatchedBody = "";
  private streamTimer: NodeJS.Timeout | undefined;
  private hasPainted = false;
  private flushInFlight = false;
  private flushQueued = false;
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
      this.hasPainted = false;
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

  updateFromEvent(_event: unknown) {
    // 不展示工具/阶段
  }

  append(delta: string) {
    if (this.status !== "running" || !delta) return;
    this.body += delta;
    this.truncateBody();
    if (!this.stream.enabled) return;
    this.scheduleStreamFlush();
  }

  ensureFinal(text: string) {
    if (!text) return;
    if (!this.body.trim() || text.length >= this.body.length) this.body = text;
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
    const delay = this.hasPainted ? this.stream.flushMs : this.stream.firstFlushMs;
    this.streamTimer = setTimeout(() => {
      this.streamTimer = undefined;
      void this.requestFlush();
    }, delay);
    this.streamTimer.unref?.();
  }

  /**
   * 合并 patch：最多 1 个 in-flight；
   * 飞行中继续 append 只记 dirty，落地后用最新 body 再发一次。
   * 避免 updateCard 串行排队导致越来越卡、一次蹦一大块。
   */
  private async requestFlush() {
    if (this.status !== "running" || !this.stream.enabled) return;
    if (this.body === this.lastPatchedBody) return;

    // 稳态：字数未达阈值则继续等（首屏不受限）
    if (this.hasPainted && this.pendingChars() < this.stream.minChars) {
      this.scheduleStreamFlush();
      return;
    }

    if (this.flushInFlight) {
      this.flushQueued = true;
      return;
    }

    this.flushInFlight = true;
    this.flushQueued = false;
    const snapshot = this.body;
    try {
      if (this.cardMessageId) {
        await this.transport.updateCard(
          this.cardMessageId,
          buildReplyCard({
            key: this.key,
            runId: this.runId,
            status: "running",
            body: snapshot,
          }),
        );
        this.lastPatchedBody = snapshot;
        this.hasPainted = true;
        debugLog("feishu.reply_card.stream_flush", {
          key: this.key,
          runId: this.runId,
          bodyLen: snapshot.length,
        });
      }
    } catch (error) {
      debugLog("feishu.reply_card.update_error", {
        key: this.key,
        runId: this.runId,
        final: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.flushInFlight = false;
    }

    if (this.status === "running" && this.body !== this.lastPatchedBody) {
      // 有积压：尽快再刷（合并为最新）
      if (this.flushQueued || this.pendingChars() >= this.stream.minChars) {
        // 短延迟让出事件循环，避免 tight loop
        this.streamTimer = setTimeout(() => {
          this.streamTimer = undefined;
          void this.requestFlush();
        }, 30);
        this.streamTimer.unref?.();
      } else {
        this.scheduleStreamFlush();
      }
    }
  }

  private async finishFinal(
    status: Exclude<ReplyCardStatus, "running" | "inactive">,
    note: string | undefined,
  ) {
    if (this.status !== "running") return;
    this.status = status;
    this.clearStreamTimer();
    // 等飞行中的 stream patch 结束，避免乱序覆盖最终态
    const deadline = Date.now() + 3000;
    while (this.flushInFlight && Date.now() < deadline) {
      await sleep(20);
    }
    this.note = note ?? defaultFinalNote(status);
    if (!this.cardMessageId) return;
    const card = buildReplyCard({
      key: this.key,
      runId: this.runId,
      status,
      note: status === "done" ? undefined : this.note,
      body: this.body,
    });
    try {
      await this.transport.updateCard(this.cardMessageId, card);
      debugLog("feishu.reply_card.update_done", {
        key: this.key,
        runId: this.runId,
        messageId: this.cardMessageId,
        final: true,
        status: this.status,
        bodyLen: this.body.length,
      });
    } catch (error) {
      debugLog("feishu.reply_card.update_error", {
        key: this.key,
        runId: this.runId,
        final: true,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(300);
      try {
        await this.transport.updateCard(this.cardMessageId, card);
      } catch (err2) {
        debugLog("feishu.reply_card.final_retry_error", {
          error: err2 instanceof Error ? err2.message : String(err2),
        });
      }
    }
    this.lastPatchedBody = this.body;
    this.hasPainted = true;
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
