import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";

interface ContentSectionProps {
  children: ReactNode;
  description: string;
  title: string;
}

export default function ContentSection({
  children,
  description,
  title,
}: ContentSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-medium">{title}</h3>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <Separator />
      <div className="max-w-xl">{children}</div>
    </section>
  );
}
