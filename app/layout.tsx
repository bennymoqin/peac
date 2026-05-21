import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "小学英语智能备课教研协作中心 v1",
  description: "面向 1-6 年级小学英语教师的一站式备课减负工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <head>
        <link rel="stylesheet" href="/peac-ui-workbench.css" />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <Script src="/peac-ui-workbench.js?v=dmxfix4" strategy="afterInteractive" />
        <Script src="/peac-pptx-export.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
