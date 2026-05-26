import { describe, it, expect } from "vitest";
import { ukHour, isBusinessDay, isWithinSendingWindow } from "../window";
import { parseRamp, dailyCap, daysSince } from "../warmup";
import { shouldAutoPause } from "../autopause";

describe("sending window", () => {
  // 2026-01-14 is a Wednesday; January = London is UTC (no DST).
  const wed10 = new Date("2026-01-14T10:00:00Z");
  const wed20 = new Date("2026-01-14T20:00:00Z");
  const sat10 = new Date("2026-01-17T10:00:00Z");

  it("reads the UK hour", () => {
    expect(ukHour(wed10)).toBe(10);
    expect(ukHour(wed20)).toBe(20);
  });
  it("knows business days", () => {
    expect(isBusinessDay(wed10)).toBe(true);
    expect(isBusinessDay(sat10)).toBe(false);
  });
  it("gates to business hours", () => {
    expect(isWithinSendingWindow(wed10, 9, 17)).toBe(true);
    expect(isWithinSendingWindow(wed20, 9, 17)).toBe(false);
    expect(isWithinSendingWindow(sat10, 9, 17)).toBe(false);
  });
});

describe("warm-up ramp", () => {
  const ramp = parseRamp("10,20,35,50");
  it("parses", () => expect(ramp).toEqual([10, 20, 35, 50]));
  it("caps per day, clamping to the last step", () => {
    expect(dailyCap(ramp, 0)).toBe(10);
    expect(dailyCap(ramp, 2)).toBe(35);
    expect(dailyCap(ramp, 3)).toBe(50);
    expect(dailyCap(ramp, 99)).toBe(50);
  });
  it("computes whole days since start", () => {
    const now = new Date("2026-01-10T00:00:00Z");
    expect(daysSince("2026-01-08T00:00:00Z", now)).toBe(2);
    expect(daysSince(undefined, now)).toBe(0);
  });
});

describe("auto-pause", () => {
  it("pauses above the complaint threshold", () => {
    const r = shouldAutoPause({ sent: 1000, complaints: 4, bounces: 0 }, { complaintRate: 0.003 });
    expect(r.pause).toBe(true);
  });
  it("stays running below threshold", () => {
    expect(shouldAutoPause({ sent: 1000, complaints: 2, bounces: 10 }).pause).toBe(false);
  });
  it("pauses on a bounce spike", () => {
    expect(shouldAutoPause({ sent: 200, complaints: 0, bounces: 20 }).pause).toBe(true);
  });
  it("ignores tiny samples (min-volume guard)", () => {
    expect(shouldAutoPause({ sent: 5, complaints: 2, bounces: 0 }).pause).toBe(false);
  });
});
