/**
 * Print total database size and per-table sizes.
 *
 * Usage (from backend directory):
 *   npx tsx src/scripts/db-size.ts
 *   npm run db:size
 *
 * Requires: DATABASE_URL in .env
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";

async function main(): Promise<void> {
  type SizeRow = { size: string };
  type TableSizeRow = { table_name: string; total_size: string };

  const [total] = await prisma.$queryRaw<SizeRow[]>`
    SELECT pg_size_pretty(pg_database_size(current_database())) AS size
  `;
  console.log("Total database size:", total?.size ?? "unknown");

  const tables = await prisma.$queryRaw<TableSizeRow[]>`
    SELECT relname AS table_name,
           pg_size_pretty(pg_total_relation_size(relid)) AS total_size
    FROM pg_catalog.pg_statio_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
  `;
  console.log("\nTables (largest first):");
  for (const row of tables) {
    console.log(`  ${row.table_name}: ${row.total_size}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
