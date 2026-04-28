import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "let-me-see-say",
  description: "Local multi-model brainstorm orchestrator",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="latte">
      <body className="bg-ctp-base text-ctp-text min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
