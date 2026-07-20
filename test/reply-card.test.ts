import test from "node:test";
import assert from "node:assert/strict";
import { buildReplyCard, parseStopTaskActionValue } from "../.pi/extensions/feishu/card-builder.ts";

test("running card has header 回复中 and stop button", () => {
  const card = buildReplyCard({ key: "k", status: "running", phase: "生成中", body: "你好", runId: "r1" }) as any;
  assert.equal(card.header.title.content, "回复中");
  assert.equal(card.header.template, "blue");
  assert.equal(JSON.stringify(card).includes("停止"), true);
  assert.match(JSON.stringify(card), /你好/);
  assert.equal(JSON.stringify(card).includes("任务"), false);
});

test("done card keeps header 回复 and body", () => {
  const card = buildReplyCard({ key: "k", status: "done", body: "最终答案" }) as any;
  assert.equal(card.header.title.content, "回复");
  assert.equal(card.header.template, "green");
  assert.match(JSON.stringify(card), /最终答案/);
});

test("stopped short copy", () => {
  const s = buildReplyCard({ key: "k", status: "stopped", phase: "已停止", body: "半段" }) as any;
  assert.equal(s.header.title.content, "已停止");
  assert.match(JSON.stringify(s), /半段/);
  assert.equal(JSON.stringify(s).includes("任务"), false);
});

test("failed header", () => {
  const f = buildReplyCard({ key: "k", status: "failed", phase: "超时" }) as any;
  assert.equal(f.header.title.content, "出错了");
});

test("parse stop action", () => {
  const v = parseStopTaskActionValue({ action: "pi_feishu_stop_task", key: "g1", runId: "r" });
  assert.deepEqual(v, { key: "g1", runId: "r" });
});
