/**
 * 飞书 CardKit 流式卡片。
 * append(delta) 同步攒文本；首次 append 懒创建卡片；close 时最终更新并失败回落为普通文本回复。
 */
import { debugLog } from "./debug.js";
import { withRetry } from "./retry.js";

type CardKitResponse = { code: number; msg: string; data?: any };

export class StreamingReply {
  private cardId: string | null = null;
  private fullText = "";
  private lastSent = "";
  private interval: NodeJS.Timeout | null = null;
  private startPromise: Promise<void> | null = null;
  private closed = false;
  private streamingFailed = false;
  private token: string | null = null;
  private tokenExpireAt = 0;

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly domain: "feishu" | "lark",
    private readonly replyMessageId: string,
    private readonly fallbackReply: (text: string) => Promise<void>,
  ) {}

  private baseUrl() {
    return this.domain === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn";
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpireAt - 60_000) return this.token;
    const res = await fetch(`${this.baseUrl()}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    });
    const j = (await res.json()) as CardKitResponse & { tenant_access_token?: string; expire?: number };
    if (!j.tenant_access_token) throw new Error(`token failed: ${j.msg || res.status}`);
    this.token = j.tenant_access_token;
    this.tokenExpireAt = Date.now() + (j.expire || 7200) * 1000;
    return this.token;
  }

  private async start(): Promise<void> {
    await withRetry(async () => {
      const token = await this.getToken();
      // 1) 创建卡片实体
      const cr = await fetch(`${this.baseUrl()}/open-apis/cardkit/v1/cards`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "card_json",
          data: JSON.stringify({
            schema: "2.0",
            config: { streaming_mode: true, wide_screen_mode: true },
            body: {
              elements: [{ tag: "markdown", content: this.fullText || "…" }],
            },
          }),
        }),
      });
      const c = (await cr.json()) as CardKitResponse;
      if (c.code !== 0 || !c.data?.card_id) {
        throw Object.assign(new Error(`create_card: ${c.msg || c.code}`), { code: c.code });
      }
      this.cardId = c.data.card_id as string;

      // 2) 用卡片回复原消息
      const sr = await fetch(`${this.baseUrl()}/open-apis/im/v1/messages/${this.replyMessageId}/reply`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          msg_type: "interactive",
          content: JSON.stringify({ type: "card", data: { card_id: this.cardId } }),
        }),
      });
      const s = (await sr.json()) as CardKitResponse;
      if (s.code !== 0) {
        throw Object.assign(new Error(`reply_card: ${s.msg || s.code}`), { code: s.code });
      }
    }, { maxRetries: 2, label: "feishu.streaming.start" });

    this.interval = setInterval(() => {
      void this.flush().catch((e) => {
        debugLog("feishu.streaming.flush_error", { error: e instanceof Error ? e.message : String(e) });
      });
    }, 800);
    this.interval.unref?.();
  }

  hasContent() {
    return this.fullText.trim().length > 0;
  }

  /** 用最终全文覆盖缓冲（subscribe 漏 delta 时的兜底） */
  ensureFinal(text: string): void {
    if (!text) return;
    if (!this.fullText.trim()) this.fullText = text;
    else if (text.length > this.fullText.length) this.fullText = text;
  }

  append(delta: string): void {
    if (this.closed || this.streamingFailed || !delta) return;
    this.fullText += delta;
    if (!this.cardId && !this.startPromise) {
      this.startPromise = this.start()
        .catch((e) => {
          this.streamingFailed = true;
          debugLog("feishu.streaming.start_error", { error: e instanceof Error ? e.message : String(e) });
        })
        .finally(() => {
          this.startPromise = null;
        });
    }
  }

  private async flush(): Promise<void> {
    if (!this.cardId || this.fullText === this.lastSent) return;
    const token = await this.getToken();
    const content = this.fullText || "…";
    const res = await fetch(`${this.baseUrl()}/open-apis/cardkit/v1/cards/${this.cardId}/elements/0/content`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    });
    const j = (await res.json()) as CardKitResponse;
    if (j.code === 0) this.lastSent = this.fullText;
    else debugLog("feishu.streaming.flush_code", { code: j.code, msg: j.msg });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.startPromise) await this.startPromise.catch(() => {});

    // 流式失败：回落为普通回复，保证用户仍能看到完整答案
    if (this.streamingFailed || !this.cardId) {
      if (this.fullText.trim()) {
        debugLog("feishu.streaming.fallback_text", { length: this.fullText.length });
        await this.fallbackReply(this.fullText);
      }
      return;
    }

    try {
      await this.flush();
      const token = await this.getToken();
      await fetch(`${this.baseUrl()}/open-apis/cardkit/v1/cards/${this.cardId}/settings`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          settings: JSON.stringify({ config: { streaming_mode: false } }),
        }),
      });
      debugLog("feishu.streaming.closed", { cardId: this.cardId, length: this.fullText.length });
    } catch (e) {
      debugLog("feishu.streaming.close_error", { error: e instanceof Error ? e.message : String(e) });
      if (this.fullText.trim()) await this.fallbackReply(this.fullText);
    }
  }
}
