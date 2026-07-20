import test from "node:test";
import assert from "node:assert/strict";
import { buildReplyCard, parseStopTaskActionValue } from "../.pi/extensions/feishu/card-builder.ts";

test("running: streams body, no progress line", () => {
  const card = buildReplyCard({ key: "k", status: "running", body: "你好", runId: "r1" }) as any;
  assert.equal(card.header.title.content, "回复中");
  const s = JSON.stringify(card);
  assert.match(s, /你好/);
  assert.equal(s.includes("进度"), false);
  assert.equal(s.includes("停止"), true);
  assert.equal(s.includes("任务"), false);
});

test("running empty body shows placeholder", () => {
  const card = buildReplyCard({ key: "k", status: "running", runId: "r1" }) as any;
  assert.match(JSON.stringify(card), /…/);
});

test("done: final body under header 回复", () => {
  const card = buildReplyCard({ key: "k", status: "done", body: "最终给用户的话" }) as any;
  assert.equal(card.header.title.content, "回复");
  assert.match(JSON.stringify(card), /最终给用户的话/);
});

test("stopped short note", () => {
  const s = buildReplyCard({ key: "k", status: "stopped", note: "已停止" }) as any;
  assert.equal(s.header.title.content, "已停止");
});

test("failed", () => {
  const f = buildReplyCard({ key: "k", status: "failed", note: "超时" }) as any;
  assert.equal(f.header.title.content, "出错了");
});

test("parse stop action", () => {
  const v = parseStopTaskActionValue({ action: "pi_feishu_stop_task", key: "g1", runId: "r" });
  assert.deepEqual(v, { key: "g1", runId: "r" });
});
