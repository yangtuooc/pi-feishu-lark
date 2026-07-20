export type Domain = "feishu" | "lark";
export type GroupPolicy = "open" | "mention";
export type CardActionMode = "webhook" | "ws";

export type FeishuConfig = {
  appId: string;
  appSecret: string;
  domain: Domain;
  groupPolicy: GroupPolicy;
  cardActionMode?: CardActionMode;
  cardActionWebhookHost?: string;
  cardActionWebhookPort?: number;
  cardActionWebhookPath?: string;
  language?: "zh" | "en";
  reactEmoji?: string;
  autoStart?: boolean;
  /** 解析入站 interactive 卡片（默认 true） */
  parseInteractiveCards?: boolean;
  /** 用户回复/引用消息时展开 parent/root 正文（默认 true） */
  includeQuotedMessage?: boolean;
  /** 引用消息并入 prompt 的最大字符数 */
  quotedMessageMaxChars?: number;
  /** 单轮 prompt 超时（毫秒） */
  promptTimeoutMs?: number;
  /** 等待上一轮队列超时（毫秒） */
  queueWaitTimeoutMs?: number;
  /** 出站 API 最大重试次数（不含首次） */
  sendMaxRetries?: number;
  /**
   * 是否在同一张回复卡上边生成边刷新最终可见正文（默认 true）。
   * false：整轮结束后一次性写入全文。
   */
  streamingReply?: boolean;
  /**
   * 流式 patch 最小间隔（毫秒，默认 1200）。
   * 过小易块状闪动；过大则更新偏钝。
   */
  streamFlushMs?: number;
  /**
   * 触发一次流式 patch 所需最少新增字符数（默认 24）。
   * 与 streamFlushMs 一起做「时间 + 字符」双阈值，减轻整卡重绘闪动。
   */
  streamMinChars?: number;
  /** 流式/最终正文最大字符数（默认 12000） */
  streamMaxBodyChars?: number;
};

export type ModelSelection = {
  provider: string;
  id: string;
};

export type FeishuState = {
  sessions: Record<string, string>;
  models?: Record<string, ModelSelection>;
  workspaces?: Record<string, string>;
};

export type FeishuRoute = {
  sessionKey: string;
  sessionId?: string;
  chatId: string;
  chatType: "p2p" | "group";
  threadMessageId?: string;
  lastMessageId: string;
  updatedAt: number;
};

export type FeishuJobRoute = FeishuRoute & {
  jobId: string;
  jobName?: string;
  createdAt: number;
};

export type FeishuBridgeState = {
  version: 1;
  routes: Record<string, FeishuRoute>;
  jobs: Record<string, FeishuJobRoute>;
  sent: Record<string, number>;
};

export type FeishuMessage = {
  messageId: string;
  chatId: string;
  chatType: "p2p" | "group";
  chatMode?: "p2p" | "group" | "topic";
  senderOpenId: string;
  msgType: string;
  content: string;
  rootId?: string;
  parentId?: string;
  threadId?: string;
  mentions?: unknown[];
};

export type FeishuAttachment = {
  kind: "image" | "file";
  fileKey: string;
  fileName?: string;
};

export type FeishuCardAction = {
  messageId: string;
  chatId?: string;
  operatorOpenId: string;
  token?: string;
  value: unknown;
};

export type FeishuCopyMarkdownAction = {
  copySourceId: string;
};

export type FeishuStatus =
  | "not configured"
  | "connecting"
  | "connected"
  | "owned"
  | "bot unavailable"
  | "disconnected";

export type ParsedMessageInput = {
  text: string;
  attachments: FeishuAttachment[];
  /** 解析来源标记，便于调试 */
  source?: string;
};
