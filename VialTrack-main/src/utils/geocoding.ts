/**
 * Geocoding Utility for SecondMedic VialTrack
 * Supports real-time forward geocoding with intelligent Mumbai locality lookup fallback.
 */

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName?: string;
  source: 'nominatim' | 'locality_lookup' | 'fallback';
}

const MUMBAI_LOCALITY_MAP: { [keyword: string]: [number, number] } = {
  kandivali: [19.2082, 72.8398],
  goregaon: [19.1624, 72.8465],
  andheri: [19.1287852, 72.8294183],
  versova: [19.1360, 72.815],
  malad: [19.186, 72.8485],
  borivali: [19.2307, 72.8567],
  bandra: [19.0596, 72.8295],
  bkc: [19.0657, 72.8688],
  juhu: [19.1075, 72.8263],
  dadar: [19.0178, 72.8478],
  powai: [19.1176, 72.906],
  vile: [19.0968, 72.8415],
  parle: [19.0968, 72.8415],
  santacruz: [19.0843, 72.836],
  khar: [19.07, 72.833],
  kurla: [19.0726, 72.8845],
  ghatkopar: [19.086, 72.908],
  chembur: [19.0522, 72.8994],
  thane: [19.2183, 72.9781],
  mulund: [19.1726, 72.9565],
  colaba: [18.9067, 72.8147],
  worli: [19.0166, 72.8168],
  lower: [19.0016, 72.8302],
  parel: [19.0016, 72.8302],
  dahisar: [19.25, 72.86]
};

/**
 * Geocodes an address or location name to numeric Latitude & Longitude coordinates.
 */
export async function geocodeAddress(
  addressOrName: string,
  hintIndex: number = 0
): Promise<GeocodeResult> {
  const query = (addressOrName || '').trim().toLowerCase();

  if (!query) {
    return {
      lat: 19.1287852 + hintIndex * 0.005,
      lng: 72.8294183 + hintIndex * 0.005,
      source: 'fallback'
    };
  }

  // 1. Check Mumbai Locality Keyword Index
  let matchedCoords: [number, number] | null = null;
  for (const [key, coords] of Object.entries(MUMBAI_LOCALITY_MAP)) {
    if (query.includes(key)) {
      matchedCoords = coords;
      break;
    }
  }

  // 2. Try OpenStreetMap Nominatim Geocoding API with 3s timeout
  try {
    const encoded = encodeURIComponent(`${query}, Mumbai, Maharashtra, India`);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=1`,
      {
        headers: {
          'Accept-Language': 'en'
        },
        signal: AbortSignal.timeout(3000)
      }
    );

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0 && data[0].lat && data[0].lon) {
        const parsedLat = parseFloat(data[0].lat);
        const parsedLng = parseFloat(data[0].lon);
        if (!isNaN(parsedLat) && !isNaN(parsedLng) && parsedLat > 15 && parsedLat < 25) {
          return {
            lat: Number(parsedLat.toFixed(6)),
            lng: Number(parsedLng.toFixed(6)),
            displayName: data[0].display_name,
            source: 'nominatim'
          };
        }
      }
    }
  } catch (e) {
    // Network or timeout failure gracefully handled
  }

  // 3. Fallback to matched locality
  if (matchedCoords) {
    // Add tiny deterministic jitter if multiple stops match the same area
    const jitter = (hintIndex % 5) * 0.002;
    return {
      lat: Number((matchedCoords[0] + jitter).toFixed(6)),
      lng: Number((matchedCoords[1] + jitter).toFixed(6)),
      source: 'locality_lookup'
    };
  }

  // 4. Fallback to Mumbai Center default with index offset
  return {
    lat: Number((19.1287852 + ((hintIndex * 7) % 20) * 0.003).toFixed(6)),
    lng: Number((72.8294183 + ((hintIndex * 11) % 20) * 0.003).toFixed(6)),
    source: 'fallback'
  };
}
