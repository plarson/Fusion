import type { Task } from "./types.js";

export type DependencyStatusKind = "active" | "resolved-done" | "resolved-archived" | "satisfied-in-review" | "missing";

export interface DependencyStatus {
  id: string;
  kind: DependencyStatusKind;
  column?: Task["column"];
  duplicate: boolean;
  occurrences: number;
}

export interface DependencySummary {
  statuses: DependencyStatus[];
  active: DependencyStatus[];
  resolved: DependencyStatus[];
  missing: DependencyStatus[];
}

const SATISFIED_COLUMNS = new Set<Task["column"]>(["done", "archived", "in-review"]);

export function isDependencySchedulingSatisfied(dependency: Pick<Task, "column"> | undefined): boolean {
  if (!dependency) return true;
  return SATISFIED_COLUMNS.has(dependency.column as Task["column"]);
}

export function classifyDependencyStatus(
  dependencyId: string,
  dependency: Pick<Task, "column"> | undefined,
): DependencyStatusKind {
  if (!dependency) return "missing";
  if (dependency.column === "done") return "resolved-done";
  if (dependency.column === "archived") return "resolved-archived";
  if (dependency.column === "in-review") return "satisfied-in-review";
  return "active";
}

export function classifyDependencyStatuses(
  dependencyIds: readonly string[],
  tasks: readonly Pick<Task, "id" | "column">[],
): DependencySummary {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const occurrenceCounts = new Map<string, number>();
  const orderedIds: string[] = [];

  for (const rawId of dependencyIds) {
    const id = rawId.trim();
    if (!id) continue;
    occurrenceCounts.set(id, (occurrenceCounts.get(id) ?? 0) + 1);
    if (!orderedIds.includes(id)) orderedIds.push(id);
  }

  const statuses = orderedIds.map((id): DependencyStatus => {
    const dependency = taskById.get(id);
    const kind = classifyDependencyStatus(id, dependency);
    const occurrences = occurrenceCounts.get(id) ?? 1;
    return {
      id,
      kind,
      column: dependency?.column,
      duplicate: occurrences > 1,
      occurrences,
    };
  });

  return {
    statuses,
    active: statuses.filter((status) => status.kind === "active"),
    resolved: statuses.filter((status) => status.kind === "resolved-done" || status.kind === "resolved-archived" || status.kind === "satisfied-in-review"),
    missing: statuses.filter((status) => status.kind === "missing"),
  };
}

export function formatDependencyStatusLabel(status: DependencyStatus): string {
  const duplicateSuffix = status.duplicate ? ` ×${status.occurrences}` : "";
  switch (status.kind) {
    case "active":
      return `${status.id}${duplicateSuffix}`;
    case "resolved-done":
      return `${status.id} (done/resolved${duplicateSuffix})`;
    case "resolved-archived":
      return `${status.id} (archived/resolved${duplicateSuffix})`;
    case "satisfied-in-review":
      return `${status.id} (in-review/satisfied${duplicateSuffix})`;
    case "missing":
      return `${status.id} (missing/not active${duplicateSuffix})`;
  }
}

export function formatDependencySummary(summary: DependencySummary): string {
  const parts: string[] = [];
  if (summary.active.length > 0) {
    parts.push(`active deps: ${summary.active.map(formatDependencyStatusLabel).join(", ")}`);
  }
  if (summary.resolved.length > 0) {
    parts.push(`resolved deps: ${summary.resolved.map(formatDependencyStatusLabel).join(", ")}`);
  }
  if (summary.missing.length > 0) {
    parts.push(`missing deps: ${summary.missing.map(formatDependencyStatusLabel).join(", ")}`);
  }
  return parts.join("; ");
}

export function formatDependencySummaryForTask(
  task: Pick<Task, "dependencies">,
  tasks: readonly Pick<Task, "id" | "column">[],
): string {
  return formatDependencySummary(classifyDependencyStatuses(task.dependencies ?? [], tasks));
}
