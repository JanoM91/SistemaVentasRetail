/**
 * Verificación de integridad del inventario: recalcula la existencia desde el
 * libro inmutable y la compara con los saldos materializados de cada empresa.
 * Uso: npm run stock:verify   (código de salida 1 si hay diferencias)
 */
import "dotenv/config";
import { db, pool } from "../src/server/db";
import { companies } from "../src/server/db/schema";
import { verifyStockIntegrity } from "../src/server/modules/inventory/service";

async function main() {
  const all = await db.select({ id: companies.id, name: companies.tradeName }).from(companies);
  let problems = 0;
  for (const c of all) {
    const diffs = await verifyStockIntegrity(db, c.id);
    if (diffs.length) {
      problems += diffs.length;
      console.log(`✘ ${c.name}: ${diffs.length} diferencia(s)`);
      for (const d of diffs) console.log(`   almacén ${d.warehouse_id} variante ${d.variant_id}: saldo ${d.on_hand} vs libro ${d.ledger_sum}`);
    } else console.log(`✔ ${c.name}: saldos = libro`);
  }
  process.exitCode = problems ? 1 : 0;
}
main().finally(() => pool.end());
