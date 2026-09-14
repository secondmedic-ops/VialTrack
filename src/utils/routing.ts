/**
 * Road-Following Polyline Integration with OSRM (Open Source Routing Machine)
 * for SecondMedic VialTrack Leaflet Mapping
 * 
 * Replaces straight-line connections with authentic road geometries across Mumbai streets.
 */

// In-memory cache for road polylines to prevent redundant network calls
const roadPolylineCache = new Map<string, [number, number][]>();

/**
 * Fetches real road polyline geometry from OSRM driving service.
 * Coordinates input format: Array of Leaflet [latitude, longitude] tuples.
 * Output format: Array of Leaflet [latitude, longitude] tuples along actual streets.
 */
export async function fetchRoadPolyline(
  coordinates: [number, number][]
): Promise<[number, number][]> {
  // Edge cases: < 2 points cannot form a route
  if (!coordinates || coordinates.length < 2) {
    return coordinates || [];
  }

  // Filter and sanitize coordinates to valid numeric lat/lng and eliminate (0,0) or uninitialized coords
  const validCoords = (coordinates || [])
    .filter(
      (c) =>
        Array.isArray(c) &&
        c.length === 2 &&
        typeof c[0] === 'number' &&
        typeof c[1] === 'number' &&
        !isNaN(c[0]) &&
        !isNaN(c[1]) &&
        isFinite(c[0]) &&
        isFinite(c[1]) &&
        !(c[0] === 0 && c[1] === 0) &&
        Math.abs(c[0]) > 0.01 &&
        Math.abs(c[1]) > 0.01
    )
    .map(([lat, lng]) => {
      // Auto-fix inverted coordinates (e.g., GeoJSON [lng, lat] vs Leaflet [lat, lng])
      if (lat > 50 && lng < 40) {
        return [lng, lat] as [number, number];
      }
      return [lat, lng] as [number, number];
    });

  if (validCoords.length < 2) {
    return validCoords;
  }

  // Cache key based on rounded coordinate precision (~5 decimal places)
  const cacheKey = validCoords
    .map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`)
    .join(';');

  if (roadPolylineCache.has(cacheKey)) {
    return roadPolylineCache.get(cacheKey)!;
  }

  try {
    // OSRM expects coordinates in "longitude,latitude" format joined by semicolons
    const formattedCoords = validCoords
      .map(([lat, lng]) => `${lng},${lat}`)
      .join(';');

    const url = `https://router.project-osrm.org/route/v1/driving/${formattedCoords}?overview=full&geometries=geojson`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 second timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[OSRM Routing] HTTP ${response.status} from OSRM server, falling back to direct points`);
      return validCoords;
    }

    const data = await response.json();

    if (
      data &&
      data.code === 'Ok' &&
      Array.isArray(data.routes) &&
      data.routes.length > 0 &&
      data.routes[0]?.geometry?.coordinates &&
      Array.isArray(data.routes[0].geometry.coordinates)
    ) {
      // OSRM GeoJSON geometry coordinates are [lng, lat].
      // Map back to standard Leaflet [lat, lng] tuples:
      const latLngs: [number, number][] = data.routes[0].geometry.coordinates.map(
        ([lng, lat]: [number, number]) => [Number(lat), Number(lng)]
      );

      if (latLngs.length > 0) {
        // Cache result (capped cache size up to 200 routes)
        if (roadPolylineCache.size > 200) {
          const firstKey = roadPolylineCache.keys().next().value;
          if (firstKey) roadPolylineCache.delete(firstKey);
        }
        roadPolylineCache.set(cacheKey, latLngs);
        return latLngs;
      }
    }

    return validCoords;
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      console.warn('[OSRM Routing] Routing fetch error (using fallback direct coordinates):', err?.message || err);
    }
    return validCoords;
  }
}

/**
 * Helper to fetch a road segment between two points
 */
export async function fetchRoadSegment(
  start: [number, number],
  end: [number, number]
): Promise<[number, number][]> {
  return fetchRoadPolyline([start, end]);
}

export default fetchRoadPolyline;
