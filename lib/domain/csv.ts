// SPEC §13 CSV rules. Every export goes through here (I-13).
// UTF-8 BOM (so Excel shows accents), CRLF, every field quoted, `"` doubled, and a `'` prefix on any
// cell that a spreadsheet would treat as a formula.
export type CsvCell = string | number | boolean | null | undefined;

const FORMULA_START = new Set(['=', '+', '-', '@', '\t', '\r']);

function cell(value: CsvCell): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (s.length > 0 && FORMULA_START.has(s[0] ?? '')) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header, ...rows].map((r) => r.map(cell).join(','));
  return `﻿${lines.map((l) => `${l}\r\n`).join('')}`;
}
