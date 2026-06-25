export const DEFAULT_HEARTBEAT_NOOP_SUPPRESSION_WINDOW_MS = 10 * 60_000;
export const DEFAULT_HEARTBEAT_NOOP_SUPPRESSION_MAX_ENTRIES = 1_000;

export type HeartbeatNoopLogStream = "run" | "task" | "activity";

export interface HeartbeatNoopActionContext {
  inboundMessageCount?: number;
  handledMessageCount?: number;
  pendingRoomMessageCount?: number;
  triggeringCommentCount?: number;
  createdTaskCount?: number;
  delegatedTaskCount?: number;
  assignedTaskCount?: number;
  mutationCount?: number;
  warningCount?: number;
  errorCount?: number;
  toolCallCount?: number;
  partialSnapshot?: boolean;
  unsafe?: boolean;
}

export interface HeartbeatNoopSuppressionCandidate {
  source?: string;
  status?: string;
  agentId?: string;
  taskId?: string | null;
  stream: HeartbeatNoopLogStream;
  summary?: string | null;
  logText?: string | null;
  boardInput?: unknown;
  isNoTaskRun?: boolean;
  actionContext?: HeartbeatNoopActionContext;
  nowMs?: number;
}

export interface HeartbeatNoopSuppressionOptions {
  windowMs?: number;
  maxEntries?: number;
  now?: () => number;
}

interface SuppressionRecord {
  normalizedSummary: string;
  boardInputFingerprint: string;
  lastSeenMs: number;
}

export interface HeartbeatNoopSuppressionDecision {
  suppress: boolean;
  reason:
    | "duplicate"
    | "first-observation"
    | "expired"
    | "non-timer"
    | "non-success"
    | "not-no-task"
    | "missing-target"
    | "missing-summary"
    | "not-noop-summary"
    | "missing-fingerprint"
    | "unsafe-context"
    | "meaningful-action"
    | "changed-summary"
    | "changed-fingerprint";
  key?: string;
  normalizedSummary?: string;
  boardInputFingerprint?: string;
}

const NOOP_SUMMARY_PATTERNS = [
  /\bno\s+(coordination\s+)?intervention\s+needed\b/i,
  /\bno\s+new\s+tasks?\b/i,
  /\bno\s+delegations?\s+created\b/i,
  /\bnothing\s+(?:to\s+do|changed|needed)\b/i,
  /\bno\s+(?:action|changes?)\s+(?:needed|required|taken|made)\b/i,
  /\ball\s+(?:clear|caught\s+up)\b/i,
];

export function normalizeHeartbeatNoopSummary(summary: string): string {
  return summary.replace(/\s+/g, " ").trim();
}

export function isHeartbeatNoopSummary(summary: string): boolean {
  const normalized = normalizeHeartbeatNoopSummary(summary);
  if (!normalized) return false;
  return NOOP_SUMMARY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function canonicalizeForFingerprint(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalizeForFingerprint);
  const out: Record<string, unknown> = {};
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input).sort()) {
    if (key === "runId" || key === "timestamp" || key === "createdAt" || key === "updatedAt" || key === "endedAt" || key === "lastHeartbeatAt") {
      continue;
    }
    out[key] = canonicalizeForFingerprint(input[key]);
  }
  return out;
}

export function fingerprintHeartbeatBoardInput(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(canonicalizeForFingerprint(value));
  } catch {
    return undefined;
  }
}

