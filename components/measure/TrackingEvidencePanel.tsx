"use client";

import { Info } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useT } from "@/lib/i18n/client";
import type { TrackingEvidence } from "@/lib/measure/evidence-contract";

/** BA proposed wording. No controls or extra fetch; parent owns loading/errors/permission.
 * Native disclosure provides keyboard access to the source boundary and next check. */
export function TrackingEvidencePanel({ evidence }: { evidence?: TrackingEvidence }) {
  const t = useT();
  return <Card>
    <CardHeader>
      <h3 className="flex items-center gap-2 font-semibold"><Info aria-hidden="true" className="size-4 shrink-0" />{t("meta.evidence.title")}</h3>
      <p className="text-sm text-muted-foreground">{t("meta.evidence.boundary")}</p>
    </CardHeader>
    <CardContent>
      {!evidence ? <p className="text-sm text-muted-foreground">{t("meta.evidence.empty")}</p> : <ul className="divide-y divide-border">
        {evidence.layers.map((item) => <li key={item.layer} className="min-w-0 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{t(`meta.evidence.layer.${item.layer}`)}</span>
            <span className="text-sm text-muted-foreground">{t(`meta.evidence.status.${item.status}`)}</span>
          </div>
          <p className="mt-1 break-words text-sm text-muted-foreground">{t(`meta.evidence.reason.${item.reason}`)}</p>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer rounded-sm text-primary focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2">{t("meta.evidence.next")}</summary>
            <p className="mt-2 break-words text-muted-foreground">{t(`meta.evidence.next.${item.layer}`)}</p>
            {item.sourceRef && <p className="mt-1 text-muted-foreground">{t("meta.evidence.source")}</p>}
          </details>
        </li>)}
      </ul>}
    </CardContent>
  </Card>;
}
