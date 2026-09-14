/**
 * Coordinate Normalization & Validation Utility for SecondMedic VialTrack Leaflet Mapping
 * 
 * Strict Requirement:
 * - Coordinates MUST follow Leaflet's [latitude, longitude] order.
 * - Latitude (Mumbai Region): ~19.0 to 19.3 (e.g., 19.1287852)
 * - Longitude (Mumbai Region): ~72.7 to 73.1 (e.g., 72.8294183)
 * - Prevents inverted arrays like [lng, lat] or GeoJSON [x, y] format in Leaflet marker rendering.
 */

export interface LatLng {
  lat: number | string;
  lng: number | string;
}

export const DEFAULT_MUMBAI_COORDINATES: { [key: string]: [number, number] } = {
  LIFECARE_ANDHERI_WEST: [19.1287852, 72.8294183],
  OSCAR_HOSPITAL_KANDIVALI: [19.2082, 72.8398],
  OSCAR_HOSPITAL_GOREGAON: [19.1624, 72.8465],
  KOKILABEN_ANDHERI: [19.1310, 72.8252],
  APEX_MALAD: [19.1860, 72.8485],
  LILAVATI_BANDRA: [19.0514, 72.8295],
  ASIAN_HEART_BKC: [19.0657, 72.8688]
};

/**
 * Normalizes any latitude and longitude values to strictly ensure:
 * 1. Values are valid finite numbers.
 * 2. Inverted coordinates ([lng, lat] GeoJSON convention) are automatically corrected.
 * 3. Returns standard Leaflet [lat, lng] tuple.
 */
export function normalizeLatLng(
  lat: number | string | undefined | null,
  lng: number | string | undefined | null,
  fallbackLat: number = 19.1287852,
  fallbackLng: number = 72.8294183
): [number, number] {
  let numLat = Number(lat);
  let numLng = Number(lng);

  if (isNaN(numLat) || isNaN(numLng) || (numLat === 0 && numLng === 0)) {
    return [fallbackLat, fallbackLng];
  }

  // Detect inverted coordinate order: In Mumbai, Longitude is ~72.8° while Latitude is ~19.1°.
  // If latitude > 50 and longitude < 40, they are inverted (GeoJSON [x, y] / [lng, lat]).
  if (numLat > 50 && numLng < 40) {
    const temp = numLat;
    numLat = numLng;
    numLng = temp;
  }

  return [numLat, numLng];
}

/**
 * Builds a strict Leaflet polyline path array from an ordered list of stops
 * and appends the final destination client laboratory coordinate.
 */
export function buildRoutePolylinePath(
  stops: Array<{ lat: number | string; lng: number | string }>,
  destinationClient?: { lat: number | string; lng: number | string } | null
): [number, number][] {
  // 1. Map stops strictly as [Number(s.lat), Number(s.lng)] with validation
  const polylinePath: [number, number][] = stops.map((s) => {
    const [validLat, validLng] = normalizeLatLng(s.lat, s.lng, 19.1624, 72.8465);
    return [Number(validLat), Number(validLng)];
  });

  // 2. Push final destination lab / client coordinate: [Number(client.lat), Number(client.lng)]
  if (destinationClient) {
    const [destLat, destLng] = normalizeLatLng(
      destinationClient.lat,
      destinationClient.lng,
      19.1287852,
      72.8294183
    );
    const destinationPos: [number, number] = [Number(destLat), Number(destLng)];
    polylinePath.push(destinationPos);
  }

  return polylinePath;
}

/**
 * Calculates direct great-circle distance between two GPS coordinates using the Haversine formula (km)
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (lat1 === 0 && lon1 === 0) return 0;
  if (lat2 === 0 && lon2 === 0) return 0;

  const R = 6371; // Earth's mean radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return Number(distance.toFixed(2));
}

/**
 * Calculates estimated travel arrival duration in minutes based on distance and average Mumbai city traffic speed
 */
export function calculateEstimatedEtaMinutes(
  distanceKm: number,
  avgSpeedKmh: number = 22,
  trafficBufferMinutes: number = 2
): number {
  if (distanceKm <= 0.05) return 1;
  const travelMinutes = (distanceKm / avgSpeedKmh) * 60;
  return Math.max(1, Math.round(travelMinutes + trafficBufferMinutes));
}

