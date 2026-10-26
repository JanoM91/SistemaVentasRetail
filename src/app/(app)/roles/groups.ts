import { AREA_LABELS, PERMISSIONS, type PermissionArea } from "@/server/authz/permissions";
import type { RequestContext } from "@/server/context";
import type { PermissionGroup } from "./role-form";

export function permissionGroups(ctx: RequestContext): PermissionGroup[] {
  const byArea = new Map<PermissionArea, PermissionGroup>();
  for (const p of PERMISSIONS) {
    if (p.area === "platform") continue;
    const g = byArea.get(p.area) ?? { area: p.area, label: AREA_LABELS[p.area], items: [] };
    g.items.push({ code: p.code, label: p.label, grantable: ctx.permissions.has(p.code) });
    byArea.set(p.area, g);
  }
  return [...byArea.values()];
}
