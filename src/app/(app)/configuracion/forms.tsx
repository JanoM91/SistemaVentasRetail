"use client";

import { AppForm, Checkbox, FormField, Input, Select, SubmitButton } from "@/components/ui/form";
import { updateModulesAction, updateSettingsAction } from "./actions";

export const MODULE_LABELS: Record<string, { label: string; hint: string; phase: number }> = {
  catalog: { label: "Catálogo", hint: "Productos, variantes, códigos de barras.", phase: 3 },
  inventory: { label: "Inventario", hint: "Existencias, movimientos, traspasos, conteos.", phase: 3 },
  pos: { label: "Punto de venta y caja", hint: "Ventas, tickets, apertura y corte de caja.", phase: 3 },
  purchases: { label: "Compras y proveedores", hint: "Órdenes de compra y recepciones.", phase: 4 },
  customers: { label: "Clientes", hint: "CRM, segmentos, historial.", phase: 4 },
  promotions: { label: "Promociones y precios", hint: "Descuentos, cupones, listas de precios.", phase: 4 },
  returns: { label: "Devoluciones y cambios", hint: "Reembolsos y crédito en tienda.", phase: 4 },
  credit: { label: "Crédito a clientes", hint: "Límites, saldos y cobranza.", phase: 4 },
  invoicing: { label: "Facturación electrónica", hint: "CFDI por proveedor (adaptador).", phase: 5 },
  reports: { label: "Reportes y dashboard", hint: "Ventas, utilidad, inventario, caja.", phase: 5 },
  channels: { label: "Canales y pedidos", hint: "Ecommerce, WhatsApp, marketplaces.", phase: 5 },
  loyalty: { label: "Lealtad", hint: "Puntos, tarjetas de regalo, saldo prepago.", phase: 5 },
};

export function ModulesForm({ companyId, modules, canManage }: { companyId: string; modules: Array<{ module: string; enabled: boolean }>; canManage: boolean }) {
  return (
    <AppForm action={updateModulesAction} successMessage="Módulos actualizados. La navegación y los permisos se recalculan de inmediato.">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid gap-2 sm:grid-cols-2">
        {modules.map((m) => {
          const meta = MODULE_LABELS[m.module] ?? { label: m.module, hint: "", phase: 0 };
          return <Checkbox key={m.module} name="modules[]" value={m.module} defaultChecked={m.enabled} disabled={!canManage} label={meta.label} hint={`${meta.hint} Pantallas: Fase ${meta.phase}.`} />;
        })}
      </div>
      {canManage && <SubmitButton>Guardar módulos</SubmitButton>}
    </AppForm>
  );
}

export function SettingsForm({ companyId, settings, canManage }: { companyId: string; canManage: boolean; settings: { inventory?: { costingMethod?: string; allowNegativeStock?: boolean }; promotions?: { allowStacking?: boolean; maxDiscountPercent?: number }; pos?: { allowSaleWithoutCustomer?: boolean; requireCustomerForCredit?: boolean }; notifications?: { lowStockEmail?: string | null } } }) {
  return (
    <AppForm action={updateSettingsAction} successMessage="Parámetros guardados.">
      <input type="hidden" name="companyId" value={companyId} />
      <fieldset disabled={!canManage} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField name="inventory.costingMethod" label="Método de costeo" hint="Cómo se calcula el costo de ventas y el valor del inventario.">
            <Select name="inventory.costingMethod" defaultValue={settings.inventory?.costingMethod ?? "average"}>
              <option value="average">Promedio ponderado</option>
              <option value="fifo">FIFO (primeras entradas, primeras salidas)</option>
              <option value="manual">Costo manual</option>
            </Select>
          </FormField>
          <FormField name="promotions.maxDiscountPercent" label="Descuento máximo en POS (%)" hint="Tope para descuentos manuales autorizados.">
            <Input name="promotions.maxDiscountPercent" type="number" min={0} max={100} defaultValue={settings.promotions?.maxDiscountPercent ?? 100} />
          </FormField>
          <FormField name="notifications.lowStockEmail" label="Correo para alertas de inventario bajo">
            <Input name="notifications.lowStockEmail" type="email" defaultValue={settings.notifications?.lowStockEmail ?? ""} />
          </FormField>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Checkbox name="inventory.allowNegativeStock" label="Permitir inventario negativo" hint="Vender aunque no haya existencia registrada (se alerta)." defaultChecked={settings.inventory?.allowNegativeStock ?? false} />
          <Checkbox name="promotions.allowStacking" label="Permitir acumular promociones" hint="Varias promociones compatibles en una misma venta." defaultChecked={settings.promotions?.allowStacking ?? false} />
          <Checkbox name="pos.allowSaleWithoutCustomer" label="Ventas sin cliente registrado" hint="Público en general." defaultChecked={settings.pos?.allowSaleWithoutCustomer ?? true} />
          <Checkbox name="pos.requireCustomerForCredit" label="Exigir cliente en ventas a crédito" defaultChecked={settings.pos?.requireCustomerForCredit ?? true} />
        </div>
        {canManage && <SubmitButton>Guardar parámetros</SubmitButton>}
      </fieldset>
    </AppForm>
  );
}
