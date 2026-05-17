import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatWeather,
  conditionFor,
  compass,
  latLonFor,
  getWeatherSummary,
  _resetCacheForTests as resetWeatherCache,
} from '../lib/weather.js';
import { _resetCacheForTests as resetRosters } from '../lib/rosters.js';

function reset() {
  resetWeatherCache();
  resetRosters();
}

// --- conditionFor ---

test('conditionFor maps WMO codes to short labels', () => {
  assert.equal(conditionFor(0), 'Sunny');
  assert.equal(conditionFor(1), 'Mostly sunny');
  assert.equal(conditionFor(2), 'Partly cloudy');
  assert.equal(conditionFor(3), 'Cloudy');
  assert.equal(conditionFor(45), 'Foggy');
  assert.equal(conditionFor(63), 'Rain');
  assert.equal(conditionFor(95), 'Thunderstorms');
  assert.match(conditionFor(999), /Weather code 999/);
});

// --- compass ---

test('compass converts degrees to 8-point cardinal', () => {
  assert.equal(compass(0), 'N');
  assert.equal(compass(45), 'NE');
  assert.equal(compass(90), 'E');
  assert.equal(compass(180), 'S');
  assert.equal(compass(225), 'SW');
  assert.equal(compass(270), 'W');
  assert.equal(compass(359), 'N');
  assert.equal(compass(-45), 'NW');
});

test('compass returns empty string for null / NaN', () => {
  assert.equal(compass(null), '');
  assert.equal(compass(undefined), '');
  assert.equal(compass(NaN), '');
});

// --- formatWeather ---

test('formatWeather happy path', () => {
  const s = formatWeather({
    temperature: 67.6,
    weather_code: 2,
    wind_speed: 8.3,
    wind_direction: 225,
    precipitation: 0,
  });
  assert.equal(s, '68°F, Partly cloudy, wind 8mph SW, no precip');
});

test('formatWeather shows inches when precipitation > 0', () => {
  const s = formatWeather({
    temperature: 58,
    weather_code: 63,
    wind_speed: 12,
    wind_direction: 90,
    precipitation: 0.12,
  });
  assert.ok(s.includes('0.12" precip'));
});

test('formatWeather degrades gracefully when wind direction missing', () => {
  const s = formatWeather({
    temperature: 70,
    weather_code: 0,
    wind_speed: 5,
    wind_direction: null,
    precipitation: 0,
  });
  assert.ok(s.includes('wind 5mph'));
  assert.ok(!s.includes('wind 5mph N'));
});

// --- latLonFor ---

test('latLonFor uses route coords when available', async () => {
  reset();
  const c = await latLonFor({ routeSlug: 'cuyahoga', boatSlug: 'brewboat' });
  assert.equal(c.source, 'route');
  assert.equal(c.lat, 41.4993);
});

test('latLonFor falls back to boat home when route is unknown', async () => {
  reset();
  const c = await latLonFor({ routeSlug: null, boatSlug: 'brewboat' });
  assert.equal(c.source, 'boat');
  assert.equal(c.lat, 41.4993);
});

test('latLonFor returns null when nothing resolves', async () => {
  reset();
  const c = await latLonFor({ routeSlug: 'mystery', boatSlug: 'ghost' });
  assert.equal(c, null);
});

// --- getWeatherSummary ---

function fakeFetcher(responses) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const r = responses.shift();
    if (!r) throw new Error('fakeFetcher: out of responses');
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
    };
  };
  fetcher.calls = calls;
  return fetcher;
}

const sampleCurrent = {
  current: {
    temperature_2m: 71.4,
    weather_code: 1,
    wind_speed_10m: 6.2,
    wind_direction_10m: 180,
    precipitation: 0,
  },
};

test('getWeatherSummary returns a formatted string from a fake fetch', async () => {
  reset();
  const f = fakeFetcher([{ body: sampleCurrent }]);
  const s = await getWeatherSummary({
    routeSlug: 'cuyahoga',
    boatSlug: 'brewboat',
    _fetch: f,
    _date: () => '2026-05-17',
  });
  assert.equal(s, '71°F, Mostly sunny, wind 6mph S, no precip');
  assert.equal(f.calls.length, 1);
});

test('getWeatherSummary caches same-day lookups (one fetch for two calls)', async () => {
  reset();
  const f = fakeFetcher([{ body: sampleCurrent }]);
  const a = await getWeatherSummary({
    routeSlug: 'cuyahoga',
    boatSlug: 'brewboat',
    _fetch: f,
    _date: () => '2026-05-17',
  });
  const b = await getWeatherSummary({
    routeSlug: 'cuyahoga',
    boatSlug: 'brewboat',
    _fetch: f,
    _date: () => '2026-05-17',
  });
  assert.equal(a, b);
  assert.equal(f.calls.length, 1, 'cache hit, only one HTTP call');
});

test('getWeatherSummary re-fetches when the date rolls over', async () => {
  reset();
  const f = fakeFetcher([{ body: sampleCurrent }, { body: sampleCurrent }]);
  await getWeatherSummary({
    routeSlug: 'cuyahoga',
    boatSlug: 'brewboat',
    _fetch: f,
    _date: () => '2026-05-17',
  });
  await getWeatherSummary({
    routeSlug: 'cuyahoga',
    boatSlug: 'brewboat',
    _fetch: f,
    _date: () => '2026-05-18',
  });
  assert.equal(f.calls.length, 2);
});

test('getWeatherSummary returns null on HTTP error (does not throw)', async () => {
  reset();
  const f = fakeFetcher([{ ok: false, status: 503, body: {} }]);
  const silenceErr = console.error;
  console.error = () => {};
  try {
    const s = await getWeatherSummary({
      routeSlug: 'cuyahoga',
      boatSlug: 'brewboat',
      _fetch: f,
      _date: () => '2026-05-17',
    });
    assert.equal(s, null);
  } finally {
    console.error = silenceErr;
  }
});

test('getWeatherSummary returns null when no coords resolve', async () => {
  reset();
  const f = fakeFetcher([]);
  const s = await getWeatherSummary({
    routeSlug: 'mystery',
    boatSlug: 'ghost',
    _fetch: f,
    _date: () => '2026-05-17',
  });
  assert.equal(s, null);
  assert.equal(f.calls.length, 0, 'no HTTP call when coords unknown');
});