function hasPositiveCount(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isUnsafeContext(context: HeartbeatNoopActionContext | undefined): boolean {
  return context?.unsafe === true || context?.partialSnapshot === true;
}

function hasMeaningfulAction(context: HeartbeatNoopActionContext | undefined): boolean {
  if (!context) return false;
  return hasPositiveCount(context.inboundMessageCount)
    || hasPositiveCount(context.handledMessageCount)
    || hasPositiveCount(context.pendingRoomMessageCount)
    || hasPositiveCount(context.triggeringCommentCount)
    || hasPositiveCount(context.createdTaskCount)
    || hasPositiveCount(context.delegatedTaskCount)
    || hasPositiveCount(context.assignedTaskCount)
    || hasPositiveCount(context.mutationCount)
    || hasPositiveCount(context.warningCount)
    || hasPositiveCount(context.errorCount)
    || hasPositiveCount(context.toolCallCount);
}

export function buildHeartbeatNoopSuppressionKey(candidate: Pick<HeartbeatNoopSuppressionCandidate, "agentId" | "taskId" | "stream" | "isNoTaskRun">): string | undefined {
  if (!candidate.agentId) return undefined;
  const target = candidate.isNoTaskRun
    ? `agent:${candidate.agentId}:ambient`
    : candidate.taskId
      ? `agent:${candidate.agentId}:task:${candidate.taskId}`
      : undefined;
  if (!target) return undefined;
  return `${target}:stream:${candidate.stream}`;
}

export class HeartbeatNoopSuppressionGuard {
  private readonly windowMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly records = new Map<string, SuppressionRecord>();

  constructor(options: HeartbeatNoopSuppressionOptions = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_HEARTBEAT_NOOP_SUPPRESSION_WINDOW_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_HEARTBEAT_NOOP_SUPPRESSION_MAX_ENTRIES;
    this.now = options.now ?? (() => Date.now());
  }

  evaluate(candidate: HeartbeatNoopSuppressionCandidate): HeartbeatNoopSuppressionDecision {
    const nowMs = candidate.nowMs ?? this.now();
    this.prune(nowMs);

    if (candidate.source !== "timer") return { suppress: false, reason: "non-timer" };
    if (candidate.status !== "completed") return { suppress: false, reason: "non-success" };
    if (candidate.isNoTaskRun !== true) return { suppress: false, reason: "not-no-task" };
    const key = buildHeartbeatNoopSuppressionKey(candidate);
    if (!key) return { suppress: false, reason: "missing-target" };
    const summary = candidate.summary ?? candidate.logText;
    if (!summary) return { suppress: false, reason: "missing-summary", key };
    const normalizedSummary = normalizeHeartbeatNoopSummary(summary);
    if (!normalizedSummary) return { suppress: false, reason: "missing-summary", key };
    if (!isHeartbeatNoopSummary(normalizedSummary)) return { suppress: false, reason: "not-noop-summary", key, normalizedSummary };
    const boardInputFingerprint = fingerprintHeartbeatBoardInput(candidate.boardInput);
    if (!boardInputFingerprint) return { suppress: false, reason: "missing-fingerprint", key, normalizedSummary };
    if (isUnsafeContext(candidate.actionContext)) {
      this.records.delete(key);
      return { suppress: false, reason: "unsafe-context", key, normalizedSummary, boardInputFingerprint };
    }
    if (hasMeaningfulAction(candidate.actionContext)) {
      this.records.delete(key);
      return { suppress: false, reason: "meaningful-action", key, normalizedSummary, boardInputFingerprint };
    }

    const previous = this.records.get(key);
    const next = { normalizedSummary, boardInputFingerprint, lastSeenMs: nowMs };
    this.records.set(key, next);
    this.enforceMaxEntries();

    if (!previous) return { suppress: false, reason: "first-observation", key, normalizedSummary, boardInputFingerprint };
    if (previous.normalizedSummary !== normalizedSummary) return { suppress: false, reason: "changed-summary", key, normalizedSummary, boardInputFingerprint };
    if (previous.boardInputFingerprint !== boardInputFingerprint) return { suppress: false, reason: "changed-fingerprint", key, normalizedSummary, boardInputFingerprint };
    if (nowMs - previous.lastSeenMs > this.windowMs) return { suppress: false, reason: "expired", key, normalizedSummary, boardInputFingerprint };
    return { suppress: true, reason: "duplicate", key, normalizedSummary, boardInputFingerprint };
  }

  size(): number {
    return this.records.size;
  }

  private prune(nowMs: number): void {
    for (const [key, record] of this.records) {
      if (nowMs - record.lastSeenMs > this.windowMs) {
        this.records.delete(key);
      }
    }
  }

  private enforceMaxEntries(): void {
    while (this.records.size > this.maxEntries) {
      const oldestKey = this.records.keys().next().value as string | undefined;
      if (!oldestKey) return;
      this.records.delete(oldestKey);
    }
  }
}
