// Turning a downloaded file into { headers, rows } without any dependencies.
// The CSV parser is RFC4180-ish: quoted fields, embedded delimiters/newlines,
// doubled quotes, and CRLF all handled.

const DELIMITERS = [',', ';', '\t', '|'];

/** Count delimiter candidates outside quotes on the first real line. */
function sniffDelimiter(text) {
  const sample = text.slice(0, 64 * 1024);
  let best = ',';
  let bestCount = 0;
  for (const delim of DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < sample.length; i += 1) {
      const ch = sample[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === '\n' && !inQuotes) break;
      else if (ch === delim && !inQuotes) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      best = delim;
    }
  }
  return best;
}

export function parseCsv(text, { maxRows = Infinity } = {}) {
  // Strip a UTF-8 BOM, which otherwise corrupts the first header name.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delimiter = sniffDelimiter(text);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let truncated = false;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // Skip blank trailing lines.
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    if (rows.length > maxRows) truncated = true;
  };

  for (let i = 0; i < text.length && !truncated; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === '') inQuotes = true;
    else if (ch === delimiter) endField();
    else if (ch === '\r') continue;
    else if (ch === '\n') endRow();
    else field += ch;
  }
  if (field !== '' || row.length) endRow();

  const headers = (rows.shift() ?? []).map((h, i) => h.trim() || `column_${i + 1}`);
  return { headers, rows: rows.slice(0, maxRows), delimiter, truncated };
}

/** Accept the usual shapes: bare array, {data:[]}, {results:[]}, {features:[]} (GeoJSON). */
export function parseJsonTable(text, { maxRows = Infinity } = {}) {
  const parsed = JSON.parse(text);
  let records = null;

  if (Array.isArray(parsed)) records = parsed;
  else if (Array.isArray(parsed?.data)) records = parsed.data;
  else if (Array.isArray(parsed?.results)) records = parsed.results;
  else if (Array.isArray(parsed?.records)) records = parsed.records;
  else if (Array.isArray(parsed?.features)) records = parsed.features.map((f) => ({ ...f.properties }));

  if (!records || !records.length) throw new Error('JSON did not contain an array of records');
  if (typeof records[0] !== 'object' || records[0] === null) throw new Error('JSON array does not hold objects');

  // Union of keys across a sample, so sparse records do not lose columns.
  const headerSet = new Set();
  for (const record of records.slice(0, 500)) {
    for (const key of Object.keys(record)) headerSet.add(key);
  }
  const headers = [...headerSet];

  const flatten = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  const limited = records.slice(0, maxRows);
  return {
    headers,
    rows: limited.map((record) => headers.map((h) => flatten(record[h]))),
    delimiter: null,
    truncated: records.length > limited.length,
  };
}

export function loadTable(text, format, opts) {
  const fmt = String(format || '').toUpperCase();
  if (fmt === 'JSON' || fmt === 'GEOJSON') return parseJsonTable(text, opts);
  return parseCsv(text, opts);
}
