import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { CommandPalette } from "@/components/CommandPalette";

export const metadata: Metadata = {
  title: "Swiss Knife",
  description: "Local AI daily runner powered by Gemma",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 p-8">{children}</main>
          </div>
          <Toaster />
          <CommandPalette />
        </ThemeProvider>
      </body>
    </html>
  );
}
