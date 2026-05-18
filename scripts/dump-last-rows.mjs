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
if (!sheet) {
  console.error(`Worksheet "${title}" not found. Available:`, Object.keys(doc.sheetsByTitle));
  process.exit(1);
}

console.log('Spreadsheet:', doc.title);
console.log('Worksheet:  ', title);
console.log('rowCount (with header):', sheet.rowCount);

await sheet.loadHeaderRow();
const rows = await sheet.getRows();
console.log('data rows:', rows.length);
console.log('--- last 3 rows ---');
for (const r of rows.slice(-3)) {
  console.log(r.toObject());
}
