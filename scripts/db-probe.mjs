import { PGlite } from "@electric-sql/pglite";

const [, , databaseDirArg, databaseNameArg] = process.argv;

if (!databaseDirArg) {
  process.stderr.write("DATABASE_DIR argument is required.\n");
  process.exit(1);
}

const databaseName = databaseNameArg?.trim() || "template1";

async function main() {
  const db = new PGlite({
    dataDir: databaseDirArg,
    database: databaseName,
  });

  try {
    const schema = await db.query(`
      SELECT
        to_regclass('public."User"')::text AS "userTable",
        to_regclass('public."Customer"')::text AS "customerTable",
        to_regclass('public."AssistantConversation"')::text AS "assistantConversationTable",
        to_regclass('public."AssistantActionRequest"')::text AS "assistantActionRequestTable",
        to_regclass('public."InvoiceReminder"')::text AS "invoiceReminderTable"
    `);

    const tables = schema.rows[0];

    if (
      !tables?.userTable ||
      !tables?.customerTable ||
      !tables?.assistantConversationTable ||
      !tables?.assistantActionRequestTable ||
      !tables?.invoiceReminderTable
    ) {
      process.stdout.write(JSON.stringify({ status: "missing_schema" }));
      return;
    }

    await db.query(`SELECT count(*)::int AS "count" FROM "User"`);
    await db.query(`SELECT count(*)::int AS "count" FROM "Customer"`);
    await db.query(`SELECT count(*)::int AS "count" FROM "AssistantConversation"`);
    await db.query(`SELECT count(*)::int AS "count" FROM "AssistantActionRequest"`);
    await db.query(`SELECT count(*)::int AS "count" FROM "InvoiceReminder"`);

    process.stdout.write(JSON.stringify({ status: "ready" }));
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        status: "corrupt",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  } finally {
    await db.close().catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
