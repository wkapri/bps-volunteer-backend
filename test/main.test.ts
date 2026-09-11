import { mkdir, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SugCreatedSignup } from "../src/sugClient.js";

const createdActive = vi.fn();
vi.mock("../src/sugClient.js", () => ({
  SignUpGeniusClient: vi.fn().mockImplementation(() => ({ createdActive })),
}));

const buildCanteen = vi.fn();
vi.mock("../src/canteen.js", () => ({ buildCanteen: (...args: unknown[]) => buildCanteen(...args) }));

const buildEvents = vi.fn();
vi.mock("../src/events.js", () => ({ buildEvents: (...args: unknown[]) => buildEvents(...args) }));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

const { main } = await import("../src/main.js");

const SIGNUP: SugCreatedSignup = {
  signupid: 1,
  title: "Canteen Volunteer",
  group: "g",
  groupid: 1,
  signupurl: "https://www.signupgenius.com/go/canteen",
  contactname: "William Kwok",
  startdate: 0,
  enddate: 0,
  startdatestring: "",
  enddatestring: "",
  starttime: 0,
  endtime: 0,
  thumbnail: "",
  mainimage: "",
};

const EMPTY_CANTEEN_RESULT = {
  canteen: { signupId: 1, title: "Canteen Volunteer", signupUrl: SIGNUP.signupurl, days: [] },
  warnings: [] as string[],
  source: "public-sheet" as const,
};

const EMPTY_EVENTS_RESULT = { events: [], warnings: [] as string[], fetchedCount: 0, failureCount: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUG_API_KEY = "test-key";
  process.env.OUTPUT_PATH = "/tmp/main-test-output.json";
  createdActive.mockResolvedValue([SIGNUP]);
  buildCanteen.mockResolvedValue(EMPTY_CANTEEN_RESULT);
  buildEvents.mockResolvedValue(EMPTY_EVENTS_RESULT);
});

afterEach(() => {
  delete process.env.SUG_API_KEY;
  delete process.env.OUTPUT_PATH;
  process.exitCode = undefined;
});

describe("main", () => {
  it("aborts without writing when SUG_API_KEY is unset", async () => {
    delete process.env.SUG_API_KEY;
    await main();
    expect(process.exitCode).toBe(1);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("aborts without writing when listing active sign-ups fails — DESIGN.md 4.3", async () => {
    createdActive.mockRejectedValue(new Error("network blip"));
    await main();
    expect(process.exitCode).toBe(1);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("aborts without writing when buildCanteen throws (both its own sources failed)", async () => {
    buildCanteen.mockRejectedValue(new Error("both canteen sources down"));
    await main();
    expect(process.exitCode).toBe(1);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("writes a schema-shaped data.json on success, with diagnostics from both builders", async () => {
    buildCanteen.mockResolvedValue({
      canteen: { signupId: 1, title: "Canteen Volunteer", signupUrl: SIGNUP.signupurl, days: [] },
      warnings: ["canteen note"],
      source: "key-api",
    });
    buildEvents.mockResolvedValue({
      events: [],
      warnings: ["event note"],
      fetchedCount: 2,
      failureCount: 0,
    });

    await main();

    expect(process.exitCode).toBeUndefined();
    expect(mkdir).toHaveBeenCalledWith("/tmp", { recursive: true });
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, contents] = vi.mocked(writeFile).mock.calls[0]!;
    expect(path).toBe("/tmp/main-test-output.json");

    const data = JSON.parse(contents as string);
    expect(data.schemaVersion).toBe(1);
    expect(data.timezone).toBe("Australia/Sydney");
    expect(data.diagnostics).toEqual({
      canteenSource: "key-api",
      eventsFetched: 2,
      warnings: ["canteen note", "event note"],
    });
  });

  it("passes the resolved canteen signupId through to buildEvents (to exclude it from candidates)", async () => {
    buildCanteen.mockResolvedValue({
      canteen: { signupId: 42, title: "Canteen Volunteer", signupUrl: SIGNUP.signupurl, days: [] },
      warnings: [],
      source: "public-sheet",
    });

    await main();

    expect(buildEvents).toHaveBeenCalledWith(expect.anything(), [SIGNUP], 42);
  });
});
