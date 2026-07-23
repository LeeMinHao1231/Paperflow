import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const imageUrl = `${protocol}://${host}/og.png`;
  return {
    title: "Paperflow — Attendance sheets to spreadsheets",
    description: "Turn photographed attendance sheets into reviewed Excel or Google Sheets data.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Paperflow — Attendance sheets to spreadsheets",
      description: "Paper to spreadsheet, without the typing.",
      images: [{ url: imageUrl, width: 1733, height: 909, alt: "Paperflow turns an attendance sheet into spreadsheet rows" }],
    },
    twitter: { card: "summary_large_image", images: [imageUrl] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
