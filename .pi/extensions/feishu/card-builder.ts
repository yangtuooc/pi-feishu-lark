/** 单卡 UI 纯函数：构建飞书 interactive 卡片 JSON（无 IO） */
export type ReplyCardStatus = "running" | "done" | "failed" | "stopped" | "inactive";

export const STOP_ACTION = "pi_feishu_stop_task";
const MAX_PHASE_CHARS = 96;

export function buildReplyCard(input: {
  key: string;
  status: ReplyCardStatus;
  phase?: string;
  body?: string;
  runId?: string;
}) {
  const running = input.status === "running";
  const body = (input.body || "").trim();
  const phase = input.phase ? normalizePhase(input.phase) : undefined;
  const elements: object[] = [];

  if (running && phase) {
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: `进度：${phase}` },
    });
  } else if (!running && phase && input.status !== "done") {
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: phase },
    });
  }

  if (body) {
    if (elements.length) {
      elements.push({ tag: "hr" });
    }
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: body },
    });
  } else if (running) {
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: "…" },
    });
  }

  if (running) {
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          text: { tag: "plain_text", content: "停止" },
          type: "danger",
          value: { action: STOP_ACTION, key: input.key, runId: input.runId },
        },
      ],
    });
  }

  if (!elements.length) {
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: " " },
    });
  }

  return {
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      template: headerTemplate(input.status),
      title: { tag: "plain_text", content: titleForStatus(input.status) },
    },
    elements,
  };
}

export function parseStopTaskActionValue(value: unknown): { key: string; runId?: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as any;
  if (raw.action !== STOP_ACTION || typeof raw.key !== "string") return undefined;
  return {
    key: raw.key,
    runId: typeof raw.runId === "string" ? raw.runId : undefined,
  };
}

export function describePiEvent(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  const raw = event as any;
  switch (raw.type) {
    case "agent_start":
      return "开始";
    case "turn_start":
      return typeof raw.turnIndex === "number" ? `第 ${raw.turnIndex + 1} 轮` : "新一轮";
    case "message_start":
      return raw.message?.role === "assistant" ? "生成回复" : undefined;
    case "message_update":
      return describeAssistantEvent(raw.assistantMessageEvent);
    case "tool_execution_start":
      return withBriefJson(`工具：${raw.toolName || "tool"}`, raw.args);
    case "tool_execution_end":
      return `工具结束：${raw.toolName || "tool"}${raw.isError ? "（失败）" : ""}`;
    case "compaction_start":
      return "整理上下文";
    case "auto_retry_start":
      return typeof raw.attempt === "number" ? `重试 ${raw.attempt}/${raw.maxAttempts || "?"}` : "重试中";
    case "auto_retry_end":
      return raw.success === false ? "重试失败" : "重试完成";
    default:
      return undefined;
  }
}

function describeAssistantEvent(event: any) {
  if (!event?.type) return "生成中";
  if (event.type === "toolcall_end" && event.toolCall?.name) return `工具：${event.toolCall.name}`;
  if (event.type === "done") return "生成中";
  if (event.type === "error" && event.reason) return `错误：${event.reason}`;
  if (event.type.endsWith("_delta")) return undefined;
  return undefined;
}

function withBriefJson(prefix: string, value: unknown) {
  if (value === undefined || value === null) return prefix;
  return normalizePhase(`${prefix} ${JSON.stringify(value)}`);
}

export function normalizePhase(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_PHASE_CHARS) return compact;
  return `${compact.slice(0, MAX_PHASE_CHARS - 1)}…`;
}

function titleForStatus(status: ReplyCardStatus) {
  if (status === "done") return "回复";
  if (status === "failed") return "出错了";
  if (status === "stopped") return "已停止";
  if (status === "inactive") return "已结束";
  return "回复中";
}

function headerTemplate(status: ReplyCardStatus) {
  if (status === "done") return "green";
  if (status === "failed") return "red";
  if (status === "stopped") return "grey";
  if (status === "inactive") return "grey";
  return "blue";
}

export function defaultFinalPhase(status: Exclude<ReplyCardStatus, "running" | "inactive">): string | undefined {
  if (status === "done") return undefined;
  if (status === "failed") return "处理失败";
  return "已停止";
}
