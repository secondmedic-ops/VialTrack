/**
 * Marker Overlap & Collision Resolver for Leaflet Mapping (Spiderfication & Radial Jitter)
 * 
 * Automatically detects overlapping GPS coordinates (e.g. riders initialized at the same depot/lab or clustered stops)
 * and distributes them in a clean radial spider/spiral offset pattern so every marker is individually visible and clickable.
 */

export interface OffsetMarkerPoint<T> {
  id: string;
  lat: number;
  lng: number;
  data: T;
  isOffset: boolean;
  originalLat: number;
  originalLng: number;
}

/**
 * Groups coordinates by spatial proximity threshold and applies a radial spiderfy offset
 * to any overlapping markers.
 * 
 * @param items List of objects containing coordinate properties
 * @param getCoords Accessor function to get lat & lng from an item
 * @param proximityThresholdDeg Distance threshold in degrees (~0.0003 deg is ~30 meters)
 * @param spiralRadiusScale Base radius of the spiderfy offset ring in degrees (~0.00045 deg ~ 50 meters)
 */
export function resolveMarkerOverlaps<T>(
  items: T[],
  getCoords: (item: T, index: number) => { lat: number; lng: number; id: string } | null,
  proximityThresholdDeg: number = 0.00035,
  spiralRadiusScale: number = 0.00048
): OffsetMarkerPoint<T>[] {
  const validItems: { id: string; lat: number; lng: number; data: T }[] = [];

  items.forEach((item, index) => {
    const coords = getCoords(item, index);
    if (!coords) return;
    if (typeof coords.lat !== 'number' || typeof coords.lng !== 'number' || isNaN(coords.lat) || isNaN(coords.lng)) return;
    validItems.push({
      id: coords.id,
      lat: coords.lat,
      lng: coords.lng,
      data: item
    });
  });

  if (validItems.length === 0) return [];

  // Group items that are clustered within proximityThresholdDeg
  const clusters: { centerLat: number; centerLng: number; members: typeof validItems }[] = [];

  validItems.forEach((item) => {
    let matchedCluster = clusters.find((cluster) => {
      const dLat = Math.abs(cluster.centerLat - item.lat);
      const dLng = Math.abs(cluster.centerLng - item.lng);
      return dLat < proximityThresholdDeg && dLng < proximityThresholdDeg;
    });

    if (matchedCluster) {
      matchedCluster.members.push(item);
    } else {
      clusters.push({
        centerLat: item.lat,
        centerLng: item.lng,
        members: [item]
      });
    }
  });

  const result: OffsetMarkerPoint<T>[] = [];

  clusters.forEach((cluster) => {
    const count = cluster.members.length;

    if (count === 1) {
      const single = cluster.members[0];
      result.push({
        id: single.id,
        lat: single.lat,
        lng: single.lng,
        data: single.data,
        isOffset: false,
        originalLat: single.lat,
        originalLng: single.lng
      });
      return;
    }

    // For multiple overlapping markers at the same spot: distribute in an equal radial circle/spiral
    const angleStep = (2 * Math.PI) / count;
    // Adjust aspect ratio for longitude scaling in Mumbai (~ latitude 19° -> cos(19°) ≈ 0.945)
    const lngAspect = 1 / Math.cos((cluster.centerLat * Math.PI) / 180);

    cluster.members.forEach((member, index) => {
      // Small radial spiderfy distribution
      const angle = index * angleStep + (Math.PI / 6); // slightly rotated offset
      const radius = spiralRadiusScale * (1 + 0.15 * Math.floor(index / 8)); // expand radius if > 8 items

      const offsetLat = cluster.centerLat + radius * Math.sin(angle);
      const offsetLng = cluster.centerLng + (radius * lngAspect) * Math.cos(angle);

      result.push({
        id: member.id,
        lat: offsetLat,
        lng: offsetLng,
        data: member.data,
        isOffset: true,
        originalLat: cluster.centerLat,
        originalLng: cluster.centerLng
      });
    });
  });

  return result;
}
