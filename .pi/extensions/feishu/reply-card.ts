/**
 * 单卡回复运行时：全程保留 header，running → done|stopped|failed 只 patch 同一 message_id。
 */
import { randomUUID } from "node:crypto";
import {
  buildReplyCard,
  defaultFinalPhase,
  describePiEvent,
  normalizePhase,
  type ReplyCardStatus,
} from "./card-builder.js";
import { debugLog } from "./debug.js";

export type { ReplyCardStatus } from "./card-builder.js";
export {
  buildReplyCard,
  parseStopTaskActionValue,
  describePiEvent,
  STOP_ACTION,
} from "./card-builder.js";

export type ReplyCardSink = {
  readonly runId: string;
  updateFromEvent(event: unknown): void;
  stopImmediately(phase?: string): Promise<void>;
  finish(status: Exclude<ReplyCardStatus, "running" | "inactive">, phase?: string): Promise<void>;
  append(delta: string): void;
  ensureFinal(text: string): void;
};

type ReplyCardTransport = {
  replyCard(messageId: string, card: object): Promise<string | undefined>;
  updateCard(messageId: string, card: object): Promise<void>;
};

const MAX_BODY_CHARS = 12000;
const STILL_RUNNING_MS = 25_000;
const RUNNING_UPDATE_INTERVAL_MS = 3_000;
const STREAM_FLUSH_MS = 800;

export class ReplyCard implements ReplyCardSink {
  readonly runId = randomUUID();
  private cardMessageId: string | undefined;
  private phase = "开始处理";
  private status: ReplyCardStatus = "running";
  private body = "";
  private heartbeat: NodeJS.Timeout | undefined;
  private streamTimer: NodeJS.Timeout | undefined;
  private lastUpdateAt = 0;
  private lastRunningUpdateAt = 0;
  private pendingRunningTimer: NodeJS.Timeout | undefined;
  private pendingRunningPhase: string | undefined;
  private runningUpdateInFlight = false;
  private streamDirty = false;
  private patchQueue: Promise<void> = Promise.resolve();
  private version = 0;
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
          phase: this.phase,
          body: this.body,
        }),
      );
      debugLog("feishu.reply_card.started", {
        key: this.key,
        runId: this.runId,
        cardMessageId: this.cardMessageId,
      });
      this.lastUpdateAt = Date.now();
      this.lastRunningUpdateAt = this.lastUpdateAt;
      this.startHeartbeat();
    } catch (error) {
      debugLog("feishu.reply_card.start_error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  updateFromEvent(event: unknown) {
    if (this.status !== "running") return;
    const phase = describePiEvent(event);
    if (!phase) return;
    void this.updateRunningPhase(phase);
  }

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
    if (!this.body.trim()) this.body = text;
    else if (text.length > this.body.length) this.body = text;
    if (this.body.length > MAX_BODY_CHARS) {
      this.body = `${this.body.slice(0, MAX_BODY_CHARS)}\n…(truncated)`;
    }
  }

  async stopImmediately(phase = "已停止") {
    await this.finishFinal("stopped", phase, true);
  }

  async finish(status: Exclude<ReplyCardStatus, "running" | "inactive">, phase?: string) {
    await this.finishFinal(status, phase, false);
  }

  async completeWithAnswer(answer: string) {
    this.ensureFinal(answer || "（无内容）");
    await this.finishFinal("done", undefined, false);
  }

  private async finishFinal(
    status: Exclude<ReplyCardStatus, "running" | "inactive">,
    phase: string | undefined,
    force: boolean,
  ) {
    if (this.status !== "running") return;
    this.status = status;
    this.version += 1;
    this.stopHeartbeat();
    this.clearPendingRunningUpdate();
    this.clearStreamTimer();
    const finalPhase = phase ? normalizePhase(phase) : defaultFinalPhase(status);
    if (finalPhase && status !== "done") this.phase = finalPhase;
    await this.patch(
      buildReplyCard({
        key: this.key,
        runId: this.runId,
        status,
        phase: status === "done" ? undefined : this.phase,
        body: this.body,
      }),
      { final: true, force },
    );
  }

  private updateRunningPhase(phase: string) {
    const next = normalizePhase(phase);
    if (!next || next === this.phase || next === this.pendingRunningPhase) return;
    this.pendingRunningPhase = next;
    this.scheduleRunningUpdate();
  }

  private scheduleRunningUpdate() {
    if (this.status !== "running" || this.runningUpdateInFlight || this.pendingRunningTimer) return;
    const now = Date.now();
    const waitMs = Math.max(0, RUNNING_UPDATE_INTERVAL_MS - (now - this.lastRunningUpdateAt));
    if (waitMs > 0) {
      this.pendingRunningTimer = setTimeout(() => {
        this.pendingRunningTimer = undefined;
        void this.flushRunningUpdate();
      }, waitMs);
      this.pendingRunningTimer.unref?.();
      return;
    }
    void this.flushRunningUpdate();
  }

  private async flushRunningUpdate() {
    if (this.status !== "running" || this.runningUpdateInFlight) return;
    const next = this.pendingRunningPhase;
    this.pendingRunningPhase = undefined;
    const bodyChanged = this.streamDirty;
    if ((!next || next === this.phase) && !bodyChanged) return;

    this.runningUpdateInFlight = true;
    const version = this.version;
    if (next && next !== this.phase) this.phase = next;
    this.streamDirty = false;
    this.lastRunningUpdateAt = Date.now();
    try {
      await this.patch(
        buildReplyCard({
          key: this.key,
          runId: this.runId,
          status: "running",
          phase: this.phase,
          body: this.body,
        }),
        { version },
      );
    } finally {
      this.runningUpdateInFlight = false;
    }
    if (this.pendingRunningPhase || this.streamDirty) this.scheduleRunningUpdate();
  }

  private scheduleStreamFlush() {
    if (this.status !== "running") return;
    if (this.streamTimer) return;
    this.streamTimer = setTimeout(() => {
      this.streamTimer = undefined;
      void this.flushRunningUpdate();
    }, STREAM_FLUSH_MS);
    this.streamTimer.unref?.();
  }

  private async patch(card: object, options: { final?: boolean; force?: boolean; version?: number } = {}) {
    if (!this.cardMessageId) return;
    const messageId = this.cardMessageId;
    const next = this.patchQueue
      .catch(() => undefined)
      .then(async () => {
        if (!options.final && !options.force) {
          if (this.status !== "running") return;
          if (options.version !== undefined && options.version !== this.version) return;
        }
        try {
          await this.transport.updateCard(messageId, card);
          this.lastUpdateAt = Date.now();
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
    await sleep(RUNNING_UPDATE_INTERVAL_MS);
    try {
      await this.transport.updateCard(messageId, card);
      this.lastUpdateAt = Date.now();
    } catch (error) {
      debugLog("feishu.reply_card.final_retry_error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.status !== "running") return;
      if (Date.now() - this.lastUpdateAt < STILL_RUNNING_MS) return;
      void this.updateRunningPhase("仍在处理");
    }, STILL_RUNNING_MS);
    this.heartbeat.unref?.();
  }

  private stopHeartbeat() {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  private clearPendingRunningUpdate() {
    if (this.pendingRunningTimer) {
      clearTimeout(this.pendingRunningTimer);
      this.pendingRunningTimer = undefined;
    }
    this.pendingRunningPhase = undefined;
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
