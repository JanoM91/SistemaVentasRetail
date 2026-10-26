/** Vacía el esquema público de la base de datos de DATABASE_URL (solo desarrollo). */
import "dotenv/config";
import { Pool } from "pg";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("No se permite en producción.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query("drop schema public cascade; create schema public;");
  await pool.query("drop schema if exists drizzle cascade;");
  await pool.end();
  console.log("✔ Base de datos vaciada");
}
main();
