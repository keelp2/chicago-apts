#!/usr/bin/env node
/**
 * fetch-overlay-data.js
 *
 * Run once to generate static overlay JSON files for the apartment search app.
 * Commit the output files to your repo — the app loads them instantly.
 *
 * Usage:
 *   node fetch-overlay-data.js
 *
 * Output:
 *   data/train_lines.json   — CTA rail line GeoJSON features
 *   data/train_stops.json   — CTA rail station records
 *   data/bus.json           — CTA bus stop elements
 *   data/gym.json           — OSM fitness centre elements
 *   data/grocery.json       — OSM supermarket/grocery elements
 *
 * Re-run whenever you want fresh data:
 *   node fetch-overlay-data.js
 *   git add data/ && git commit -m "chore: refresh overlay data"
 *
 * Requirements: Node 18+ (uses built-in fetch)
 */

const fs   = require('fs');
const path = require('path');

const BBOX = '41.64,-87.85,42.05,-87.52'; // Chicago-wide: south,west,north,east

const OVERPASS_QUERIES = {
  gym: `[out:json][timeout:60];(node["leisure"="fitness_centre"](${BBOX});way["leisure"="fitness_centre"](${BBOX});node["leisure"="sports_centre"](${BBOX});way["leisure"="sports_centre"](${BBOX});node["amenity"="gym"](${BBOX});way["amenity"="gym"](${BBOX});relation["leisure"="fitness_centre"](${BBOX}););out center;`,
  grocery: `[out:json][timeout:60];(node["shop"="supermarket"](${BBOX});way["shop"="supermarket"](${BBOX});node["shop"="grocery"](${BBOX});way["shop"="grocery"](${BBOX});node["shop"="convenience"](${BBOX});way["shop"="convenience"](${BBOX});node["shop"="food"](${BBOX});way["shop"="food"](${BBOX});node["shop"="wholesale"](${BBOX});way["shop"="wholesale"](${BBOX});relation["shop"="supermarket"](${BBOX}););out center;`,
  bus: `[out:json][timeout:60];(node["highway"="bus_stop"](${BBOX}););out;`
};

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function fetchOverpass(query) {
  let lastErr;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      console.log(`  Trying ${ep}...`);
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query.trim()),
        signal: AbortSignal.timeout(65000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      console.log(`  ✓ Got ${json.elements?.length ?? 0} elements`);
      return json.elements || [];
    } catch (e) {
      console.warn(`  ✗ ${ep}: ${e.message}`);
      lastErr = e;
    }
  }
  throw lastErr || new Error('All Overpass endpoints failed');
}

async function fetchJSON(url, label) {
  console.log(`  Fetching ${label}...`);
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  console.log(`  ✓ Done`);
  return json;
}

function save(filename, data) {
  const outPath = path.join(__dirname, 'data', filename);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`  Saved → data/${filename} (${kb} KB)`);
}

(async () => {
  const outDir = path.join(__dirname, 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  let allOk = true;

  // Train lines (GeoJSON)
  console.log('\n📍 CTA train lines...');
  try {
    const geo = await fetchJSON('https://data.cityofchicago.org/resource/xbyr-jnvx.geojson?$limit=5000', 'rail lines GeoJSON');
    save('train_lines.json', geo);
  } catch(e) { console.error('  ERROR:', e.message); allOk = false; }

  // Train stops
  console.log('\n🚉 CTA train stops...');
  try {
    const stops = await fetchJSON('https://data.cityofchicago.org/resource/8pix-ypme.json?$limit=2000', 'rail stops');
    save('train_stops.json', stops);
  } catch(e) { console.error('  ERROR:', e.message); allOk = false; }

  // Bus stops — Chicago portal first, Overpass fallback
  console.log('\n🚌 CTA bus stops...');
  try {
    let elements;
    try {
      const raw = await fetchJSON('https://data.cityofchicago.org/resource/qs84-j7wh.json?$limit=15000', 'bus stops (Chicago portal)');
      // Normalise to {lat, lon, tags:{name}} so buildOverlayMarkers works unchanged
      elements = raw.map(s => {
        let lat, lon;
        if (s.location?.latitude)        { lat = parseFloat(s.location.latitude);  lon = parseFloat(s.location.longitude); }
        else if (s.point_y)              { lat = parseFloat(s.point_y);             lon = parseFloat(s.point_x); }
        else if (s.the_geom?.coordinates){ lon = s.the_geom.coordinates[0];        lat = s.the_geom.coordinates[1]; }
        if (!lat || !lon) return null;
        return { lat, lon, tags: { name: s.public_nam || s.cta_stop_name || s.street || '' } };
      }).filter(Boolean);
    } catch(e) {
      console.warn('  Chicago portal failed, trying Overpass:', e.message);
      elements = await fetchOverpass(OVERPASS_QUERIES.bus);
    }
    save('bus.json', elements);
  } catch(e) { console.error('  ERROR:', e.message); allOk = false; }

  // Gyms
  console.log('\n💪 Gyms...');
  try {
    save('gym.json', await fetchOverpass(OVERPASS_QUERIES.gym));
  } catch(e) { console.error('  ERROR:', e.message); allOk = false; }

  // Grocery
  console.log('\n🛒 Grocery stores...');
  try {
    save('grocery.json', await fetchOverpass(OVERPASS_QUERIES.grocery));
  } catch(e) { console.error('  ERROR:', e.message); allOk = false; }

  console.log('\n' + (allOk ? '✓ All done!' : '⚠ Completed with errors — check above.'));
  if (allOk) console.log('\n  git add data/ && git commit -m "chore: refresh overlay data"');
})();