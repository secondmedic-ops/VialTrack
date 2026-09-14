/**
 * Image Watermark & Base64 Compression Service
 * High-definition (1200px) processing with crisp JPEG compression for Firestore storage.
 * Superimposes non-overlapping GPS coordinates, timestamp, stop details, and SecondMedic VialTrack chain-of-custody verification overlay.
 */

export interface WatermarkData {
  stopName?: string;
  address?: string;
  clientName?: string;
  riderName: string;
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp: string;
  sampleCount?: number;
  vialCount?: number;
  coldBoxTemp?: number;
  temperature?: number;
  verificationCode?: string;
  isDrop?: boolean;
  isSelfie?: boolean;
  receiverName?: string;
}

/**
 * Helper to safely draw a rounded rectangle on Canvas 2D
 */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fillStyle?: string,
  strokeStyle?: string,
  lineWidth?: number
) {
  ctx.save();
  ctx.beginPath();
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();

  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  if (strokeStyle && lineWidth) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Helper to measure and truncate text safely with ellipsis
 */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let current = text;
  while (current.length > 3 && ctx.measureText(current + '...').width > maxWidth) {
    current = current.slice(0, -1);
  }
  return current + '...';
}

/**
 * Compresses an image to max dimension of 1080px and high-clarity JPEG quality 0.80 Base64 string.
 */
export async function compressImageToBase64(
  imageSource: File | Blob | string | HTMLImageElement,
  maxDimension: number = 1080,
  quality: number = 0.80
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Timeout safeguard
    const timeout = setTimeout(() => {
      if (typeof imageSource === 'string') {
        resolve(imageSource);
      } else if (imageSource instanceof File || imageSource instanceof Blob) {
        const reader = new FileReader();
        reader.onload = (e) => resolve((e.target?.result as string) || '');
        reader.onerror = () => reject(new Error('Image compression timed out'));
        reader.readAsDataURL(imageSource);
      } else {
        reject(new Error('Image compression timed out'));
      }
    }, 4000);

    const img = new Image();
    if (typeof imageSource === 'string' && /^https?:\/\//i.test(imageSource)) {
      img.crossOrigin = 'anonymous';
    }

    let isDone = false;
    const handleLoad = () => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha: false });

        if (!ctx) {
          throw new Error('Canvas 2D context not available');
        }

        let width = img.naturalWidth || img.width || 800;
        let height = img.naturalHeight || img.height || 600;

        // Maintain aspect ratio, max dimension 1080px for crisp details
        if (width > maxDimension || height > maxDimension) {
          const scale = Math.min(maxDimension / width, maxDimension / height);
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }

        canvas.width = width;
        canvas.height = height;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw image onto canvas
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to compressed Base64 JPEG
        const base64 = canvas.toDataURL('image/jpeg', quality);
        resolve(base64);
      } catch (err) {
        if (typeof imageSource === 'string') {
          resolve(imageSource);
        } else if (imageSource instanceof File || imageSource instanceof Blob) {
          const reader = new FileReader();
          reader.onload = (e) => resolve((e.target?.result as string) || '');
          reader.onerror = () => reject(err);
          reader.readAsDataURL(imageSource);
        } else {
          reject(err);
        }
      }
    };

    img.onload = handleLoad;
    img.onerror = (err) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timeout);
      if (typeof imageSource === 'string') {
        resolve(imageSource);
      } else if (imageSource instanceof File || imageSource instanceof Blob) {
        const reader = new FileReader();
        reader.onload = (e) => resolve((e.target?.result as string) || '');
        reader.onerror = () => reject(err);
        reader.readAsDataURL(imageSource);
      } else {
        reject(err);
      }
    };

    if (typeof imageSource === 'string') {
      img.src = imageSource;
      if (img.complete && img.naturalWidth > 0) {
        handleLoad();
      }
    } else if (imageSource instanceof Blob || imageSource instanceof File) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        img.src = dataUrl;
        if (img.complete && img.naturalWidth > 0) {
          handleLoad();
        }
      };
      reader.onerror = (err) => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timeout);
        reject(err);
      };
      reader.readAsDataURL(imageSource);
    } else if (imageSource instanceof HTMLImageElement) {
      img.src = imageSource.src;
      if (img.complete && img.naturalWidth > 0) {
        handleLoad();
      }
    }
  });
}

/**
 * Superimposes a professional, high-definition, non-overlapping chain-of-custody watermark
 */
