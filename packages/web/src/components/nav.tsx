"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const tabs = [
  { value: "/players", label: "Players" },
  { value: "/tournaments", label: "Tournaments" },
];

export function Nav() {
  const pathname = usePathname();
  const activeTab = tabs.find((t) => pathname.startsWith(t.value))?.value ?? tabs[0].value;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background sm:static">
      <div className="mx-auto max-w-2xl px-4">
        <Tabs value={activeTab}>
          <TabsList variant="line" className="w-full !h-14">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} nativeButton={false} render={<Link href={tab.value} />} className="text-base">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    </nav>
  );
}
