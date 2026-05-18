import 'dotenv/config';
import { openDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { syncAll } from '../lib/sheets.js';

const db = openDb();
migrate(db);
const result = await syncAll(db);
console.log(result);
process.exit(0);
