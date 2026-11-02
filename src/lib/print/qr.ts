// QR code for the printed documents, generated locally (no external service).
import QRCode from "qrcode";

export const TERMS_URL = "https://haciensolutions.com/policies";

/** Inline SVG markup for a QR code pointing at `url`. */
export function qrSvg(url: string = TERMS_URL): Promise<string> {
  return QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
}
