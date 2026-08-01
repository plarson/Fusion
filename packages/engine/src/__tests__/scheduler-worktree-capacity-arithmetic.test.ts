// @vitest-environment node
/*
FNXC:WorktreeCapacity 2026-08-01-00:50:
THE WORKTREE-CAPACITY ARITHMETIC — the numbers behind two live defects, previously unpinned.

#3262 pinned the terminal PREDICATE and said plainly what it did not cover: blinding that predicate
to `false` leaves all 22 scheduler suites green, because the arithmetic it feeds had no behavioural
coverage at all. This is that gap.

Both observed failures live in these few lines, and they fail in OPPOSITE directions:

  UNDER-COUNT admits work over the cap. The commit that added this gate reports maxWorktrees=4 with
  four planning sessions each holding a worktree, and a replan dispatch admitted as the FIFTH,
  because the ledger counted WIP cards only and never learned to count planners.

  OVER-COUNT self-deadlocks. A planned Ready card RETAINS its planning worktree for execution reuse,
  so counting it as a holder blocks its own release — 2 wip + 3 idle-held = 5/4, and the first
  unpause released only 2 of 4 slots' worth of work.

Asymmetry is why both are pinned: under-counting breaks the cap and lets real work over it;
over-counting only starves dispatch. A test that covered the "safe" direction alone would leave the
expensive one open.

WHY THE PREDICATE IS INJECTED rather than resolved here: the holder set's job is the SET ARITHMETIC —
who is excluded and how the total is formed. Which lanes are terminal is #3262's test, and resolving
it here would make this file fail for that reason instead of this one.
*/

import { describe, expect, it } from "vitest";
import type { Task } from "@fusion/core";
import { nonWipWorktreeHolderIdsOf, releaseReservedSlot, releaseWorktreeReservation, reserveWorktreeOnDispatch, resolveCandidateWorktreeCapacityLimit } from "../scheduler.js";

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: id,
  description: "",
  column: "todo",
  dependencies: [],
  steps: [],
  currentStep: 0,
  log: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
} as Task);

const neverTerminal = () => false;
const terminalIds = (ids: string[]) => (t: Task) => ids.includes(t.id);

describe("worktree-capacity holder set", () => {
  it("counts a non-WIP card that HOLDS a worktree — the planner the ledger used to miss", () => {
    /*
    The under-count defect, minimally: four planning sessions holding worktrees, none of them WIP.
    Before the gate learned to count them the reserved total was 0 and a fifth dispatch was admitted.
    */
    const planners = ["P1", "P2", "P3", "P4"].map((id) => task(id, { worktree: `/wt/${id}` }));

    const holders = nonWipWorktreeHolderIdsOf(planners, [], neverTerminal);

    expect(holders).toEqual(["P1", "P2", "P3", "P4"]);
    expect(holders.length).toBe(4);
  });

  it("does not double-count a WIP card that also holds a worktree", () => {
    /* WIP membership already reserves; adding the same card as a holder would inflate the total. */
    const tasks = [task("W1", { worktree: "/wt/W1" }), task("I1", { worktree: "/wt/I1" })];

    expect(nonWipWorktreeHolderIdsOf(tasks, ["W1"], neverTerminal)).toEqual(["I1"]);
  });

  it("excludes a TERMINAL card's retained worktree — cleanup-owned, not capacity", () => {
    const tasks = [task("DONE1", { worktree: "/wt/DONE1" }), task("LIVE1", { worktree: "/wt/LIVE1" })];

    expect(nonWipWorktreeHolderIdsOf(tasks, [], terminalIds(["DONE1"]))).toEqual(["LIVE1"]);
  });

  it("ignores a card with no worktree — a WIP card without one still reserves via WIP, not here", () => {
    const tasks = [task("N1"), task("N2", { worktree: "" }), task("H1", { worktree: "/wt/H1" })];

    expect(nonWipWorktreeHolderIdsOf(tasks, [], neverTerminal)).toEqual(["H1"]);
  });

  it("reproduces the observed 5-of-4 total that the self-deadlock fix addresses", () => {
    /*
    2 wip + 3 idle-held = 5 against maxWorktrees=4. The total itself is CORRECT — every one of those
    five is a real worktree. The bug was gating a candidate against a total that included the
    candidate's OWN retained worktree, which the next case covers.
    */
    const wipIds = ["W1", "W2"];
    const tasks = [
      task("W1", { worktree: "/wt/W1" }),
      task("W2", { worktree: "/wt/W2" }),
      task("R1", { worktree: "/wt/R1" }),
      task("R2", { worktree: "/wt/R2" }),
      task("R3", { worktree: "/wt/R3" }),
    ];

    const holders = nonWipWorktreeHolderIdsOf(tasks, wipIds, neverTerminal);
    const reservedWorktreeSlots = wipIds.length + holders.length;

    expect(holders).toEqual(["R1", "R2", "R3"]);
    expect(reservedWorktreeSlots).toBe(5);
  });
});

describe("resolveCandidateWorktreeCapacityLimit", () => {
  it("does not gate a candidate that reuses its retained worktree, even while the ledger is over cap", () => {
    /*
    FNXC:WorktreeCapacity 2026-08-01-04:07:
    Live regression: 12 non-terminal cards retained worktrees against maxWorktrees=9. A queued
    candidate already owned one of those trees, so dispatch would transfer the existing slot and
    leave the ledger at 12. Subtracting only the candidate (12 - 1 = 11) still wedged every queued
    card forever. The worktree dimension must be absent for a zero-allocation transfer; the separate
    maxConcurrent gate continues to arbitrate whether another agent may run.
    */
    expect(resolveCandidateWorktreeCapacityLimit(9, true)).toBeNull();
  });

  it("keeps the configured gate for a candidate that must allocate a worktree", () => {
    expect(resolveCandidateWorktreeCapacityLimit(9, false)).toBe(9);
  });

  it("preserves a disabled worktree gate for every candidate", () => {
    expect(resolveCandidateWorktreeCapacityLimit(null, false)).toBeNull();
    expect(resolveCandidateWorktreeCapacityLimit(null, true)).toBeNull();
  });
});

describe("ledger mutations", () => {
  it("dispatch TRANSFERS a held slot rather than adding one", () => {
    expect(reserveWorktreeOnDispatch(4, true)).toBe(4);
  });

  it("dispatch ADDS a slot for a candidate holding no worktree", () => {
    expect(reserveWorktreeOnDispatch(4, false)).toBe(5);
  });

  it("a failed retained transfer leaves the worktree ledger unchanged", () => {
    expect(releaseWorktreeReservation(5, true)).toBe(5);
  });

  it("a failed fresh allocation gives its worktree slot back", () => {
    expect(releaseWorktreeReservation(5, false)).toBe(4);
  });

  it("a failed dispatch gives the slot back", () => {
    expect(releaseReservedSlot(5)).toBe(4);
  });

  it("release FLOORS at zero — a negative count would read as free capacity", () => {
    /*
    The floor is the whole point of the Math.max. Every later comparison in the loop treats the
    reserved count as "slots in use"; a negative value silently hands out capacity that does not
    exist, which is the under-count direction that admits work over the cap.
    */
    expect(releaseReservedSlot(0)).toBe(0);
    expect(releaseReservedSlot(-3)).toBe(0);
  });
});
