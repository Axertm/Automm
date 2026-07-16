import QRCode from 'qrcode';

/** Generates a PNG QR code buffer for a deposit address, ready to attach to a Discord embed. */
export async function generateAddressQrCode(address: string): Promise<Buffer> {
  return QRCode.toBuffer(address, { type: 'png', width: 320, margin: 2, errorCorrectionLevel: 'M' });
}
