/**
 * 单卡回复运行时：全程保留 header。
 * - running：header「回复中」+ 最终回复流式正文 + [停止]
 * - 不展示进度/工具过程；只流式用户可见最终文本
 * - done：header「回复」+ 最终全文
 */
import { randomUUID } from "node:crypto";
import {
  buildReplyCard,
  defaultFinalNote,
  type ReplyCardStatus,
} from "./card-builder.js";
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

type ReplyCardTransport = {
  replyCard(messageId: string, card: object): Promise<string | undefined>;
  updateCard(messageId: string, card: object): Promise<void>;
};

const MAX_BODY_CHARS = 12000;
const STREAM_FLUSH_MS = 500;

export class ReplyCard implements ReplyCardSink {
  readonly runId = randomUUID();
  private cardMessageId: string | undefined;
  private status: ReplyCardStatus = "running";
  private body = "";
  private note: string | undefined;
  private streamDirty = false;
  private streamTimer: NodeJS.Timeout | undefined;
  private flushInFlight = false;
  private patchQueue: Promise<void> = Promise.resolve();
  private readonly key: string;
  private readonly replyToMessageId: string;
  private readonly transport: ReplyCardTransport;

  constructor(key: string, replyToMessageId: string, transport: ReplyCardTransport) {
    this.key = key;
    this.replyToMessageId = replyToMessageId;
    this.transport = transport;
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
      debugLog("feishu.reply_card.started", {
        key: this.key,
        runId: this.runId,
        cardMessageId: this.cardMessageId,
      });
    } catch (error) {
      debugLog("feishu.reply_card.start_error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 不展示工具/阶段过程 */
  updateFromEvent(_event: unknown) {
    // no-op: 过程不进入卡片
  }

  /** 流式写入最终用户可见文本（仅 assistant text delta） */
  append(delta: string) {
    if (this.status !== "running" || !delta) return;
    this.body += delta;
    if (this.body.length > MAX_BODY_CHARS) {
      this.body = `${this.body.slice(0, MAX_BODY_CHARS)}\n…(truncated)`;
    }
    this.streamDirty = true;
    this.scheduleStreamFlush();
  }

  ensureFinal(text: string) {
    if (!text) return;
    if (!this.body.trim() || text.length >= this.body.length) {
      this.body = text;
    }
    if (this.body.length > MAX_BODY_CHARS) {
      this.body = `${this.body.slice(0, MAX_BODY_CHARS)}\n…(truncated)`;
    }
  }

  async stopImmediately(note = "已停止") {
    await this.finishFinal("stopped", note, true);
  }

  async finish(status: Exclude<ReplyCardStatus, "running" | "inactive">, note?: string) {
    await this.finishFinal(status, note, false);
  }

  async completeWithAnswer(answer: string) {
    this.ensureFinal(answer || "（无内容）");
    await this.finishFinal("done", undefined, false);
  }

  private scheduleStreamFlush() {
    if (this.status !== "running") return;
    if (this.streamTimer) return;
    this.streamTimer = setTimeout(() => {
      this.streamTimer = undefined;
      void this.flushStream();
    }, STREAM_FLUSH_MS);
    this.streamTimer.unref?.();
  }

  private async flushStream() {
    if (this.status !== "running" || this.flushInFlight || !this.streamDirty) return;
    this.flushInFlight = true;
    this.streamDirty = false;
    try {
      await this.patch(
        buildReplyCard({
          key: this.key,
          runId: this.runId,
          status: "running",
          body: this.body,
        }),
      );
    } finally {
      this.flushInFlight = false;
    }
    if (this.streamDirty) this.scheduleStreamFlush();
  }

  private async finishFinal(
    status: Exclude<ReplyCardStatus, "running" | "inactive">,
    note: string | undefined,
    force: boolean,
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
      { final: true, force },
    );
  }

  private async patch(card: object, options: { final?: boolean; force?: boolean } = {}) {
    if (!this.cardMessageId) return;
    const messageId = this.cardMessageId;
    const next = this.patchQueue
      .catch(() => undefined)
      .then(async () => {
        if (!options.final && !options.force && this.status !== "running") return;
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
