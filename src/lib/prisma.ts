/**
 * Prisma Client Singleton
 * Ensures a single database connection across the application
 * Uses lazy initialization to ensure environment variables are loaded first
 */

import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const { Pool } = pg;

// Store singleton instances
let pool: pg.Pool | null = null;
let prisma: PrismaClient | null = null;

/**
 * Get or create the Prisma client singleton
 * This ensures DATABASE_URL is available when the client is first used
 */
function getPrismaClient(): PrismaClient {
  if (prisma) {
    return prisma;
  }

  // Validate DATABASE_URL exists
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  // Create PostgreSQL connection pool
  pool = new Pool({
    connectionString: databaseUrl,
    // Add SSL for Supabase/production
    ssl: databaseUrl.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });

  // Create Prisma adapter and client
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });

  return prisma;
}

// Export a proxy that lazily initializes Prisma
const prismaProxy = new Proxy({} as PrismaClient, {
  get(target, prop) {
    const client = getPrismaClient();
    const value = client[prop as keyof PrismaClient];
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});

export default prismaProxy;

// Export pool getter for cleanup if needed
export function getPool(): pg.Pool | null {
  return pool;
}
