import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "getdown. — Save media, simply.",
  description: "A private, open-source video and audio downloader powered by yt-dlp.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "getdown.",
    description: "Save the media you love. No account required.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0e1113",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
