import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDateSlotIds, urlKeyFromSignupUrl } from "../src/publicSignupApi.js";

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

describe("fetchDateSlotIds", () => {
  it("parses the real response shape into a date -> slotid map", async () => {
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
                items: [{ item: "10-12", slotitemid: 1843217753, qty: 2, qtyTaken: 2 }],
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

    const map = await fetchDateSlotIds("10C054FABA722AAFFC07-63670841-canteen");
    expect(map.get("2026-09-17")).toBe(837061137);
    expect(map.get("2026-09-25")).toBe(837061140);
    expect(map.size).toBe(2);
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    await expect(fetchDateSlotIds("whatever")).rejects.toThrow(/HTTP 500/);
  });
});
