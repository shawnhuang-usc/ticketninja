import express from 'express';
import ngeohash from 'ngeohash';

const router = express.Router();

const TM_API_KEY = process.env.TM_API_KEY;
if (!TM_API_KEY) {
  console.warn('WARNING: Missing TM_API_KEY in .env');
}

const TM_BASE = 'https://app.ticketmaster.com/discovery/v2';

// category ➜ segmentId map (matches spec)
const SEGMENT_IDS = {
  Music: 'KZFzniwnSyZfZ7v7nJ',
  Sports: 'KZFzniwnSyZfZ7v7nE',
  'Arts & Theatre': 'KZFzniwnSyZfZ7v7na',
  Film: 'KZFzniwnSyZfZ7v7nn',
  Miscellaneous: 'KZFzniwnSyZfZ7v7n1'
};

// ---------- helpers ----------
function normEventRow(e) {
  return {
    id: e.id,
    name: e.name ?? '',
    dateLocal: e?.dates?.start?.localDate ?? '',
    imageUrl: pickImage(e?.images),
    genre: pickGenre(e?.classifications),
    venue: e?._embedded?.venues?.[0]?.name ?? ''
  };
}

function pickImage(images) {
  if (!Array.isArray(images) || images.length === 0) return '';
  // pick a mid-sized square-ish image if possible
  const sorted = [...images].sort((a, b) => Math.abs(a.width - a.height) - Math.abs(b.width - b.height));
  return (sorted[0]?.url) || images[0].url || '';
}

function pickGenre(classifications) {
  if (!Array.isArray(classifications) || classifications.length === 0) return '';
  const c = classifications[0];
  const parts = [c?.segment?.name, c?.genre?.name, c?.subGenre?.name].filter(Boolean);
  return parts.join(' | ');
}

function ticketStatusColor(code) {
  // rubric colors:
  // On sale: Green, Off sale: Red, Canceled: Black, Postponed/Rescheduled: Orange
  const c = (code || '').toLowerCase();
  if (c.includes('onsale')) return 'green';
  if (c.includes('offsale')) return 'red';
  if (c.includes('cancel')) return 'black';
  if (c.includes('postpon')) return 'orange';
  if (c.includes('resched')) return 'orange';
  return 'gray';
}

// ---------- routes ----------

// GET /api/search?keyword=...&distance=...&category=...&lat=..&lng=..
router.get('/search', async (req, res, next) => {
  try {
    const { keyword = '', distance = '10', category = 'Default', lat, lng } = req.query;

    if (!keyword) return res.status(400).json({ error: 'keyword is required' });
    if (!lat || !lng) return res.status(400).json({ error: 'lat and lng are required' });

    const geoPoint = ngeohash.encode(parseFloat(lat), parseFloat(lng), 7);
    const params = new URLSearchParams({
      apikey: TM_API_KEY,
      keyword: String(keyword),
      radius: String(distance || '10'),
      unit: 'miles',
      geoPoint
    });

    const seg = SEGMENT_IDS[category];
    if (seg) params.set('segmentId', seg);

    const url = `${TM_BASE}/events.json?${params.toString()}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`TM search failed: ${r.status}`);
    const j = await r.json();

    const events = (j?._embedded?.events || []).map(normEventRow);
    res.json(events);
  } catch (err) {
    next(err);
  }
});

// GET /api/event/:id  -> detailed info card
router.get('/event/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const url = `${TM_BASE}/events/${encodeURIComponent(id)}.json?apikey=${TM_API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).json({ error: 'event not found' });
    const e = await r.json();

    const details = {
      id: e.id,
      name: e.name ?? '',
      dateLocal: e?.dates?.start?.localDate ?? '',
      timeLocal: e?.dates?.start?.localTime ?? '',
      artists: (e?._embedded?.attractions || []).map(a => ({ name: a.name, url: a.url })).slice(0, 5),
      venue: e?._embedded?.venues?.[0]?.name ?? '',
      address: fullAddress(e?._embedded?.venues?.[0]),
      ticketStatus: e?.dates?.status?.code ?? '',
      ticketStatusColor: ticketStatusColor(e?.dates?.status?.code),
      buyTicketAt: e?.url ?? '',
      seatmap: e?.seatmap?.staticUrl ?? '',
      priceRange: formatPriceRange(e?.priceRanges),
      genre: pickGenre(e?.classifications)
    };

    res.json(details);
  } catch (err) {
    next(err);
  }
});

// GET /api/venue?name=The%20Forum
router.get('/venue', async (req, res, next) => {
  try {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const params = new URLSearchParams({
      apikey: TM_API_KEY,
      keyword: String(name),
      size: '1'
    });
    const url = `${TM_BASE}/venues.json?${params.toString()}`;

    const r = await fetch(url);
    if (!r.ok) throw new Error(`TM venue failed: ${r.status}`);
    const j = await r.json();

    const v = j?._embedded?.venues?.[0];
    if (!v) return res.json(null);

    const out = {
      name: v.name ?? '',
      address: fullAddress(v),
      location: {
        lat: v?.location?.latitude ? Number(v.location.latitude) : null,
        lng: v?.location?.longitude ? Number(v.location.longitude) : null
      },
      googleMapsUrl:
        v?.location?.latitude && v?.location?.longitude
          ? `https://www.google.com/maps/search/?api=1&query=${v.location.latitude},${v.location.longitude}`
          : null,
      tmUrl: v?.url ?? null
    };

    res.json(out);
  } catch (err) {
    next(err);
  }
});

// ---------- small utils ----------
function fullAddress(venue) {
  if (!venue) return '';
  const parts = [
    venue?.name,
    venue?.address?.line1,
    [venue?.city?.name, venue?.state?.stateCode].filter(Boolean).join(', '),
    venue?.postalCode
  ].filter(Boolean);
  return parts.join(', ');
}

function formatPriceRange(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) return '';
  const r = ranges[0];
  const min = r?.min != null ? Number(r.min).toFixed(2) : null;
  const max = r?.max != null ? Number(r.max).toFixed(2) : null;
  if (min && max) return `$${min} ~ $${max}`;
  if (min) return `From $${min}`;
  if (max) return `Up to $${max}`;
  return '';
}

router.get('/suggest', async (req, res, next) => {
  try {
    const { keyword = '' } = req.query;
    if (!keyword.trim()) return res.json([]);

    const url = `${TM_BASE}/suggest?apikey=${TM_API_KEY}&keyword=${encodeURIComponent(keyword)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`TM suggest failed: ${r.status}`);
    const j = await r.json();

    // Parse suggestions (names of attractions/venues/events)
    const suggestions = [];
    if (j._embedded) {
      const { attractions = [], venues = [], events = [] } = j._embedded;
      attractions.forEach(a => suggestions.push(a.name));
      venues.forEach(v => suggestions.push(v.name));
      events.forEach(e => suggestions.push(e.name));
    }

    // Deduplicate + top 10
    const unique = [...new Set(suggestions)].slice(0, 10);
    res.json(unique);
  } catch (err) {
    next(err);
  }
});

export default router;
