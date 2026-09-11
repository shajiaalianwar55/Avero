import { access } from "node:fs/promises";
import { resolve } from "node:path";
import "./validate-fixtures.js";

await access(resolve("supabase/seed.sql"));
if (process.argv.includes("--check")) {
  console.log("valid: supabase/seed.sql is present and its source fixtures pass shared contracts");
} else {
  console.log("Run `supabase db reset` to apply migrations and supabase/seed.sql.");
}
