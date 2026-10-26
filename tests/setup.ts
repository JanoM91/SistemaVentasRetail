import { config } from "dotenv";
import { vi } from "vitest";

config({ path: ".env.test" });
config();
if (!process.env.TEST_DATABASE_URL) {
  throw new Error("Define TEST_DATABASE_URL en .env.test (base de datos de pruebas, se vacía en cada corrida).");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// `server-only` no existe fuera de Next.js.
vi.mock("server-only", () => ({}));
