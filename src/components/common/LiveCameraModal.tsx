import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, X, RotateCcw, Check, AlertTriangle, SwitchCamera } from 'lucide-react';

/**
 * Live in-app camera.
 *
 * The Camera button used to be a <input type="file" capture="environment">. `capture` is a
 * mobile-only HINT: desktop browsers ignore it outright, and several Android browsers still show
 * a "Camera or Files?" chooser instead of opening the lens. That made "Camera" and "Upload"
 * behave identically for the rider.
 *
 * getUserMedia is deterministic on both desktop and mobile, and it closes a chain-of-custody gap
 * the file picker left open: a picker can attach ANY image already on the device, whereas a frame
 * grabbed from a live MediaStream can only be one taken right now, at the collection point.
 *
 * If the camera is unavailable (no permission, no device, insecure origin) this reports that and
 * offers the file picker as a fallback, rather than leaving the rider stuck with no way to record
 * a pickup.
 */
interface LiveCameraModalProps {
  isOpen: boolean;
  /** 'environment' = rear lens (specimen vials, lab drop). 'user' = front lens (rider selfie). */
  facing: 'environment' | 'user';
  title: string;
  subtitle?: string;
  onCapture: (file: File) => void;
  onClose: () => void;
  /** Invoked when the rider chooses the file-picker fallback. */
  onFallbackToFilePicker?: () => void;
}

export const LiveCameraModal: React.FC<LiveCameraModalProps> = ({
  isOpen,
  facing,
  title,
  subtitle,
  onCapture,
  onClose,
  onFallbackToFilePicker
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [activeFacing, setActiveFacing] = useState<'environment' | 'user'>(facing);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startStream = useCallback(
    async (wanted: 'environment' | 'user') => {
      setError(null);
      setStarting(true);
      stopStream();

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('unsupported');
        }

        // facingMode is a preference, not a guarantee -- a laptop has only one camera and an
        // `exact` constraint would throw there. Ask loosely so the stream always starts.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: wanted, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false
        });

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {
            /* autoplay rejection is not fatal; the preview still renders on user gesture */
          });
        }
        setActiveFacing(wanted);
      } catch (err: any) {
        const name = err?.name || '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setError('Camera permission was denied. Allow camera access for this site, or use Upload instead.');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setError('No camera found on this device. Use Upload instead.');
        } else if (err?.message === 'unsupported') {
          setError('This browser cannot open the camera directly. Use Upload instead.');
        } else {
          setError('Could not start the camera. Use Upload instead.');
        }
      } finally {
        setStarting(false);
      }
    },
    [stopStream]
  );

  useEffect(() => {
    if (isOpen) {
      setPreview(null);
      startStream(facing);
    } else {
      stopStream();
      setPreview(null);
      setError(null);
    }
    // Releasing the camera matters: an un-stopped track keeps the phone's camera LED on and
    // blocks any other app from using it until the tab is closed.
    return stopStream;
  }, [isOpen, facing, startStream, stopStream]);

  const takeFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // A front-facing preview is mirrored for the rider's benefit; un-mirror it so the saved proof
    // matches what a reviewer would actually see.
    if (activeFacing === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPreview(canvas.toDataURL('image/jpeg', 0.92));
  };

  const confirmFrame = () => {
    if (!preview) return;
    const [, base64] = preview.split(',');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
    stopStream();
    onCapture(file);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] bg-slate-950/95 flex flex-col">
      <div className="flex items-start justify-between gap-3 p-4 text-white shrink-0">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Camera className="w-4 h-4" />
            {title}
          </h3>
          {subtitle && <p className="text-[11px] text-slate-300 mt-0.5">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            stopStream();
            onClose();
          }}
          className="p-2 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer"
          aria-label="Close camera"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center px-4">
        {error ? (
          <div className="max-w-sm text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
            <p className="text-sm text-slate-200">{error}</p>
            {onFallbackToFilePicker && (
              <button
                type="button"
                onClick={() => {
                  stopStream();
                  onClose();
                  onFallbackToFilePicker();
                }}
                className="px-4 py-2 rounded-lg bg-white text-slate-900 text-sm font-bold cursor-pointer"
              >
                Choose a file instead
              </button>
            )}
          </div>
        ) : preview ? (
          <img src={preview} alt="Captured proof preview" className="max-h-full max-w-full rounded-lg object-contain" />
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`max-h-full max-w-full rounded-lg object-contain ${activeFacing === 'user' ? 'scale-x-[-1]' : ''}`}
          />
        )}
      </div>

      <div className="p-5 shrink-0 flex items-center justify-center gap-4">
        {!error && !preview && (
          <>
            <button
              type="button"
              onClick={() => startStream(activeFacing === 'environment' ? 'user' : 'environment')}
              className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              aria-label="Switch camera"
            >
              <SwitchCamera className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={takeFrame}
              disabled={starting}
              className="w-16 h-16 rounded-full bg-white border-4 border-slate-300 disabled:opacity-40 cursor-pointer"
              aria-label="Take photo"
            />
            <div className="w-11" />
          </>
        )}

        {!error && preview && (
          <>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-bold flex items-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              Retake
            </button>
            <button
              type="button"
              onClick={confirmFrame}
              className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold flex items-center gap-2 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              Use this photo
            </button>
          </>
        )}
      </div>
    </div>
  );
};
