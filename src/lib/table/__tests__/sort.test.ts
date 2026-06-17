import { describe, expect, it } from "vitest";
import { parseSort, sortRows } from "../sort";

const ALLOWED = ["name", "value"] as const;
const DEF = { col: "name", dir: "asc" as const };

describe("parseSort", () => {
  it("reads asc / desc and falls back for unknown or empty", () => {
    expect(parseSort("name", ALLOWED, DEF)).toEqual({ col: "name", dir: "asc" });
    expect(parseSort("-value", ALLOWED, DEF)).toEqual({ col: "value", dir: "desc" });
    expect(parseSort(undefined, ALLOWED, DEF)).toEqual(DEF);
    expect(parseSort("bogus", ALLOWED, DEF)).toEqual(DEF); // not allow-listed
  });
});

describe("sortRows", () => {
  const rows = [
    { name: "Beta", value: 10 },
    { name: "alpha", value: null },
    { name: "Gamma", value: 2 },
  ];
  const get = (r: (typeof rows)[number], col: string) => (r as Record<string, unknown>)[col];

  it("sorts strings case-insensitively, both directions", () => {
    expect(sortRows(rows, { col: "name", dir: "asc" }, get).map((r) => r.name)).toEqual(["alpha", "Beta", "Gamma"]);
    expect(sortRows(rows, { col: "name", dir: "desc" }, get).map((r) => r.name)).toEqual(["Gamma", "Beta", "alpha"]);
  });

  it("sorts numbers numerically with nulls last in both directions", () => {
    expect(sortRows(rows, { col: "value", dir: "asc" }, get).map((r) => r.value)).toEqual([2, 10, null]);
    expect(sortRows(rows, { col: "value", dir: "desc" }, get).map((r) => r.value)).toEqual([10, 2, null]);
  });

  it("does not mutate the input", () => {
    const before = rows.map((r) => r.name);
    sortRows(rows, { col: "name", dir: "desc" }, get);
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});
