/** Minimal RFC 4180 CSV reading and writing for annotation spreadsheets. */
export function toCsv(rows: Record<string, string>[]): string {
  const first = rows[0];
  if (!first) return "";
  const headers = Object.keys(first);
  const escape = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  // A BOM lets spreadsheet tools open UTF-8 text (Greek letters, minus signs) correctly.
  return `﻿${[headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header] ?? "")).join(","))].join("\r\n")}\r\n`;
}

export function parseCsv(text: string): Record<string, string>[] {
  const input = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const [headers, ...rows] = records.filter((row) => row.some((cell) => cell.length > 0));
  if (!headers) return [];
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}
