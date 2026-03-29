import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

const prismaCli = path.resolve(process.cwd(), "node_modules/prisma/build/index.js");

const databaseProvider =
  process.env.DATABASE_PROVIDER?.trim() ||
  (process.env.DATABASE_DIR?.trim() ? "pglite" : "postgresql");
const localDatabaseName = process.env.DATABASE_NAME?.trim() || "template1";

if (databaseProvider !== "pglite") {
  const result = spawnSync(process.execPath, [prismaCli, "db", "push"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  process.exit(result.status ?? 1);
}

const databaseDir = path.resolve(
  process.cwd(),
  process.env.DATABASE_DIR?.trim() || ".data/pglite",
);

function createLocalDatabaseClient() {
  return new PGlite({
    dataDir: databaseDir,
    database: localDatabaseName,
  });
}

async function tableExists(db, tableName) {
  const result = await db.query(
    `SELECT to_regclass('public."${tableName}"')::text AS "tableName"`,
  );

  return Boolean(result.rows[0]?.tableName);
}

async function columnExists(db, tableName, columnName) {
  const result = await db.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = '${tableName}'
        AND column_name = '${columnName}'
    ) AS "exists"
  `);

  return Boolean(result.rows[0]?.exists);
}

async function enumTypeExists(db, typeName) {
  const result = await db.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_type
      WHERE typname = '${typeName}'
    ) AS "exists"
  `);

  return Boolean(result.rows[0]?.exists);
}

async function enumValueExists(db, typeName, value) {
  const result = await db.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = '${typeName}'
        AND e.enumlabel = '${value}'
    ) AS "exists"
  `);

  return Boolean(result.rows[0]?.exists);
}

async function constraintExists(db, constraintName) {
  const result = await db.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = '${constraintName}'
    ) AS "exists"
  `);

  return Boolean(result.rows[0]?.exists);
}

