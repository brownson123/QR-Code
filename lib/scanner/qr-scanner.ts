// SPEC §10.1 scanner abstraction. The implementation is swappable (§17 A7).
export interface QrScanner {
  start(video: HTMLVideoElement, onDecode: (text: string) => void): Promise<void>;
  stop(): Promise<void>;
  listCameras(): Promise<MediaDeviceInfo[]>;
}

export type CameraFailure = 'denied' | 'unavailable' | 'other';

export class CameraError extends Error {
  override readonly name = 'CameraError';
  constructor(readonly reason: CameraFailure) {
    super(`camera ${reason}`);
  }
}

interface Detector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
interface DetectorClass {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<readonly string[]>;
}

export type DecoderEngine = 'native' | 'zxing-wasm';

// S5b decision: the browser's own BarcodeDetector where it supports QR (Chrome on Android), otherwise
// barcode-detector's zxing-cpp WebAssembly build, self-hosted under /zxing/ (no CDN). Created once per
// page: re-configuring the module would re-download and re-compile the ~1 MB WebAssembly.
let detectorPromise: Promise<{ detector: Detector; engine: DecoderEngine }> | null = null;
function getDetector() {
  detectorPromise ??= makeDetector().catch((err: unknown) => {
    detectorPromise = null;
    throw err;
  });
  return detectorPromise;
}

async function makeDetector(): Promise<{ detector: Detector; engine: DecoderEngine }> {
  const native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (native) {
    try {
      if ((await native.getSupportedFormats()).includes('qr_code')) {
        return { detector: new native({ formats: ['qr_code'] }), engine: 'native' };
      }
    } catch {
      // fall through to the WebAssembly decoder
    }
  }
  const mod = await import('barcode-detector/ponyfill');
  mod.setZXingModuleOverrides({
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? `/zxing/${path}` : prefix + path),
  });
  return { detector: new mod.BarcodeDetector({ formats: ['qr_code'] }), engine: 'zxing-wasm' };
}

function cameraFailure(err: unknown): CameraFailure {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') return 'unavailable';
  return 'other';
}

export interface BarcodeScanner extends QrScanner {
  /** Decoding is skipped while paused (a result is on screen); the camera keeps running. */
  setPaused(paused: boolean): void;
  engine(): DecoderEngine | null;
}

export function createBarcodeScanner(opts: { deviceId?: string | null; fps?: number } = {}): BarcodeScanner {
  const intervalMs = 1000 / Math.min(opts.fps ?? 10, 10); // SPEC §10.1: 10 fps or lower
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let paused = false;
  let engine: DecoderEngine | null = null;

  return {
    async start(video, onDecode) {
      const { detector, engine: e } = await getDetector();
      engine = e;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: opts.deviceId ? { deviceId: { exact: opts.deviceId } } : { facingMode: { ideal: 'environment' } },
        });
      } catch (err) {
        throw new CameraError(cameraFailure(err));
      }
      // iOS Safari needs both, or the video opens fullscreen / refuses to autoplay (CLAUDE.md).
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('muted', '');
      video.srcObject = stream;
      await video.play();
      running = true;
      const tick = async () => {
        if (!running) return;
        if (!paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          try {
            const [code] = await detector.detect(video);
            if (code?.rawValue && running && !paused) onDecode(code.rawValue);
          } catch {
            // a frame that can't be decoded is not an error
          }
        }
        if (running) timer = setTimeout(tick, intervalMs);
      };
      void tick();
    },
    async stop() {
      running = false;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    },
    async listCameras() {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    },
    setPaused(p) {
      paused = p;
    },
    engine: () => engine,
  };
}
