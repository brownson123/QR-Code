import QRCode from 'qrcode';
import { QR_OPTIONS } from './options';

export function renderQrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, { ...QR_OPTIONS, type: 'png' });
}