async function applyLocalSchemaUpgrades() {
  const db = createLocalDatabaseClient();
  let changed = false;

  try {
    if (!(await enumTypeExists(db, "MessagingChannel"))) {
      await db.exec(`CREATE TYPE "MessagingChannel" AS ENUM ('WHATSAPP')`);
      changed = true;
    }

    if (!(await enumValueExists(db, "MessagingChannel", "IMESSAGE"))) {
      await db.exec(`ALTER TYPE "MessagingChannel" ADD VALUE 'IMESSAGE'`);
      changed = true;
    }

    if (!(await enumValueExists(db, "AssistantChannel", "IMESSAGE"))) {
      await db.exec(`ALTER TYPE "AssistantChannel" ADD VALUE 'IMESSAGE'`);
      changed = true;
    }

    if (!(await enumTypeExists(db, "ChannelIdentityStatus"))) {
      await db.exec(
        `CREATE TYPE "ChannelIdentityStatus" AS ENUM ('VERIFIED', 'REVOKED', 'BLOCKED')`,
      );
      changed = true;
    }

    if (!(await enumTypeExists(db, "ChannelPairingSessionStatus"))) {
      await db.exec(
        `CREATE TYPE "ChannelPairingSessionStatus" AS ENUM ('PENDING', 'CONSUMED', 'REVOKED', 'EXPIRED')`,
      );
      changed = true;
    }

    if (!(await enumTypeExists(db, "HeartbeatCadenceUnit"))) {
      await db.exec(
        `CREATE TYPE "HeartbeatCadenceUnit" AS ENUM ('MINUTES', 'HOURS', 'DAYS')`,
      );
      changed = true;
    }

    if (!(await enumTypeExists(db, "HeartbeatRunStatus"))) {
      await db.exec(
        `CREATE TYPE "HeartbeatRunStatus" AS ENUM ('IDLE', 'SUCCESS', 'FAILED')`,
      );
      changed = true;
    }

    if (!(await tableExists(db, "UserChannelIdentity"))) {
      await db.exec(`
        CREATE TABLE "UserChannelIdentity" (
          "id" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "channel" "MessagingChannel" NOT NULL,
          "externalAddress" TEXT NOT NULL,
          "status" "ChannelIdentityStatus" NOT NULL DEFAULT 'VERIFIED',
          "verifiedAt" TIMESTAMP(3),
          "revokedAt" TIMESTAMP(3),
          "lastIncomingAt" TIMESTAMP(3),
          "lastOutgoingAt" TIMESTAMP(3),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL,

          CONSTRAINT "UserChannelIdentity_pkey" PRIMARY KEY ("id")
        )
      `);
      changed = true;
    }

    if (!(await tableExists(db, "ChannelPairingSession"))) {
      await db.exec(`
        CREATE TABLE "ChannelPairingSession" (
          "id" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "channel" "MessagingChannel" NOT NULL,
          "pairingCodeHash" TEXT NOT NULL,
          "status" "ChannelPairingSessionStatus" NOT NULL DEFAULT 'PENDING',
          "expiresAt" TIMESTAMP(3) NOT NULL,
          "consumedAt" TIMESTAMP(3),
          "revokedAt" TIMESTAMP(3),
          "attemptCount" INTEGER NOT NULL DEFAULT 0,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL,

          CONSTRAINT "ChannelPairingSession_pkey" PRIMARY KEY ("id")
        )
      `);
      changed = true;
    }

    if (!(await tableExists(db, "HeartbeatConfig"))) {
      await db.exec(`
        CREATE TABLE "HeartbeatConfig" (
          "id" TEXT NOT NULL,
          "scope" TEXT NOT NULL DEFAULT 'global',
          "enabled" BOOLEAN NOT NULL DEFAULT false,
          "cadenceValue" INTEGER NOT NULL DEFAULT 30,
          "cadenceUnit" "HeartbeatCadenceUnit" NOT NULL DEFAULT 'MINUTES',
          "cadenceMinutes" INTEGER NOT NULL DEFAULT 30,
          "lastRunAt" TIMESTAMP(3),
          "lastCursorAt" TIMESTAMP(3),
          "lastDeliveryAt" TIMESTAMP(3),
          "lastRunStatus" "HeartbeatRunStatus" NOT NULL DEFAULT 'IDLE',
          "lastRunSummary" TEXT,
          "lastError" TEXT,
          "updatedByUserId" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL,

          CONSTRAINT "HeartbeatConfig_pkey" PRIMARY KEY ("id")
        )
      `);
      changed = true;
    }

    if (!(await tableExists(db, "HeartbeatNotification"))) {
      await db.exec(`
        CREATE TABLE "HeartbeatNotification" (
          "id" TEXT NOT NULL,
          "configId" TEXT NOT NULL,
          "dedupeKey" TEXT NOT NULL,
          "auditLogId" TEXT,
          "recipientUserId" TEXT NOT NULL,
          "channel" "MessagingChannel",
          "payload" TEXT NOT NULL,
          "delivered" BOOLEAN NOT NULL DEFAULT false,
          "reason" TEXT,
          "attemptCount" INTEGER NOT NULL DEFAULT 1,
          "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "deliveredAt" TIMESTAMP(3),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

          CONSTRAINT "HeartbeatNotification_pkey" PRIMARY KEY ("id")
        )
      `);
      changed = true;
    }

    if (!(await columnExists(db, "WhatsAppMessage", "processingNote"))) {
      await db.exec(`ALTER TABLE "WhatsAppMessage" ADD COLUMN "processingNote" TEXT`);
      changed = true;
    }

    if (!(await columnExists(db, "WhatsAppMessage", "linkedUserId"))) {
      await db.exec(`ALTER TABLE "WhatsAppMessage" ADD COLUMN "linkedUserId" TEXT`);
      changed = true;
    }

    if (!(await columnExists(db, "WhatsAppMessage", "channelIdentityId"))) {
      await db.exec(`ALTER TABLE "WhatsAppMessage" ADD COLUMN "channelIdentityId" TEXT`);
      changed = true;
    }

    if (!(await columnExists(db, "User", "deletedAt"))) {
      await db.exec(`ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3)`);
      changed = true;
    }

    if (!(await columnExists(db, "Customer", "createdByUserId"))) {
      await db.exec(`ALTER TABLE "Customer" ADD COLUMN "createdByUserId" TEXT`);
      changed = true;
    }

    if (!(await columnExists(db, "Customer", "createdByUserNameSnapshot"))) {
      await db.exec(`ALTER TABLE "Customer" ADD COLUMN "createdByUserNameSnapshot" TEXT`);
      changed = true;
    }

    if (!(await columnExists(db, "Location", "createdByUserId"))) {
      await db.exec(`ALTER TABLE "Location" ADD COLUMN "createdByUserId" TEXT`);
      changed = true;
    }

    if (!(await columnExists(db, "Location", "createdByUserNameSnapshot"))) {
      await db.exec(`ALTER TABLE "Location" ADD COLUMN "createdByUserNameSnapshot" TEXT`);
      changed = true;
    }

    if (!(await columnExists(db, "Request", "createdByUserNameSnapshot"))) {
      await db.exec(`ALTER TABLE "Request" ADD COLUMN "createdByUserNameSnapshot" TEXT`);
      changed = true;
    }

    if (!(await columnExists(db, "Appointment", "createdByUserNameSnapshot"))) {
      await db.exec(`ALTER TABLE "Appointment" ADD COLUMN "createdByUserNameSnapshot" TEXT`);
      changed = true;
    }

    if (!(await columnExists(db, "Appointment", "updatedByUserNameSnapshot"))) {
      await db.exec(`ALTER TABLE "Appointment" ADD COLUMN "updatedByUserNameSnapshot" TEXT`);
      changed = true;
    }

    if (!(await columnExists(db, "WorkOrder", "createdByUserNameSnapshot"))) {
      await db.exec(`ALTER TABLE "WorkOrder" ADD COLUMN "createdByUserNameSnapshot" TEXT`);
      changed = true;
    }

    if (!(await columnExists(db, "WorkOrder", "closedByUserNameSnapshot"))) {
      await db.exec(`ALTER TABLE "WorkOrder" ADD COLUMN "closedByUserNameSnapshot" TEXT`);
      changed = true;
    }

    if (!(await columnExists(db, "InvoiceReminder", "createdByUserNameSnapshot"))) {
      await db.exec(`ALTER TABLE "InvoiceReminder" ADD COLUMN "createdByUserNameSnapshot" TEXT`);
      changed = true;
    }

    if (!(await columnExists(db, "InvoiceReminder", "updatedByUserNameSnapshot"))) {
      await db.exec(`ALTER TABLE "InvoiceReminder" ADD COLUMN "updatedByUserNameSnapshot" TEXT`);
      changed = true;
    }

    if (!(await columnExists(db, "AuditLog", "actorUserNameSnapshot"))) {
      await db.exec(`ALTER TABLE "AuditLog" ADD COLUMN "actorUserNameSnapshot" TEXT`);
      changed = true;
    }

    if (!(await constraintExists(db, "UserChannelIdentity_userId_fkey"))) {
      await db.exec(`
        ALTER TABLE "UserChannelIdentity"
        ADD CONSTRAINT "UserChannelIdentity_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
      `);
      changed = true;
    }

    if (!(await constraintExists(db, "ChannelPairingSession_userId_fkey"))) {
      await db.exec(`
        ALTER TABLE "ChannelPairingSession"
        ADD CONSTRAINT "ChannelPairingSession_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
      `);
      changed = true;
    }

    if (!(await constraintExists(db, "WhatsAppMessage_linkedUserId_fkey"))) {
      await db.exec(`
        ALTER TABLE "WhatsAppMessage"
        ADD CONSTRAINT "WhatsAppMessage_linkedUserId_fkey"
        FOREIGN KEY ("linkedUserId") REFERENCES "User"("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE
      `);
      changed = true;
    }

    if (!(await constraintExists(db, "WhatsAppMessage_channelIdentityId_fkey"))) {
      await db.exec(`
        ALTER TABLE "WhatsAppMessage"
        ADD CONSTRAINT "WhatsAppMessage_channelIdentityId_fkey"
        FOREIGN KEY ("channelIdentityId") REFERENCES "UserChannelIdentity"("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE
      `);
      changed = true;
    }

    if (!(await constraintExists(db, "HeartbeatConfig_updatedByUserId_fkey"))) {
      await db.exec(`
        ALTER TABLE "HeartbeatConfig"
        ADD CONSTRAINT "HeartbeatConfig_updatedByUserId_fkey"
        FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE
      `);
      changed = true;
    }

    if (!(await constraintExists(db, "Customer_createdByUserId_fkey"))) {
      await db.exec(`
        ALTER TABLE "Customer"
        ADD CONSTRAINT "Customer_createdByUserId_fkey"
        FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE
      `);
      changed = true;
    }

    if (!(await constraintExists(db, "Location_createdByUserId_fkey"))) {
      await db.exec(`
        ALTER TABLE "Location"
        ADD CONSTRAINT "Location_createdByUserId_fkey"
        FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE
      `);
      changed = true;
    }

    if (!(await constraintExists(db, "HeartbeatNotification_configId_fkey"))) {
      await db.exec(`
        ALTER TABLE "HeartbeatNotification"
        ADD CONSTRAINT "HeartbeatNotification_configId_fkey"
        FOREIGN KEY ("configId") REFERENCES "HeartbeatConfig"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
      `);
      changed = true;
    }

    if (!(await constraintExists(db, "HeartbeatNotification_recipientUserId_fkey"))) {
      await db.exec(`
        ALTER TABLE "HeartbeatNotification"
        ADD CONSTRAINT "HeartbeatNotification_recipientUserId_fkey"
        FOREIGN KEY ("recipientUserId") REFERENCES "User"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
      `);
      changed = true;
    }

    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UserChannelIdentity_channel_externalAddress_key"
      ON "UserChannelIdentity"("channel", "externalAddress")
    `);
    await db.exec(`
      CREATE INDEX IF NOT EXISTS "UserChannelIdentity_userId_channel_status_idx"
      ON "UserChannelIdentity"("userId", "channel", "status")
    `);
    await db.exec(`
      CREATE INDEX IF NOT EXISTS "ChannelPairingSession_userId_channel_status_expiresAt_idx"
      ON "ChannelPairingSession"("userId", "channel", "status", "expiresAt")
    `);
    await db.exec(`
      CREATE INDEX IF NOT EXISTS "ChannelPairingSession_channel_pairingCodeHash_status_idx"
      ON "ChannelPairingSession"("channel", "pairingCodeHash", "status")
    `);
    await db.exec(`
      CREATE INDEX IF NOT EXISTS "WhatsAppMessage_linkedUserId_createdAt_idx"
      ON "WhatsAppMessage"("linkedUserId", "createdAt")
    `);
    await db.exec(`
      CREATE INDEX IF NOT EXISTS "WhatsAppMessage_channelIdentityId_createdAt_idx"
      ON "WhatsAppMessage"("channelIdentityId", "createdAt")
    `);
    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS "HeartbeatConfig_scope_key"
      ON "HeartbeatConfig"("scope")
    `);
    await db.exec(`
      CREATE INDEX IF NOT EXISTS "Customer_createdByUserId_idx"
      ON "Customer"("createdByUserId")
    `);
    await db.exec(`
      CREATE INDEX IF NOT EXISTS "Location_createdByUserId_idx"
      ON "Location"("createdByUserId")
    `);
    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS "HeartbeatNotification_dedupeKey_key"
      ON "HeartbeatNotification"("dedupeKey")
    `);
    await db.exec(`
      CREATE INDEX IF NOT EXISTS "HeartbeatNotification_configId_createdAt_idx"
      ON "HeartbeatNotification"("configId", "createdAt")
    `);
    await db.exec(`
      CREATE INDEX IF NOT EXISTS "HeartbeatNotification_recipientUserId_createdAt_idx"
      ON "HeartbeatNotification"("recipientUserId", "createdAt")
    `);
    await db.exec(`
      CREATE INDEX IF NOT EXISTS "HeartbeatNotification_auditLogId_createdAt_idx"
      ON "HeartbeatNotification"("auditLogId", "createdAt")
    `);

    return changed;
  } finally {
    await db.close();
  }
}

async function hasDirectoryContents(targetPath) {
  try {
    const entries = await fs.readdir(targetPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function inspectLocalDatabase() {
  await fs.mkdir(databaseDir, { recursive: true });

  const probeResult = spawnSync(
    process.execPath,
    [path.resolve(process.cwd(), "scripts/db-probe.mjs"), databaseDir, localDatabaseName],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  if ((probeResult.status ?? 1) !== 0) {
    const diagnostic = (probeResult.stderr || probeResult.stdout || "Unknown PGlite probe failure.")
      .trim()
      .split("\n")
      .slice(-12)
      .join("\n");

    return {
      status: "corrupt",
      message: diagnostic,
    };
  }

  try {
    return JSON.parse(probeResult.stdout.trim() || `{"status":"missing_schema"}`);
  } catch {
    return {
      status: "corrupt",
      message: "Invalid probe output while inspecting local database.",
    };
  }
}

async function backupInvalidDatabase(reason) {
  if (!(await hasDirectoryContents(databaseDir))) {
    return null;
  }

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const backupDir = `${databaseDir}.${reason}.${timestamp}`;
  await fs.rename(databaseDir, backupDir);
  return backupDir;
}

async function ensureCleanDatabaseDirectory() {
  await fs.mkdir(path.dirname(databaseDir), { recursive: true });
  await fs.mkdir(databaseDir, { recursive: true });
}

async function buildSchemaSql() {
  const result = spawnSync(
    process.execPath,
    [
      prismaCli,
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema",
      "prisma/schema.prisma",
      "--script",
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }

  return result.stdout.replace(/^Loaded Prisma config from .*\n+/u, "").trim();
}

const inspection = await inspectLocalDatabase();

if (inspection.status === "ready") {
  const changed = await applyLocalSchemaUpgrades();
  if (changed) {
    process.stdout.write(`Η local βάση αναβαθμίστηκε στο ${databaseDir}.\n`);
    process.exit(0);
  }

  process.stdout.write(`Η local βάση είναι ήδη έτοιμη στο ${databaseDir}.\n`);
  process.exit(0);
}

if (inspection.status === "corrupt") {
  const backupDir = await backupInvalidDatabase("corrupted");
  process.stderr.write(
    `Βρέθηκε corrupt local βάση (${inspection.message}). ` +
      `${backupDir ? `Μεταφέρθηκε στο ${backupDir}.` : "Θα ξαναστηθεί καθαρά."}\n`,
  );
} else {
  const backupDir = await backupInvalidDatabase("replaced");
  if (backupDir) {
    process.stdout.write(`Η παλιά local βάση μεταφέρθηκε στο ${backupDir}.\n`);
  }
}

await ensureCleanDatabaseDirectory();

const sql = await buildSchemaSql();
if (!sql) {
  process.stdout.write("Το schema είναι ήδη συγχρονισμένο.\n");
  process.exit(0);
}

const db = createLocalDatabaseClient();

try {
  await db.exec(sql);
  process.stdout.write(`Η local βάση δημιουργήθηκε στο ${databaseDir}.\n`);
} finally {
  await db.close();
}

const verification = await inspectLocalDatabase();
if (verification.status !== "ready") {
  process.stderr.write("Η local βάση δεν επαληθεύτηκε μετά το bootstrap.\n");
  process.exit(1);
}
