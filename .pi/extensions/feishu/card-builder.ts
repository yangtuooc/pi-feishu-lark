/** 单卡 UI 纯函数：构建飞书 interactive 卡片 JSON（无 IO） */
export type ReplyCardStatus = "running" | "done" | "failed" | "stopped" | "inactive";

export const STOP_ACTION = "pi_feishu_stop_task";
const MAX_NOTE_CHARS = 96;

/**
 * 单卡结构（全程保留 header，避免闪动）：
 * - running: 标题「回复中」+ 占位 + [停止]；不展示进度/过程
 * - done:    标题「回复」+ 最终用户可见正文
 * - stopped/failed: 标题 + 简短说明（可选半段用户正文）
 */
export function buildReplyCard(input: {
  key: string;
  status: ReplyCardStatus;
  /** 仅 stopped/failed 使用的短说明；running/done 忽略 */
  note?: string;
  /** 用户可见正文（done 为最终回复；stopped 可为已生成半段） */
  body?: string;
  runId?: string;
}) {
  const running = input.status === "running";
  const body = (input.body || "").trim();
  const note = input.note ? normalizeNote(input.note) : undefined;
  const elements: object[] = [];

  if (running) {
    // 进行中不展示模型过程，仅占位 + 停止
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: "…" },
    });
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
  } else if (input.status === "done") {
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: body || " " },
    });
  } else {
    // stopped / failed / inactive
    if (note) {
      elements.push({
        tag: "div",
        text: { tag: "lark_md", content: note },
      });
    }
    if (body) {
      if (elements.length) elements.push({ tag: "hr" });
      elements.push({
        tag: "div",
        text: { tag: "lark_md", content: body },
      });
    }
    if (!elements.length) {
      elements.push({
        tag: "div",
        text: { tag: "lark_md", content: " " },
      });
    }
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

function normalizeNote(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_NOTE_CHARS) return compact;
  return `${compact.slice(0, MAX_NOTE_CHARS - 1)}…`;
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

export function defaultFinalNote(status: Exclude<ReplyCardStatus, "running" | "inactive">): string | undefined {
  if (status === "done") return undefined;
  if (status === "failed") return "处理失败";
  return "已停止";
}
