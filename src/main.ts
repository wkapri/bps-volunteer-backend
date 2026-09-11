import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DateTime } from "luxon";
import { buildCanteen } from "./canteen.js";
import { buildEvents } from "./events.js";
import { SignUpGeniusClient } from "./sugClient.js";
import type { VolunteerData } from "./types.js";

const TIMEZONE = "Australia/Sydney";
const OUTPUT_PATH = process.env.OUTPUT_PATH ?? "dist/data.json";

async function main(): Promise<void> {
  const apiKey = process.env.SUG_API_KEY;
  if (!apiKey) {
    console.error("SUG_API_KEY is not set.");
    process.exitCode = 1;
    return;
  }

  const client = new SignUpGeniusClient(apiKey);

  // DESIGN.md 4.3: any error here aborts the run and leaves the previous
  // data.json untouched — we simply don't write a new one.
  const signups = await client.createdActive().catch((err) => {
    console.error("Failed to list active sign-ups; aborting run.", err);
    return null;
  });
  if (!signups) {
    process.exitCode = 1;
    return;
  }

  const canteenResult = await buildCanteen(client, signups).catch((err) => {
    console.error("Failed to build canteen section; aborting run.", err);
    return null;
  });
  if (!canteenResult) {
    process.exitCode = 1;
    return;
  }
  const { canteen, warnings: canteenWarnings } = canteenResult;

  const { events, warnings: eventWarnings, fetchedCount, failureCount } = await buildEvents(
    client,
    signups,
    canteen.signupId,
  );
  const warnings = [...canteenWarnings, ...eventWarnings];

  if (failureCount > 3) {
    console.error(`⚠ ${failureCount} events failed to fetch this run — see diagnostics.warnings.`);
  }

  const data: VolunteerData = {
    generatedAt: DateTime.now().setZone(TIMEZONE).toISO() ?? "",
    timezone: TIMEZONE,
    schemaVersion: 1,
    canteen,
    events,
    diagnostics: {
      canteenSource: "key-api",
      eventsFetched: fetchedCount,
      warnings,
    },
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");

  console.log(
    `Wrote ${OUTPUT_PATH} — canteen days: ${data.canteen.days.length}, events: ${data.events.length}, warnings: ${warnings.length}`,
  );
}

main().catch((err) => {
  console.error("Unexpected error; aborting run.", err);
  process.exitCode = 1;
});
