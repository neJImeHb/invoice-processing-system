import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

export async function migrate(pool: Pool): Promise<void> {
  const sqlUrl = new URL("./init.sql", import.meta.url);
  sqlUrl.search = "";
  const sql = await readFile(fileURLToPath(sqlUrl), "utf8");
  await pool.query(sql);
}
