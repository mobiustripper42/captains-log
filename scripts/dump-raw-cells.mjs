import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet } from 'google-spreadsheet';

const key = JSON.parse(await readFile(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'utf8'));
const auth = new JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, auth);
await doc.loadInfo();

const title = process.env.SHEETS_WORKSHEET_TITLE || 'Form Responses 1';
const sheet = doc.sheetsByTitle[title];

console.log('Spreadsheet:', doc.title);
console.log('Worksheet:  ', title);
console.log('rowCount:   ', sheet.rowCount, '(grid size, not data count)');
console.log('columnCount:', sheet.columnCount);
console.log('');

// Load every cell in the first 15 rows × 16 columns, print rows that have ANY content.
await sheet.loadCells('A1:P15');
for (let r = 0; r < 15; r++) {
  const row = [];
  let hasContent = false;
  for (let c = 0; c < 16; c++) {
    const cell = sheet.getCell(r, c);
    const v = cell.value;
    if (v !== null && v !== undefined && String(v).length > 0) hasContent = true;
    row.push(v ?? '');
  }
  if (hasContent) {
    console.log(`row ${r + 1}: ${row.map((v) => String(v).slice(0, 30)).join(' | ')}`);
  }
}

console.log('\nAll tabs in this spreadsheet:');
for (const s of Object.values(doc.sheetsByIndex)) {
  console.log(`  - "${s.title}"  (${s.rowCount} rows × ${s.columnCount} cols)`);
}
