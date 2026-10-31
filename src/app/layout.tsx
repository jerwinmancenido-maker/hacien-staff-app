import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/** HACIEN brand kit: Inter (OFL) is the single UI/print font. */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

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
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
