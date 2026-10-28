import type { Metadata, Viewport } from "next";
import "../ui/tokens.css";
import "../ui/components.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Home, again",
  description: "Find a café near your new home that feels like your old regular, guided by Qloo taste affinity.",
};

export const viewport: Viewport = {
  themeColor: "#fbf7ef",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
