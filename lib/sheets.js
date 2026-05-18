import { readFile } from 'node:fs/promises';
import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import * as trips from './trips.js';
import { load as loadRosters } from './rosters.js';

let sheetCache = null;

async function getSheet() {
  if (sheetCache) return sheetCache;

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const worksheetTitle =
    process.env.SHEETS_WORKSHEET_TITLE ?? process.env.GOOGLE_SHEET_TAB ?? 'Form Responses 1';

  if (!keyPath || !sheetId) {
    throw new Error(
      'sheets: GOOGLE_SERVICE_ACCOUNT_KEY and GOOGLE_SHEET_ID must be set',
    );
  }

  const keyJson = JSON.parse(await readFile(keyPath, 'utf8'));
  const auth = new JWT({
    email: keyJson.client_email,
    key: keyJson.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const doc = new GoogleSpreadsheet(sheetId, auth);
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[worksheetTitle];
  if (!sheet) {
    throw new Error(
      `sheets: worksheet "${worksheetTitle}" not found in sheet ${sheetId}`,
    );
  }
  await sheet.loadHeaderRow();
  sheetCache = { doc, sheet, worksheetTitle };
  return sheetCache;
}

export function _resetCacheForTests() {
  sheetCache = null;
}

// Translates a trips row into the Brewboat Google Form schema. The Form
// header names are the column keys — google-spreadsheet writes by header,
// so column order in the Sheet can change without breaking sync.
export async function formatRow(trip) {
  const { boats, routes } = await loadRosters();
  const boat = boats[trip.boat_slug];
  const route = trip.route_slug ? routes[trip.route_slug] : null;

  const parseJson = trip.parse_json ? JSON.parse(trip.parse_json) : {};
  const parsed = parseJson.parsed ?? {};
  const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
  const emergencyDrills = parsed.emergency_drills === true;

  const notesParts = [];
  if (trip.notes) notesParts.push(trip.notes);
  for (const issue of issues) notesParts.push(`Issue: ${issue}`);
  const notesCombined = notesParts.join('\n');

  return {
    Timestamp: trip.confirmed_at ?? trip.created_at,
    Date: trip.trip_date,
    'Departure Time': trip.start_time ?? '',
    Equipment: boat?.official_name ?? trip.boat_slug,
    'Trip Duration (hr:mm)': '',
    'Engine Hours Start': '',
    'Engine Hours End': '',
    Captain: trip.captain_name,
    'First Mate': trip.first_mate_text ?? '',
    'Emergency Drills (monthly checkbox)': emergencyDrills ? 'Yes' : '',
    'Number of Passengers': trip.passenger_count ?? '',
    'Weather Forecast/Actual': trip.weather_summary ?? '',
    'Destinations/Stops': route?.official_name ?? '',
    'Vessel Concerns and Captain Notes': notesCombined,
  };
}

// Loop kept separate from sheet acquisition so tests can pass a fake
// addRow-having sheet without standing up a real GoogleSpreadsheet.
export async function syncToSheet(db, sheet, { logger = console } = {}) {
  const pending = trips.findUnsynced(db);
  if (pending.length === 0) {
    return { synced: 0, failed: 0, pending: 0 };
  }

  let synced = 0;
  let failed = 0;
  for (const trip of pending) {
    try {
      const row = await formatRow(trip);
      // { insert: true } → INSERT_ROWS. Default OVERWRITE was overwriting
      // row 2 each tick because the Sheets append-API table detector wasn't
      // recognizing previously-synced rows as part of the table on this
      // sheet (some columns came back empty due to header-name mismatches,
      // which may be what's confusing the detector).
      await sheet.addRow(row, { insert: true });
      trips.markSynced(db, trip.id);
      synced++;
      logger.log(`[sheets] synced trip ${trip.id}`);
    } catch (err) {
      failed++;
      logger.error(`[sheets] failed to sync trip ${trip.id}:`, err.message);
    }
  }
  return { synced, failed, pending: pending.length };
}

export async function syncAll(db, opts = {}) {
  const pending = trips.findUnsynced(db);
  if (pending.length === 0) {
    return { synced: 0, failed: 0, pending: 0 };
  }
  const { sheet } = await getSheet();
  return syncToSheet(db, sheet, opts);
}
