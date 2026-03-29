import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { isDatabaseConfigured } from "@/shared/config/env";
import { env } from "@/shared/config/env";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pglite?: PGlite;
};

function getOrCreatePGlite() {
  if (env.databaseProvider !== "pglite") {
    return null;
  }

  if (!globalForPrisma.pglite) {
    globalForPrisma.pglite = new PGlite({
      dataDir: path.resolve(/* turbopackIgnore: true */ process.cwd(), env.databaseDir),
      database: env.databaseName,
    });
  }

  return globalForPrisma.pglite;
}

function createClient() {
  if (env.databaseProvider === "pglite") {
    const client = getOrCreatePGlite();

    return new PrismaClient({
      adapter: new PrismaPGlite(client!),
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }

  const adapter = new PrismaPg({
    connectionString: env.databaseUrl!,
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export function getPrismaClient() {
  if (!isDatabaseConfigured) {
    return null;
  }

  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }

  return globalForPrisma.prisma;
}

export function getPGlite() {
  return getOrCreatePGlite();
}
