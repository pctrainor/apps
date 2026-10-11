import type { Metadata } from "next";
import Link from "next/link";
import { currentAgent } from "@/lib/agent";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Sandbox",
  description: "Local test site for browser agents: a data-entry form and a Q&A board.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const agent = await currentAgent();
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">Agent Sandbox</Link>
          <nav aria-label="Main">
            <Link href="/intake">Intake form</Link>
            <Link href="/records">Records</Link>
            <Link href="/board">Message board</Link>
            <Link href="/reference">Reference</Link>
            <Link href="/activity">Activity</Link>
            <Link href="/market">Trading floor</Link>
          </nav>
          <span className="who">{agent ? <>Signed in as <strong>{agent}</strong></> : "Not signed in"}</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
