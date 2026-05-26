import { describe, it, expect } from "vitest";
import { isSnoozed, withinCooldown, isDue, shouldSnooze, applyPerCompanyCap } from "../cadence";
import { isUnsubscribe } from "../reply";

const now = new Date("2026-03-01T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const daysAhead = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();

describe("cadence", () => {
  it("snooze gating", () => {
    expect(isSnoozed(daysAhead(10), now)).toBe(true);
    expect(isSnoozed(daysAgo(10), now)).toBe(false);
    expect(isSnoozed(null, now)).toBe(false);
  });

  it("cooldown gating", () => {
    expect(withinCooldown(daysAgo(5), now, 28)).toBe(true);
    expect(withinCooldown(daysAgo(40), now, 28)).toBe(false);
    expect(withinCooldown(null, now, 28)).toBe(false); // never touched
  });

  it("isDue combines snooze + cooldown", () => {
    expect(isDue({ last_touched_at: null, snooze_until: null }, now, 28)).toBe(true);
    expect(isDue({ last_touched_at: daysAgo(5), snooze_until: null }, now, 28)).toBe(false);
    expect(isDue({ last_touched_at: daysAgo(40), snooze_until: null }, now, 28)).toBe(true);
    expect(isDue({ last_touched_at: daysAgo(40), snooze_until: daysAhead(10) }, now, 28)).toBe(false);
  });

  it("auto-snooze after N touches with no engagement", () => {
    expect(shouldSnooze(3, false, 3)).toBe(true);
    expect(shouldSnooze(3, true, 3)).toBe(false); // engaged → never auto-snooze
    expect(shouldSnooze(2, false, 3)).toBe(false);
  });

  it("per-company cap preserves order, keeps orgless rows", () => {
    const rows = [
      { id: 1, organisation_id: "a" },
      { id: 2, organisation_id: "a" },
      { id: 3, organisation_id: "b" },
      { id: 4, organisation_id: "a" },
      { id: 5, organisation_id: null },
    ];
    const capped = applyPerCompanyCap(rows, 2);
    expect(capped.map((r) => r.id)).toEqual([1, 2, 3, 5]); // 3rd 'a' dropped
  });
});

describe("reply classification", () => {
  it("flags opt-out language", () => {
    expect(isUnsubscribe("Please unsubscribe me")).toBe(true);
    expect(isUnsubscribe("STOP")).toBe(true);
    expect(isUnsubscribe("Can you take me off your list?")).toBe(true);
    expect(isUnsubscribe("do not contact me again")).toBe(true);
  });
  it("treats genuine replies as non-opt-out", () => {
    expect(isUnsubscribe("Sounds interesting, can we chat next week?")).toBe(false);
    expect(isUnsubscribe("")).toBe(false);
  });
});
