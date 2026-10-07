import type { Metadata } from "next";
import "./globals.css";
import { PRODUCT_NAME } from "@/lib/config";

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} - the AI teammate that does the work`,
  description: "An AI teammate in Slack that uses your tools, learns your processes, and asks before it acts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
