import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SessionProvider } from "@/components/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProofForge",
  description: "Autonomous Software Engineering with Verifiable Changes",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
