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
    <html lang="en">
      <body className="bg-ctp-crust text-ctp-text min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
