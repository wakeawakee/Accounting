import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import type { Types } from 'mongoose';
import { CLIENT_IMPORT_FIELDS, clientInputSchema, type ClientImportField, type ClientInput } from '@karsathi/shared';
import { HttpError } from '../lib/errors';
import { Client } from '../models';

export const MAX_IMPORT_ROWS = 2000;

export type RawRow = Record<string, string>;

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellToString(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    if ('hyperlink' in v) return String((v as { text?: string }).text ?? '');
    return '';
  }
  return String(v).trim();
}

/** Parses an uploaded CSV or XLSX into headers + rows of strings. */
export async function parseSpreadsheet(buf: Buffer, filename: string): Promise<{ headers: string[]; rows: RawRow[] }> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = buf.toString('utf8').replace(/^﻿/, '');
    const r = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
    const headers = (r.meta.fields ?? []).filter(Boolean);
    return { headers, rows: r.data.slice(0, MAX_IMPORT_ROWS + 1) };
  }
  if (lower.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new HttpError(400, 'The workbook has no sheets');
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = cellToString(cell.value) || `Column ${col}`;
    });
    const rows: RawRow[] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1 || rows.length > MAX_IMPORT_ROWS) return;
      const obj: RawRow = {};
      headers.forEach((h, i) => (obj[h] = cellToString(row.getCell(i + 1).value)));
      if (Object.values(obj).some((v) => v !== '')) rows.push(obj);
    });
    return { headers, rows };
  }
  throw new HttpError(400, 'Please upload a .xlsx or .csv file (old .xls: save as .xlsx first)');
}

export interface RowReport {
  row: number; // spreadsheet row number (header = 1)
  status: 'valid' | 'error' | 'duplicate';
  errors: { field: string; message: string }[];
  warnings: string[];
  data?: ClientInput;
}

export async function validateImport(
  firmId: Types.ObjectId,
  rows: RawRow[],
  mapping: Partial<Record<ClientImportField, string>>,
): Promise<RowReport[]> {
  if (rows.length > MAX_IMPORT_ROWS) throw new HttpError(400, `Too many rows (max ${MAX_IMPORT_ROWS})`);
  const existing = await Client.find({ firmId }, { pan: 1, phone: 1 }).lean();
  const existingPans = new Set(existing.map((c) => c.pan));
  const existingPhones = new Set(existing.map((c) => c.phone));
  const seenPans = new Map<string, number>();

  return rows.map((raw, i) => {
    const rowNum = i + 2;
    const input: Record<string, unknown> = {};
    for (const f of CLIENT_IMPORT_FIELDS) {
      const col = mapping[f];
      if (col) input[f] = raw[col] ?? '';
    }
    const r = clientInputSchema.safeParse(input);
    if (!r.success) {
      const fe = r.error.flatten().fieldErrors;
      return {
        row: rowNum,
        status: 'error',
        errors: Object.entries(fe).map(([field, msgs]) => ({ field, message: (msgs ?? []).join(', ') })),
        warnings: [],
      };
    }
    const warnings: string[] = [];
    if (existingPhones.has(r.data.phone)) warnings.push('Phone already used by another client');
    if (existingPans.has(r.data.pan)) {
      return { row: rowNum, status: 'duplicate', errors: [{ field: 'pan', message: 'A client with this PAN already exists' }], warnings, data: r.data };
    }
    const dupRow = seenPans.get(r.data.pan);
    if (dupRow) {
      return { row: rowNum, status: 'duplicate', errors: [{ field: 'pan', message: `Same PAN as row ${dupRow}` }], warnings, data: r.data };
    }
    seenPans.set(r.data.pan, rowNum);
    return { row: rowNum, status: 'valid', errors: [], warnings, data: r.data };
  });
}