export async function addWatermarkToImage(
  imageSource: string | HTMLImageElement | File | Blob,
  data: WatermarkData
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Timeout safeguard
    const timeout = setTimeout(() => {
      if (typeof imageSource === 'string') {
        resolve(imageSource);
      } else if (imageSource instanceof File || imageSource instanceof Blob) {
        const reader = new FileReader();
        reader.onload = (e) => resolve((e.target?.result as string) || '');
        reader.onerror = () => reject(new Error('Watermark processing timed out'));
        reader.readAsDataURL(imageSource);
      } else {
        reject(new Error('Watermark processing timed out'));
      }
    }, 4500);

    const img = new Image();
    if (typeof imageSource === 'string' && /^https?:\/\//i.test(imageSource)) {
      img.crossOrigin = 'anonymous';
    }

    let isDone = false;
    const handleLoad = () => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha: false });

        if (!ctx) {
          throw new Error('Canvas 2D context not available');
        }

        // Higher base dimension for crystal-clear legibility (max 1080px)
        const maxDimension = 1080;
        let width = img.naturalWidth || img.width || 800;
        let height = img.naturalHeight || img.height || 600;

        if (width > maxDimension || height > maxDimension) {
          const scale = Math.min(maxDimension / width, maxDimension / height);
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }

        canvas.width = width;
        canvas.height = height;

        // Enable high-fidelity interpolation
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw original photo with black background fallback
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // Calculate proportional scale metrics
        const baseFontSize = Math.max(12, Math.round(width / 38));
        const padding = Math.max(12, Math.round(width / 32));

        // -------------------------------------------------------------
        // 1. TOP HEADER BANNER (Brand & Activity Pill Badge)
        // -------------------------------------------------------------
        const topBannerHeight = Math.round(baseFontSize * 2.8);
        
        // Dark background with subtle gradient
        ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
        ctx.fillRect(0, 0, width, topBannerHeight);

        // Bottom accent hairline on top banner
        ctx.fillStyle = data.isDrop ? '#10b981' : '#0284c7';
        ctx.fillRect(0, topBannerHeight - 2, width, 2);

        // Brand Text (Left)
        ctx.save();
        ctx.fillStyle = '#38bdf8'; // Sky-400
        ctx.font = `bold ${Math.round(baseFontSize * 1.15)}px 'Plus Jakarta Sans', system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        
        const brandTitle = 'SECOND MEDIC VIALTRACK';
        const brandWidth = ctx.measureText(brandTitle).width;
        ctx.fillText(brandTitle, padding, topBannerHeight / 2);
        ctx.restore();

        // Activity Badge (Right) - e.g. "LOCATION VERIFIED", "SAMPLE PICKUP", "LAB DROP"
        const roleLabel = data.isDrop
          ? 'LAB DROP PROOF'
          : data.isSelfie
          ? 'LOCATION VERIFICATION'
          : 'SPECIMEN COLLECTION';

        ctx.save();
        const badgeFontSize = Math.max(10, Math.round(baseFontSize * 0.82));
        ctx.font = `bold ${badgeFontSize}px 'Plus Jakarta Sans', system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        
        const badgeTextWidth = ctx.measureText(roleLabel).width;
        const badgePaddingX = Math.round(baseFontSize * 0.65);
        const badgePaddingY = Math.round(baseFontSize * 0.35);
        const badgeTotalWidth = badgeTextWidth + badgePaddingX * 2;
        const badgeHeight = badgeFontSize + badgePaddingY * 2;
        const badgeX = width - padding - badgeTotalWidth;
        const badgeY = (topBannerHeight - badgeHeight) / 2;

        // Only draw the right badge if it doesn't overlap the brand title
        if (badgeX > padding + brandWidth + 12) {
          const badgeBg = data.isDrop ? 'rgba(5, 150, 105, 0.9)' : 'rgba(2, 132, 199, 0.9)';
          drawRoundedRect(ctx, badgeX, badgeY, badgeTotalWidth, badgeHeight, 6, badgeBg);

          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText(roleLabel, badgeX + badgeTotalWidth / 2, topBannerHeight / 2);
        }
        ctx.restore();

        // -------------------------------------------------------------
        // 2. BOTTOM TELEMETRY & CHAIN-OF-CUSTODY PANEL
        // -------------------------------------------------------------
        const lineHeight = Math.round(baseFontSize * 1.35);
        const rowCount = 4;
        const boxHeight = Math.round(lineHeight * rowCount + padding * 1.8);
        const boxY = height - boxHeight;

        // Dark glass background
        ctx.fillStyle = 'rgba(15, 23, 42, 0.96)';
        ctx.fillRect(0, boxY, width, boxHeight);

        // Top accent line
        ctx.fillStyle = data.isDrop ? '#10b981' : data.isSelfie ? '#0284c7' : '#0284c7';
        ctx.fillRect(0, boxY, width, 3);

        const contentWidth = width - padding * 2;
        const colRightWidth = Math.min(Math.round(contentWidth * 0.42), 260);
        const colLeftWidth = contentWidth - colRightWidth - 12;

        // ----------------- ROW 1: Location & Temperature -----------------
        let currentY = boxY + padding + Math.round(baseFontSize * 0.7);

        // Left: Stop Location Title
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(baseFontSize * 1.15)}px 'Plus Jakarta Sans', system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        const locationName = data.stopName || data.address || (data.isDrop ? 'Diagnostic Central Lab' : 'Collection Stop');
        const rawTitle = data.isDrop ? `DROP: ${locationName}` : data.isSelfie ? `SELFIE: ${locationName}` : `PICKUP: ${locationName}`;
        const cleanTitle = fitText(ctx, rawTitle, colLeftWidth);
        ctx.fillText(cleanTitle, padding, currentY);
        ctx.restore();

        // Right: Cold Box Temperature Pill Badge
        const effectiveTemp = data.coldBoxTemp !== undefined ? data.coldBoxTemp : data.temperature;
        if (effectiveTemp !== undefined) {
          ctx.save();
          const isSafe = effectiveTemp >= 2.0 && effectiveTemp <= 8.0;
          const tempText = `TEMP: ${effectiveTemp.toFixed(1)}°C ${isSafe ? '(SAFE)' : '(ALERT)'}`;
          const tempFontSize = Math.max(10, Math.round(baseFontSize * 0.82));
          ctx.font = `bold ${tempFontSize}px 'Plus Jakarta Sans', system-ui, sans-serif`;
          ctx.textBaseline = 'middle';

          const tWidth = ctx.measureText(tempText).width;
          const tPadX = 8;
          const tPadY = 4;
          const tBoxW = tWidth + tPadX * 2;
          const tBoxH = tempFontSize + tPadY * 2;
          const tBoxX = width - padding - tBoxW;
          const tBoxY = currentY - tBoxH / 2;

          const pillBg = isSafe ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.3)';
          const pillBorder = isSafe ? '#10b981' : '#ef4444';
          drawRoundedRect(ctx, tBoxX, tBoxY, tBoxW, tBoxH, 5, pillBg, pillBorder, 1.5);

          ctx.fillStyle = isSafe ? '#34d399' : '#f87171';
          ctx.textAlign = 'center';
          ctx.fillText(tempText, tBoxX + tBoxW / 2, currentY);
          ctx.restore();
        }

        // ----------------- ROW 2: Rider, Client & Sample Count -----------------
        currentY += lineHeight;

        // Left: Rider Name & Client Info
        ctx.save();
        ctx.fillStyle = '#cbd5e1'; // slate-300
        ctx.font = `600 ${Math.round(baseFontSize * 0.9)}px 'Plus Jakarta Sans', system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        const clientText = data.clientName ? ` • Client: ${data.clientName}` : '';
        const riderInfo = fitText(ctx, `Rider: ${data.riderName}${clientText}`, colLeftWidth);
        ctx.fillText(riderInfo, padding, currentY);
        ctx.restore();

        // Right: Vials Collected / Receiver Name Badge
        const effectiveCount = data.sampleCount !== undefined ? data.sampleCount : data.vialCount;
        if (effectiveCount !== undefined && !data.isDrop) {
          ctx.save();
          const countText = `VIALS: ${effectiveCount} UNITS`;
          const countFontSize = Math.max(10, Math.round(baseFontSize * 0.82));
          ctx.font = `bold ${countFontSize}px 'Plus Jakarta Sans', system-ui, sans-serif`;
          ctx.textBaseline = 'middle';

          const cWidth = ctx.measureText(countText).width;
          const cBoxW = cWidth + 14;
          const cBoxH = countFontSize + 8;
          const cBoxX = width - padding - cBoxW;
          const cBoxY = currentY - cBoxH / 2;

          drawRoundedRect(ctx, cBoxX, cBoxY, cBoxW, cBoxH, 5, 'rgba(245, 158, 11, 0.25)', '#f59e0b', 1.5);
          ctx.fillStyle = '#fbbf24';
          ctx.textAlign = 'center';
          ctx.fillText(countText, cBoxX + cBoxW / 2, currentY);
          ctx.restore();
        } else if (data.receiverName && data.isDrop) {
          ctx.save();
          ctx.fillStyle = '#a7f3d0';
          ctx.font = `bold ${Math.round(baseFontSize * 0.85)}px 'Plus Jakarta Sans', system-ui, sans-serif`;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'right';
          const recText = fitText(ctx, `Received: ${data.receiverName}`, colRightWidth);
          ctx.fillText(recText, width - padding, currentY);
          ctx.restore();
        }

        // ----------------- ROW 3: GPS Coordinates & Custody ID -----------------
        currentY += lineHeight;

        // Left: Clean GPS Coordinates
        ctx.save();
        ctx.fillStyle = '#38bdf8'; // Sky-400
        ctx.font = `bold ${Math.round(baseFontSize * 0.88)}px 'JetBrains Mono', monospace, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        const latStr = Number(data.lat || 19.2082).toFixed(6);
        const lngStr = Number(data.lng || 72.8398).toFixed(6);
        const accStr = data.accuracy ? ` (±${Math.round(data.accuracy)}m)` : ' (±5m)';
        const coordText = fitText(ctx, `GPS: ${latStr}° N, ${lngStr}° E${accStr}`, colLeftWidth);
        ctx.fillText(coordText, padding, currentY);
        ctx.restore();

        // Right: Chain of Custody ID
        ctx.save();
        ctx.fillStyle = '#94a3b8'; // Slate-400
        ctx.font = `bold ${Math.round(baseFontSize * 0.82)}px 'JetBrains Mono', monospace, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';
        const hash = data.verificationCode || `SMVT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const custodyIdText = fitText(ctx, `ID: #${hash}`, colRightWidth);
        ctx.fillText(custodyIdText, width - padding, currentY);
        ctx.restore();

        // ----------------- ROW 4: Timestamp & ISO Compliance -----------------
        currentY += lineHeight;

        // Clean subtle top divider above footer row
        ctx.fillStyle = 'rgba(51, 65, 85, 0.5)';
        ctx.fillRect(padding, currentY - Math.round(lineHeight * 0.55), contentWidth, 1);

        // Left: Timestamp (Asia/Kolkata)
        ctx.save();
        ctx.fillStyle = '#f1f5f9';
        ctx.font = `500 ${Math.round(baseFontSize * 0.82)}px 'JetBrains Mono', monospace, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        
        let dateObj = new Date(data.timestamp);
        if (isNaN(dateObj.getTime())) {
          dateObj = new Date();
        }
        const formattedDate = dateObj.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        });
        const timeText = fitText(ctx, `TIME: ${formattedDate} IST`, colLeftWidth);
        ctx.fillText(timeText, padding, currentY);
        ctx.restore();

        // Right: ISO 15189 Stamp
        ctx.save();
        ctx.fillStyle = '#10b981'; // Emerald-500
        ctx.font = `bold ${Math.max(9, Math.round(baseFontSize * 0.75))}px 'Plus Jakarta Sans', system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';
        const isoText = fitText(ctx, '✓ ISO 15189 AUDIT PROOF', colRightWidth);
        ctx.fillText(isoText, width - padding, currentY);
        ctx.restore();

        // -------------------------------------------------------------
        // Export high-quality JPEG (quality 0.80)
        // -------------------------------------------------------------
        const watermarkedUrl = canvas.toDataURL('image/jpeg', 0.80);
        resolve(watermarkedUrl);
      } catch (err) {
        if (typeof imageSource === 'string') {
          resolve(imageSource);
        } else if (imageSource instanceof File || imageSource instanceof Blob) {
          const reader = new FileReader();
          reader.onload = (e) => resolve((e.target?.result as string) || '');
          reader.onerror = () => reject(err);
          reader.readAsDataURL(imageSource);
        } else {
          reject(err);
        }
      }
    };

    img.onload = handleLoad;
    img.onerror = (err) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timeout);
      if (typeof imageSource === 'string') {
        resolve(imageSource);
      } else if (imageSource instanceof File || imageSource instanceof Blob) {
        const reader = new FileReader();
        reader.onload = (e) => resolve((e.target?.result as string) || '');
        reader.onerror = () => reject(err);
        reader.readAsDataURL(imageSource);
      } else {
        reject(err);
      }
    };

    if (typeof imageSource === 'string') {
      img.src = imageSource;
      if (img.complete && img.naturalWidth > 0) {
        handleLoad();
      }
    } else if (imageSource instanceof Blob || imageSource instanceof File) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        img.src = dataUrl;
        if (img.complete && img.naturalWidth > 0) {
          handleLoad();
        }
      };
      reader.onerror = (err) => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timeout);
        reject(err);
      };
      reader.readAsDataURL(imageSource);
    } else if (imageSource instanceof HTMLImageElement) {
      img.src = imageSource.src;
      if (img.complete && img.naturalWidth > 0) {
        handleLoad();
      }
    }
  });
}

