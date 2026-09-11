import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCanteenSlots, urlKeyFromSignupUrl } from "../src/publicSignupApi.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("urlKeyFromSignupUrl", () => {
  it("extracts the slug after /go/", () => {
    expect(urlKeyFromSignupUrl("https://www.signupgenius.com/go/10C054FABA722AAFFC07-63670841-canteen")).toBe(
      "10C054FABA722AAFFC07-63670841-canteen",
    );
  });

  it("returns null for an unrecognised URL", () => {
    expect(urlKeyFromSignupUrl("https://example.com/not-a-signup")).toBeNull();
  });
});

describe("fetchCanteenSlots", () => {
  it("parses the real response shape into date -> {slotid, shifts}", async () => {
    // Trimmed shape of an actual response from SUGboxAPI.cfm?go=s.getSignupInfo,
    // confirmed live 2026-09-11 against wkapri/bps-volunteer-backend's own test
    // canteen sign-up.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          MESSAGE: [],
          DATA: {
            slots: {
              "837061137": {
                slotid: 837061137,
                starttime: "September, 17 2026 00:00:00",
                items: [
                  { item: "10-12", slotitemid: 1843217753, qty: 2, qtyTaken: 2 },
                  { item: "12-2", slotitemid: 1843217752, qty: 2, qtyTaken: 2 },
                ],
              },
              "837061140": {
                slotid: 837061140,
                starttime: "September, 25 2026 00:00:00",
                items: [{ item: "10-12", slotitemid: 1843216472, qty: 2, qtyTaken: 0 }],
              },
            },
          },
        }),
      })),
    );

    const map = await fetchCanteenSlots("10C054FABA722AAFFC07-63670841-canteen");

    expect(map.get("2026-09-17")).toEqual({
      slotid: 837061137,
      shifts: [
        { label: "10-12", capacity: 2, filled: 2 },
        { label: "12-2", capacity: 2, filled: 2 },
      ],
    });
    expect(map.get("2026-09-25")).toEqual({
      slotid: 837061140,
      shifts: [{ label: "10-12", capacity: 2, filled: 0 }],
    });
    expect(map.size).toBe(2);
  });

  it("coerces qty/qtyTaken to numbers, including SignUpGenius's empty-string-for-zero quirk", async () => {
    // Observed live 2026-09-11: qtyTaken comes back as "" (not 0) whenever a
    // shift is completely unfilled. Naively using the raw value caused
    // capacity/filled to be computed via string concatenation ("0" + "2" =
    // "02") instead of addition — this locks in the fix.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          MESSAGE: [],
          DATA: {
            slots: {
              "837061072": {
                slotid: 837061072,
                starttime: "September, 14 2026 00:00:00",
                items: [
                  { item: "10-12", slotitemid: 1, qty: 1, qtyTaken: "" },
                  { item: "12-2", slotitemid: 2, qty: 1, qtyTaken: "" },
                ],
              },
            },
          },
        }),
      })),
    );

    const map = await fetchCanteenSlots("whatever");
    const day = map.get("2026-09-14")!;
    expect(day.shifts).toEqual([
      { label: "10-12", capacity: 1, filled: 0 },
      { label: "12-2", capacity: 1, filled: 0 },
    ]);
    // The regression: filled must be the number 0, not the string "".
    for (const s of day.shifts) {
      expect(typeof s.filled).toBe("number");
      expect(typeof s.capacity).toBe("number");
    }
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    await expect(fetchCanteenSlots("whatever")).rejects.toThrow(/HTTP 500/);
  });
});
