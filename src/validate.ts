import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const SCHEMA_PATH = new URL("../schema/data.schema.json", import.meta.url);
const TARGET_PATH = process.argv[2] ?? "dist/data.json";

async function main(): Promise<void> {
  const [schema, target] = await Promise.all([
    readFile(SCHEMA_PATH, "utf8").then(JSON.parse),
    readFile(TARGET_PATH, "utf8").then(JSON.parse),
  ]);

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  if (!validate(target)) {
    console.error(`${TARGET_PATH} does not match schema/data.schema.json:`);
    for (const err of validate.errors ?? []) {
      console.error(`  ${err.instancePath || "(root)"} ${err.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`${TARGET_PATH} is valid.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
