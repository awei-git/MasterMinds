import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "神仙会 — MasterMinds",
  description: "长篇创作工作室",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
