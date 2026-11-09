"use client";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { ToastMessage } from "@/components/Toast";
import { PolicyDetailPanel } from "./PolicyDetailPanel";
import type { PolicyRadarItem } from "@/lib/policy-radar/types";

// Overlay shell for tablet/mobile — desktop uses PolicyDetailPanel directly
// in a persistent sticky pane instead (see app/(dashboard)/policy-radar/page.tsx).
interface PolicyDetailSheetProps {
  item: PolicyRadarItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onUpdated: (item: PolicyRadarItem) => void;
  onToast: (msg: Omit<ToastMessage, "id">) => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

export function PolicyDetailSheet({ item, open, onOpenChange, canManage, onUpdated, onToast, onPrev, onNext, hasPrev, hasNext }: PolicyDetailSheetProps) {
  if (!item) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="p-0">
        <PolicyDetailPanel
          item={item}
          canManage={canManage}
          onUpdated={onUpdated}
          onToast={onToast}
          onPrev={onPrev}
          onNext={onNext}
          hasPrev={hasPrev}
          hasNext={hasNext}
        />
      </SheetContent>
    </Sheet>
  );
}
