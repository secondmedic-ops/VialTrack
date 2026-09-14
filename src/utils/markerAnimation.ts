import L from 'leaflet';

interface ActiveAnimation {
  marker: L.Marker;
  startLat: number;
  startLng: number;
  targetLat: number;
  targetLng: number;
  startTime: number;
  duration: number;
  rafId: number;
}

// Track running animations per marker instance or ID
const activeAnimations = new Map<L.Marker | string, ActiveAnimation>();

/**
 * Smoothly interpolates a Leaflet marker's position over a specified duration (default: 10,000ms / 10s)
 * using requestAnimationFrame.
 */
export function animateMarkerPosition(
  marker: L.Marker,
  targetLat: number,
  targetLng: number,
  durationMs: number = 10000,
  key?: string
): void {
  if (!marker) return;

  const animKey = key || marker;
  const currentLatLng = marker.getLatLng();
  const startLat = currentLatLng.lat;
  const startLng = currentLatLng.lng;

  // If already at or very close to target (< 0.00001 deg ~ 1m), update directly
  const latDiff = Math.abs(targetLat - startLat);
  const lngDiff = Math.abs(targetLng - startLng);
  if (latDiff < 0.00001 && lngDiff < 0.00001) {
    marker.setLatLng([targetLat, targetLng]);
    return;
  }

  // Cancel any existing animation on this marker
  if (activeAnimations.has(animKey)) {
    const existing = activeAnimations.get(animKey)!;
    cancelAnimationFrame(existing.rafId);
    activeAnimations.delete(animKey);
  }

  const startTime = performance.now();

  function step(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);

    // Smooth linear interpolation for consistent GPS tracking speed
    const currentLat = startLat + (targetLat - startLat) * progress;
    const currentLng = startLng + (targetLng - startLng) * progress;

    marker.setLatLng([currentLat, currentLng]);

    if (progress < 1) {
      const rafId = requestAnimationFrame(step);
      activeAnimations.set(animKey, {
        marker,
        startLat,
        startLng,
        targetLat,
        targetLng,
        startTime,
        duration: durationMs,
        rafId
      });
    } else {
      marker.setLatLng([targetLat, targetLng]);
      activeAnimations.delete(animKey);
    }
  }

  const rafId = requestAnimationFrame(step);
  activeAnimations.set(animKey, {
    marker,
    startLat,
    startLng,
    targetLat,
    targetLng,
    startTime,
    duration: durationMs,
    rafId
  });
}

/**
 * Cancel and remove any active animation for a marker
 */
export function cancelMarkerAnimation(markerOrKey: L.Marker | string): void {
  if (activeAnimations.has(markerOrKey)) {
    const existing = activeAnimations.get(markerOrKey)!;
    cancelAnimationFrame(existing.rafId);
    activeAnimations.delete(markerOrKey);
  }
}
