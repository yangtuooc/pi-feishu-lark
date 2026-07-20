/**
 * 单卡回复运行时：全程保留 header。
 * - running：不展示进度/模型过程，仅「回复中」+ 停止
 * - done：只写入最终用户可见回复
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
  /** 忽略过程事件（不再展示阶段） */
  updateFromEvent(event: unknown): void;
  stopImmediately(note?: string): Promise<void>;
  finish(status: Exclude<ReplyCardStatus, "running" | "inactive">, note?: string): Promise<void>;
  /** 忽略流式过程；最终正文走 ensureFinal / completeWithAnswer */
  append(delta: string): void;
  ensureFinal(text: string): void;
};

type ReplyCardTransport = {
  replyCard(messageId: string, card: object): Promise<string | undefined>;
  updateCard(messageId: string, card: object): Promise<void>;
};

const MAX_BODY_CHARS = 12000;

export class ReplyCard implements ReplyCardSink {
  readonly runId = randomUUID();
  private cardMessageId: string | undefined;
  private status: ReplyCardStatus = "running";
  private body = "";
  private note: string | undefined;
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

  /** 过程事件不展示，避免卡片被工具/阶段刷屏 */
  updateFromEvent(_event: unknown) {
    // intentionally no-op
  }

  /** 流式过程不写入卡片；只保留最终回复 */
  append(_delta: string) {
    // intentionally no-op
  }

  ensureFinal(text: string) {
    if (!text) return;
    this.body = text;
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

  /** 正常结束：只展示最终用户回复 */
  async completeWithAnswer(answer: string) {
    this.ensureFinal(answer || "（无内容）");
    await this.finishFinal("done", undefined, false);
  }

  private async finishFinal(
    status: Exclude<ReplyCardStatus, "running" | "inactive">,
    note: string | undefined,
    force: boolean,
  ) {
    if (this.status !== "running") return;
    this.status = status;
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
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
