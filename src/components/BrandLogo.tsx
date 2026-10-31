/** Official HACIEN logo SVGs — never retype the wordmark in a font. */
type BrandLogoProps = {
  /** full = wordmark + tagline (≥200px wide); wordmark = header (≥96px / 24px tall). */
  variant?: "full" | "wordmark";
  className?: string;
};

export function BrandLogo({ variant = "wordmark", className }: BrandLogoProps) {
  if (variant === "full") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- brand SVG from /public; do not retype the logo
      <img
        src="/brand/logo-full.svg"
        alt="HACIEN — Information Technology Solutions"
        width={240}
        height={65}
        className={className ?? "brand-logo-full"}
        decoding="async"
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- brand SVG from /public; do not retype the logo
    <img
      src="/brand/logo-wordmark.svg"
      alt="HACIEN"
      width={122}
      height={24}
      className={className ?? "brand-logo-wordmark"}
      decoding="async"
    />
  );
}
