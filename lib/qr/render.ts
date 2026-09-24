import QRCode from 'qrcode';

// SPEC §6.2. The background MUST be opaque: transparent PNGs vanish in dark-mode mail clients.
export const QR_RENDER_OPTIONS = {
  errorCorrectionLevel: 'M',
  margin: 4,
  width: 600,
  color: { dark: '#000000ff', light: '#ffffffff' },
} as const;

export function renderQrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, { ...QR_RENDER_OPTIONS, type: 'png' });
}
