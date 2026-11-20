/** Reads an uploaded .xlsx or .csv in the browser into headers + rows of strings. */
export type SheetRow = Record<string, string>;

export function parseCsv(text: string): { headers: string[]; rows: SheetRow[] } {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell), out.push(row), (row = []), (cell = '');
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), out.push(row);
  return toRows(out.map((r) => r.map((c) => c.trim())));
}

function toRows(table: string[][]) {
  const rows = table.filter((r) => r.some((c) => c !== ''));
  const headers = (rows.shift() ?? []).map((h, i) => h || `Column ${i + 1}`);
  return { headers, rows: rows.slice(0, 2000).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))) };
}

export async function readSpreadsheet(file: File): Promise<{ headers: string[]; rows: SheetRow[] }> {
  if (/\.(csv|txt)$/i.test(file.name)) return parseCsv((await file.text()).replace(/^﻿/, ''));
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsxFile } = await import('read-excel-file');
    const table = await readXlsxFile(file);
    return toRows(
      table.map((r) =>
        r.map((v) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim())),
      ),
    );
  }
  throw new Error('Please upload a .xlsx or .csv file (old .xls: save as .xlsx first)');
}
