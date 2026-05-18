import { load as loadRosters } from './rosters.js';

const cache = new Map();

function etDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function cacheKey(date, lat, lon) {
  return `${date}:${lat.toFixed(4)},${lon.toFixed(4)}`;
}

// WMO weather code → short label. Keeps the digest readable.
export function conditionFor(code) {
  if (code === 0) return 'Sunny';
  if (code === 1) return 'Mostly sunny';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if (code === 45 || code === 48) return 'Foggy';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorms';
  if (code === 96 || code === 99) return 'Thunderstorms w/ hail';
  return `Weather code ${code}`;
}

export function compass(deg) {
  if (deg == null || Number.isNaN(deg)) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

export function formatWeather({ temperature, weather_code, wind_speed, wind_direction, precipitation }) {
  const parts = [];
  if (typeof temperature === 'number') parts.push(`${Math.round(temperature)}°F`);
  parts.push(conditionFor(weather_code));
  if (typeof wind_speed === 'number') {
    const dir = compass(wind_direction);
    parts.push(`wind ${Math.round(wind_speed)}mph${dir ? ` ${dir}` : ''}`);
  }
  if (typeof precipitation === 'number' && precipitation > 0) {
    parts.push(`${precipitation.toFixed(2)}" precip`);
  } else {
    parts.push('no precip');
  }
  return parts.join(', ');
}

async function fetchOpenMeteo(lat, lon, fetcher) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`open-meteo HTTP ${res.status}`);
  const json = await res.json();
  if (!json.current) throw new Error('open-meteo missing current block');
  return {
    temperature: json.current.temperature_2m,
    weather_code: json.current.weather_code,
    wind_speed: json.current.wind_speed_10m,
    wind_direction: json.current.wind_direction_10m,
    precipitation: json.current.precipitation ?? 0,
  };
}

export async function latLonFor({ routeSlug, boatSlug }) {
  const { routes, boats } = await loadRosters();
  const route = routeSlug ? routes[routeSlug] : null;
  if (route?.lat != null && route?.lon != null) {
    return { lat: route.lat, lon: route.lon, source: 'route' };
  }
  const boat = boatSlug ? boats[boatSlug] : null;
  if (boat?.home_lat != null && boat?.home_lon != null) {
    return { lat: boat.home_lat, lon: boat.home_lon, source: 'boat' };
  }
  return null;
}

export async function getWeatherSummary({
  routeSlug,
  boatSlug,
  _fetch = fetch,
  _date = etDate,
} = {}) {
  if (process.env.CAPTAINSLOG_NO_WEATHER === '1') return null;
  const coords = await latLonFor({ routeSlug, boatSlug });
  if (!coords) return null;
  const date = _date();
  const key = cacheKey(date, coords.lat, coords.lon);
  if (cache.has(key)) return cache.get(key);
  try {
    const raw = await fetchOpenMeteo(coords.lat, coords.lon, _fetch);
    const summary = formatWeather(raw);
    cache.set(key, summary);
    return summary;
  } catch (err) {
    console.error('[weather] fetch failed:', err.message);
    return null;
  }
}

export function _resetCacheForTests() {
  cache.clear();
}
