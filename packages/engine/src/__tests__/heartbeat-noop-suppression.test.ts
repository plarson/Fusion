import { describe, expect, it } from "vitest";
import {
  HeartbeatNoopSuppressionGuard,
  fingerprintHeartbeatBoardInput,
  normalizeHeartbeatNoopSummary,
} from "../heartbeat-noop-suppression.js";

const baseCandidate = {
  source: "timer",
  status: "completed",
  agentId: "agent-1",
  stream: "run" as const,
  isNoTaskRun: true,
  summary: "No coordination intervention needed; no new tasks or delegations created.",
  boardInput: { tasks: [{ id: "FN-1", column: "in-progress", updatedAt: "volatile" }], inbox: [] },
  actionContext: {},
};

describe("heartbeat no-op suppression", () => {
  it("normalizes whitespace conservatively", () => {
    expect(normalizeHeartbeatNoopSummary(" No   coordination\nintervention needed. ")).toBe("No coordination intervention needed.");
    expect(normalizeHeartbeatNoopSummary("No coordination intervention needed.")).not.toBe("no coordination intervention needed.");
  });

  it("suppresses exact duplicate no-op summaries inside the window and persists after expiry", () => {
    const guard = new HeartbeatNoopSuppressionGuard({ windowMs: 1_000 });

    expect(guard.evaluate({ ...baseCandidate, nowMs: 0 }).suppress).toBe(false);
    expect(guard.evaluate({ ...baseCandidate, nowMs: 500 })).toMatchObject({ suppress: true, reason: "duplicate" });
    expect(guard.evaluate({ ...baseCandidate, nowMs: 1_501 })).toMatchObject({ suppress: false, reason: "first-observation" });
  });

  it("scopes duplicates by agent, task, and stream without using run ids", () => {
    const guard = new HeartbeatNoopSuppressionGuard({ windowMs: 1_000 });
    expect(guard.evaluate({ ...baseCandidate, boardInput: { ...baseCandidate.boardInput, runId: "run-1" }, nowMs: 0 }).suppress).toBe(false);
    expect(guard.evaluate({ ...baseCandidate, boardInput: { ...baseCandidate.boardInput, runId: "run-2" }, nowMs: 100 })).toMatchObject({ suppress: true });
    expect(guard.evaluate({ ...baseCandidate, agentId: "agent-2", nowMs: 200 }).suppress).toBe(false);
    expect(guard.evaluate({ ...baseCandidate, stream: "task", taskId: "FN-1", isNoTaskRun: false, nowMs: 300 })).toMatchObject({ suppress: false, reason: "not-no-task" });
  });

  it("fingerprints stable board/input fields and ignores volatile timestamps", () => {
    const a = fingerprintHeartbeatBoardInput({ b: 2, a: { updatedAt: "one", id: "FN-1" } });
    const b = fingerprintHeartbeatBoardInput({ a: { id: "FN-1", updatedAt: "two" }, b: 2 });
    const c = fingerprintHeartbeatBoardInput({ a: { id: "FN-2" }, b: 2 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("fails open for missing metadata, partial snapshots, messages, tools, and warnings", () => {
    const guard = new HeartbeatNoopSuppressionGuard({ windowMs: 1_000 });
    expect(guard.evaluate({ ...baseCandidate, nowMs: 0 }).suppress).toBe(false);
    expect(guard.evaluate({ ...baseCandidate, boardInput: undefined, nowMs: 100 })).toMatchObject({ suppress: false, reason: "missing-fingerprint" });
    expect(guard.evaluate({ ...baseCandidate, actionContext: { partialSnapshot: true }, nowMs: 100 })).toMatchObject({ suppress: false, reason: "unsafe-context" });
    expect(guard.evaluate({ ...baseCandidate, actionContext: { inboundMessageCount: 1 }, nowMs: 100 })).toMatchObject({ suppress: false, reason: "meaningful-action" });
    expect(guard.evaluate({ ...baseCandidate, actionContext: { toolCallCount: 1 }, nowMs: 100 })).toMatchObject({ suppress: false, reason: "meaningful-action" });
    expect(guard.evaluate({ ...baseCandidate, actionContext: { warningCount: 1 }, nowMs: 100 })).toMatchObject({ suppress: false, reason: "meaningful-action" });
  });

  it("does not suppress different summaries or changed board/input fingerprints", () => {
    const summaryGuard = new HeartbeatNoopSuppressionGuard({ windowMs: 1_000 });
    expect(summaryGuard.evaluate({ ...baseCandidate, nowMs: 0 }).suppress).toBe(false);
    expect(summaryGuard.evaluate({ ...baseCandidate, summary: "No action needed.", nowMs: 100 })).toMatchObject({ suppress: false, reason: "changed-summary" });

    const fingerprintGuard = new HeartbeatNoopSuppressionGuard({ windowMs: 1_000 });
    expect(fingerprintGuard.evaluate({ ...baseCandidate, nowMs: 0 }).suppress).toBe(false);
    expect(fingerprintGuard.evaluate({ ...baseCandidate, boardInput: { tasks: [{ id: "FN-2" }], inbox: [] }, nowMs: 100 })).toMatchObject({ suppress: false, reason: "changed-fingerprint" });
  });

  it("prunes and bounds suppression state", () => {
    const guard = new HeartbeatNoopSuppressionGuard({ windowMs: 100, maxEntries: 2 });
    guard.evaluate({ ...baseCandidate, agentId: "agent-1", nowMs: 0 });
    guard.evaluate({ ...baseCandidate, agentId: "agent-2", nowMs: 10 });
    guard.evaluate({ ...baseCandidate, agentId: "agent-3", nowMs: 20 });
    expect(guard.size()).toBe(2);
    guard.evaluate({ ...baseCandidate, agentId: "agent-4", nowMs: 200 });
    expect(guard.size()).toBe(1);
  });
});
