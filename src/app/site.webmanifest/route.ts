import { getSettingsSnapshot } from "@/lib/settings";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { appIdentity } from "@/lib/settings/identity";

// Settings-served PWA manifest (Company Profile slice 4, census F7):
// name / short_name / description follow the CURRENT company profile,
// so a profile rename renames the installed app. theme_color stays the
// brand ink #0A0A0A — brand, not identity (design guide v1.5) — and the
// icons are the shipped brand artwork (census F6, replaced via the
// logo-upload setting, not code).
export const dynamic = "force-dynamic";

export async function GET() {
  let settings = DEFAULT_SETTINGS;
  try {
    settings = (await getSettingsSnapshot()).settings;
  } catch {
    // Keep the seed profile — the manifest must never fail to serve.
  }
  const identity = appIdentity(settings);
  const manifest = {
    name: identity.title,
    short_name: identity.shortName,
    description: `${identity.shortName} staff app`,
    start_url: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#0A0A0A",
    icons: [
      {
        src: "/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/brand/icon-dark-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
  return new Response(`${JSON.stringify(manifest, null, 2)}\n`, {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" },
  });
}
