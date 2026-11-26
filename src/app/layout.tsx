import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getSettingsSnapshot } from "@/lib/settings";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { appIdentity } from "@/lib/settings/identity";

/** Fonts: self-hosted Inter + Archivo Black in public/fonts (see globals.css @font-face). */

// Title and description follow Settings → Company Profile → Identity
// (Company Profile slice 4, census F7): the seed profile renders exactly
// the historical strings, and a settings read failure falls back to the
// seeds so metadata can never break a page.
export async function generateMetadata(): Promise<Metadata> {
  let settings = DEFAULT_SETTINGS;
  try {
    settings = (await getSettingsSnapshot()).settings;
  } catch {
    // Keep the seed profile.
  }
  const identity = appIdentity(settings);
  return {
    title: identity.title,
    description: `${identity.shortName} staff app`,
    robots: { index: false, follow: false },
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/brand/icon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/brand/icon.svg", type: "image/svg+xml" },
      ],
      apple: [{ url: "/apple-icon.png", sizes: "512x512", type: "image/png" }],
    },
    manifest: "/site.webmanifest",
  };
}

export const viewport: Viewport = {
  // Brand ink, not company identity — fixed by the design guide (v1.5).
  themeColor: "#0A0A0A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
