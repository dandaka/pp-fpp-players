"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/players", label: "Players" },
  { href: "/tournaments", label: "Tournaments" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background sm:static sm:border-b sm:border-t-0">
      <div className="mx-auto flex max-w-2xl">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex-1 py-3 text-center text-sm font-medium transition-colors ${
              pathname.startsWith(tab.href)
                ? "text-foreground border-b-2 border-foreground sm:border-b-0 sm:border-t-2"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
