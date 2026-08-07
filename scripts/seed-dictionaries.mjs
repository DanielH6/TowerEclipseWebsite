import "dotenv/config";
import { ensureDefaultDictionaries } from "../server/dictionaries.mjs";

try {
  const { created } = await ensureDefaultDictionaries();
  console.log(created > 0
    ? `Dictionary seed complete: ${created} missing default entries created.`
    : "Dictionary seed complete: all default entries already exist.");
} catch (error) {
  console.error("Dictionary seed failed:", error);
  process.exitCode = 1;
}
