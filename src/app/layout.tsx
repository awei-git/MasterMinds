import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Noto_Serif_SC, Zhi_Mang_Xing } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoSerifSC = Noto_Serif_SC({
  variable: "--font-serif-cn",
  subsets: ["latin"],
  weight: ["400", "700", "900"],
});

const zhiMangXing = Zhi_Mang_Xing({
  variable: "--font-brush",
  subsets: ["latin"],
  weight: "400",
});

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
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${notoSerifSC.variable} ${zhiMangXing.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
