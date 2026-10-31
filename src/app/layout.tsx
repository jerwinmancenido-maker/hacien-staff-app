import type { Metadata } from "next";
import "./globals.css";

/** Fonts: self-hosted Inter + Archivo Black in public/fonts (see globals.css @font-face). */

export const metadata: Metadata = {
  title: "HACIEN Staff",
  description: "HACIEN staff app",
  robots: { index: false, follow: false },
  icons: {
    icon: [{ url: "/brand/favicon.ico" }, { url: "/brand/icon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
