import Link from "next/link";
import { PageHeader } from "@/components/ui";

export type FeatureName = "Books" | "Cash" | "Payables";

/** Plain staff page when a Settings → Features flag is off (instead of a raw 404). */
export function featureOffMessage(feature: FeatureName): string {
  return `This part (${feature}) is turned off. Ask your admin to turn it on in Settings > Features.`;
}

export function FeatureOffPage({ feature }: { feature: FeatureName }) {
  return (
    <>
      <PageHeader title={feature} subtitle="Turned off" />
      <div className="card">
        <p>{featureOffMessage(feature)}</p>
        <p className="faint small" style={{ marginTop: 12 }}>
          <Link href="/settings?tab=features">Open Settings → Features</Link>
        </p>
      </div>
    </>
  );
}