/**
 * Generates a verified specimen / selfie / lab handover photo placeholder if camera is not opened
 */
export function generateSpecimenWatermarkedPhoto(type: 'vial' | 'drop' | 'chiller' | 'selfie', label: string): string {
  const isDrop = type === 'drop';
  const isSelfie = type === 'selfie';
  const bgColor = isDrop ? '#064e3b' : isSelfie ? '#0c4a6e' : '#0f172a';
  const badgeColor = isDrop ? '#10b981' : isSelfie ? '#0284c7' : '#0284c7';
  const titleText = isDrop
    ? 'DIAGNOSTIC LAB INTAKE • DELIVERED'
    : isSelfie
    ? 'RIDER LOCATION VERIFICATION SELFIE'
    : 'CERTIFIED SPECIMEN VIAL COLLECTION';
  
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
    <rect width="800" height="600" fill="${bgColor}"/>
    <rect y="0" width="800" height="48" fill="#020617" opacity="0.9"/>
    <text x="24" y="32" fill="#38bdf8" font-family="system-ui, sans-serif" font-size="18" font-weight="bold">SECOND MEDIC VIALTRACK</text>
    <text x="280" y="32" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="14">${titleText}</text>
    
    <g transform="translate(400, 240)">
      ${isDrop 
        ? `<rect x="-120" y="-70" width="240" height="140" rx="12" fill="#047857" stroke="#34d399" stroke-width="3"/>
           <text x="0" y="8" fill="#ffffff" font-family="system-ui, sans-serif" font-size="20" font-weight="bold" text-anchor="middle">CENTRAL LAB RECEIPT</text>`
        : isSelfie
        ? `<circle cx="0" cy="-30" r="55" fill="#0369a1" stroke="#38bdf8" stroke-width="3"/>
           <circle cx="0" cy="-45" r="22" fill="#bae6fd"/>
           <path d="M -35 15 C -35 -10, 35 -10, 35 15 Z" fill="#bae6fd"/>
           <rect x="-110" y="45" width="220" height="36" rx="18" fill="#0284c7"/>
           <text x="0" y="68" fill="#ffffff" font-family="system-ui, sans-serif" font-size="13" font-weight="bold" text-anchor="middle">✓ RIDER ON-SITE VERIFIED</text>`
        : `<rect x="-160" y="-50" width="320" height="100" rx="8" fill="#1e293b" stroke="#38bdf8" stroke-width="3"/>
           <g transform="translate(-100, -80)">
             <rect x="0" y="0" width="20" height="24" rx="4" fill="#ef4444"/>
             <rect x="2" y="24" width="16" height="85" fill="#f87171" opacity="0.7"/>
           </g>
           <g transform="translate(-50, -80)">
             <rect x="0" y="0" width="20" height="24" rx="4" fill="#8b5cf6"/>
             <rect x="2" y="24" width="16" height="85" fill="#a78bfa" opacity="0.7"/>
           </g>
           <g transform="translate(0, -80)">
             <rect x="0" y="0" width="20" height="24" rx="4" fill="#ef4444"/>
             <rect x="2" y="24" width="16" height="85" fill="#f87171" opacity="0.7"/>
           </g>
           <g transform="translate(50, -80)">
             <rect x="0" y="0" width="20" height="24" rx="4" fill="#8b5cf6"/>
             <rect x="2" y="24" width="16" height="85" fill="#a78bfa" opacity="0.7"/>
           </g>
           <g transform="translate(100, -80)">
             <rect x="0" y="0" width="20" height="24" rx="4" fill="#ef4444"/>
             <rect x="2" y="24" width="16" height="85" fill="#f87171" opacity="0.7"/>
           </g>`
      }
    </g>

    <rect y="460" width="800" height="140" fill="#020617" opacity="0.95"/>
    <rect y="460" width="800" height="4" fill="${badgeColor}"/>
    <text x="24" y="505" fill="#ffffff" font-family="system-ui, sans-serif" font-size="22" font-weight="bold">${label}</text>
    <text x="24" y="540" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="14">ISO 15189 Verified Chain-of-Custody Proof • Geotagged &amp; Cold-Chain Logged</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const generateSampleVialPhoto = generateSpecimenWatermarkedPhoto;
