import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** Verifica base de datos y migraciones aplicadas. */
export async function GET() {
  try {
    const [{ migrations }] = (
      await db.execute<{ migrations: string }>(sql`select count(*)::text as migrations from drizzle.__drizzle_migrations`)
    ).rows;
    return NextResponse.json({ ok: true, database: "up", migrations: Number(migrations), time: new Date().toISOString() });
  } catch (err) {
    console.error("[health]", err);
    return NextResponse.json({ ok: false, database: "down" }, { status: 503 });
  }
}
