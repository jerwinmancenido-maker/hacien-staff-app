// QR code for the printed documents, generated locally (no external service).
import QRCode from "qrcode";
import { POLICIES_URL } from "./policies";

export const TERMS_URL = POLICIES_URL;
export { POLICIES_URL };

/** Inline SVG markup for a QR code pointing at `url`. */
export function qrSvg(url: string = POLICIES_URL): Promise<string> {
  return QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
}
