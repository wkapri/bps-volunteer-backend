import { describe, expect, it } from "vitest";
import { fillPct, statusFromPct } from "../src/status.js";

describe("fillPct", () => {
  it("returns null for zero capacity", () => {
    expect(fillPct(0, 0)).toBeNull();
  });

  it("rounds to nearest integer", () => {
    expect(fillPct(1, 3)).toBe(33);
    expect(fillPct(2, 3)).toBe(67);
  });
});

describe("statusFromPct", () => {
  it("maps thresholds per DESIGN.md 4.2", () => {
    expect(statusFromPct(null)).toBe("closed");
    expect(statusFromPct(0)).toBe("red");
    expect(statusFromPct(24)).toBe("red");
    expect(statusFromPct(25)).toBe("amber");
    expect(statusFromPct(74)).toBe("amber");
    expect(statusFromPct(75)).toBe("green");
    expect(statusFromPct(100)).toBe("green");
  });
});
