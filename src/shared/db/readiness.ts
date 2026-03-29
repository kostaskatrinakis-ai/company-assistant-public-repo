import { UserRole } from "@prisma/client";
import { hashPassword } from "@/shared/auth/local-auth";
import { env, isDatabaseConfigured } from "@/shared/config/env";
import { getPrismaClient } from "@/shared/db/prisma";

const globalForDatabaseReadiness = globalThis as unknown as {
  databaseReadyPromise?: Promise<void>;
};

async function ensureSchemaAvailable() {
  const prisma = getPrismaClient();

  if (!prisma) {
    throw new Error("Η βάση δεδομένων δεν είναι διαθέσιμη.");
  }

  try {
    await prisma.user.count();
  } catch {
    throw new Error(
      "Το schema της βάσης δεν είναι διαθέσιμο. Τρέξε `npm run db:push`.",
    );
  }
}

async function ensureBootstrapAdmin() {
  const prisma = getPrismaClient();

  if (!prisma) {
    return;
  }

  const userCount = await prisma.user.count();
  if (userCount > 0) {
    return;
  }

  await prisma.user.create({
    data: {
      email: env.bootstrapAdminEmail.toLowerCase(),
      fullName: env.bootstrapAdminName,
      role: UserRole.ADMIN,
      passwordHash: hashPassword(env.bootstrapAdminPassword),
    },
  });
}

export async function ensureDatabaseReady() {
  if (!isDatabaseConfigured || !getPrismaClient()) {
    throw new Error("Η βάση δεδομένων δεν είναι ρυθμισμένη.");
  }

  if (!globalForDatabaseReadiness.databaseReadyPromise) {
    globalForDatabaseReadiness.databaseReadyPromise = (async () => {
      await ensureSchemaAvailable();
      await ensureBootstrapAdmin();
    })();
  }

  return globalForDatabaseReadiness.databaseReadyPromise;
}

export async function getDatabaseClient() {
  await ensureDatabaseReady();

  const prisma = getPrismaClient();

  if (!prisma) {
    throw new Error("Η βάση δεδομένων δεν είναι διαθέσιμη.");
  }

  return prisma;
}
