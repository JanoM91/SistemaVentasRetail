import "server-only";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

export type ColumnType = "text" | "money" | "qty" | "int" | "percent" | "date";
export type ReportColumn = { key: string; label: string; type: ColumnType };
export type ReportTable = { title: string; columns: ReportColumn[]; rows: Array<Record<string, unknown>>; totals?: Record<string, unknown>; note?: string };
export type ReportDocument = { title: string; subtitle: string; company: string; currency: string; generatedAt: Date; tz: string; tables: ReportTable[] };

const money = (cents: number, currency: string) => new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(cents / 100);
const fmtDate = (d: Date, tz: string) => new Intl.DateTimeFormat("es-MX", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(d);

/** Texto legible de una celda (CSV y PDF). */
function cell(v: unknown, type: ColumnType, doc: ReportDocument): string {
  if (v === null || v === undefined || v === "") return type === "text" ? "" : "—";
  switch (type) {
    case "money": return money(Number(v), doc.currency);
    case "percent": return `${Number(v).toFixed(1)} %`;
    case "qty": return Number(v).toLocaleString("es-MX", { maximumFractionDigits: 3 });
    case "int": return Number(v).toLocaleString("es-MX");
    case "date": return v instanceof Date ? fmtDate(v, doc.tz) : String(v);
    default: return String(v);
  }
}

/** CSV con BOM para que Excel respete acentos. Varias tablas se separan con una línea en blanco. */
export function toCsv(doc: ReportDocument): string {
  const esc = (s: string) => (/[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const raw = (v: unknown, type: ColumnType) => {
    if (v === null || v === undefined) return "";
    if (type === "money") return (Number(v) / 100).toFixed(2);
    if (type === "date") return v instanceof Date ? v.toISOString() : String(v);
    return String(v);
  };
  const parts: string[] = [`${esc(doc.title)}`, `${esc(doc.subtitle)}`, ""];
  for (const t of doc.tables) {
    parts.push(esc(t.title));
    parts.push(t.columns.map((c) => esc(c.label + (c.type === "money" ? ` (${doc.currency})` : ""))).join(","));
    for (const r of t.rows) parts.push(t.columns.map((c) => esc(raw(r[c.key], c.type))).join(","));
    if (t.totals) parts.push(t.columns.map((c, i) => esc(i === 0 ? "Total" : raw(t.totals![c.key], c.type))).join(","));
    if (t.note) parts.push(esc(t.note));
    parts.push("");
  }
  return "﻿" + parts.join("\n");
}

/** Excel: una hoja por tabla, números como números (con formato), encabezado fijo y filtros. */
export async function toXlsx(doc: ReportDocument): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = doc.company;
  wb.created = doc.generatedAt;
  const used = new Set<string>();
  for (const t of doc.tables) {
    let name = t.title.replace(/[\\/*?:[\]]/g, "").slice(0, 28) || "Hoja";
    for (let i = 2; used.has(name); i++) name = `${name.slice(0, 25)} ${i}`;
    used.add(name);
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 4 }] });
    ws.addRow([doc.title]).font = { bold: true, size: 14 };
    ws.addRow([`${doc.subtitle} · ${t.title}`]).font = { color: { argb: "FF666666" } };
    ws.addRow([]);
    const header = ws.addRow(t.columns.map((c) => c.label));
    header.font = { bold: true };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF3F8" } };
    for (const r of t.rows) {
      ws.addRow(
        t.columns.map((c) => {
          const v = r[c.key];
          if (v === null || v === undefined) return null;
          if (c.type === "money") return Number(v) / 100;
          if (c.type === "percent") return Number(v) / 100;
          if (c.type === "qty" || c.type === "int") return Number(v);
          return v instanceof Date ? v : String(v);
        }),
      );
    }
    if (t.totals) {
      const tr = ws.addRow(t.columns.map((c, i) => (i === 0 ? "Total" : t.totals![c.key] === undefined || t.totals![c.key] === null ? null : c.type === "money" ? Number(t.totals![c.key]) / 100 : c.type === "percent" ? Number(t.totals![c.key]) / 100 : Number(t.totals![c.key]))));
      tr.font = { bold: true };
    }
    t.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.type === "text" ? Math.min(45, Math.max(14, ...t.rows.slice(0, 200).map((r) => String(r[c.key] ?? "").length + 2), c.label.length + 2)) : Math.max(14, c.label.length + 2);
      if (c.type === "money") col.numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
      if (c.type === "percent") col.numFmt = "0.0%";
      if (c.type === "qty") col.numFmt = "#,##0.###";
      if (c.type === "int") col.numFmt = "#,##0";
      if (c.type === "date") col.numFmt = "dd/mm/yyyy hh:mm";
    });
    if (t.rows.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: t.columns.length } };
    if (t.note) ws.addRow([t.note]).font = { italic: true, color: { argb: "FF996600" } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** PDF tabular (carta horizontal) con encabezado, paginación y totales. */
export function toPdf(doc: ReportDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 36, info: { Title: doc.title, Author: doc.company } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    const left = pdf.page.margins.left;
    const width = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
    const bottom = () => pdf.page.height - pdf.page.margins.bottom - 20;
    const header = () => {
      pdf.font("Helvetica-Bold").fontSize(14).fillColor("#111").text(doc.title, left, 36, { width });
      pdf.font("Helvetica").fontSize(9).fillColor("#555").text(`${doc.company} · ${doc.subtitle} · generado ${fmtDate(doc.generatedAt, doc.tz)}`, { width });
      pdf.moveDown(0.6);
    };
    header();
    for (const t of doc.tables) {
      const weights = t.columns.map((c) => (c.type === "text" ? 3 : 1.3));
      const sum = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map((w) => (w / sum) * width);
      const drawRow = (vals: string[], opts: { bold?: boolean; fill?: string } = {}) => {
        const h = 16;
        if (pdf.y + h > bottom()) {
          pdf.addPage();
          header();
        }
        const y = pdf.y;
        if (opts.fill) pdf.rect(left, y - 2, width, h).fill(opts.fill);
        pdf.fillColor("#111").font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
        let x = left;
        vals.forEach((v, i) => {
          const align = t.columns[i].type === "text" ? "left" : "right";
          pdf.text(v, x + 3, y + 2, { width: widths[i] - 6, align, lineBreak: false, ellipsis: true });
          x += widths[i];
        });
        pdf.y = y + h;
        pdf.x = left;
      };
      if (pdf.y + 60 > bottom()) {
        pdf.addPage();
        header();
      }
      pdf.font("Helvetica-Bold").fontSize(11).fillColor("#111").text(t.title, left, pdf.y, { width });
      pdf.moveDown(0.3);
      drawRow(t.columns.map((c) => c.label), { bold: true, fill: "#EEF2F7" });
      t.rows.forEach((r, i) => drawRow(t.columns.map((c) => cell(r[c.key], c.type, doc)), { fill: i % 2 ? "#FAFAFA" : undefined }));
      if (!t.rows.length) drawRow(t.columns.map((_, i) => (i === 0 ? "Sin datos en el periodo" : "")));
      if (t.totals) drawRow(t.columns.map((c, i) => (i === 0 ? "Total" : t.totals![c.key] === undefined ? "" : cell(t.totals![c.key], c.type, doc))), { bold: true, fill: "#EEF2F7" });
      if (t.note) pdf.font("Helvetica-Oblique").fontSize(8).fillColor("#996600").text(t.note, left, pdf.y + 2, { width });
      pdf.moveDown(1);
    }
    pdf.end();
  });
}
