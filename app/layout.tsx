import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "除脂肪体重トラッカー",
  description: "体重・除脂肪体重の時系列管理",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 text-gray-900 min-h-screen">
        {children}
      </body>
    </html>
  );
}
