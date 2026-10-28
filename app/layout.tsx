import type { Metadata, Viewport } from "next";
import "../ui/tokens.css";
import "../ui/components.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Home, again",
  description: "Find a café near your new home that feels like your old regular, guided by Qloo taste affinity.",
};

export const viewport: Viewport = {
  themeColor: "#0d0f0e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
