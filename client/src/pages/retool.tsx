import { useState } from "react";
import { ExternalLink, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

const RETOOL_URL = "https://headout.tryretool.com/apps/Recon/Reconciliation%20Reports?embed=true";

export function RetoolPage() {
  const [blocked, setBlocked] = useState(false);

  return (
    <div className="flex flex-col h-full w-full">
      {blocked && (
        <div className="flex items-start gap-3 px-4 py-3 bg-yellow-50 dark:bg-yellow-950/30 border-b border-yellow-200 dark:border-yellow-800">
          <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
              Retool has blocked embedding
            </p>
            <p className="text-sm text-yellow-700 dark:text-yellow-400 mt-0.5">
              To fix this, go to your Retool admin panel: <strong>Settings → Security → Allow embedding from external sites</strong>.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-300 hover:bg-yellow-100 dark:hover:bg-yellow-900/40"
            onClick={() => window.open(RETOOL_URL, "_blank")}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Open in tab
          </Button>
        </div>
      )}
      <iframe
        src={RETOOL_URL}
        className="flex-1 w-full border-0"
        title="Retool"
        data-testid="iframe-retool"
        allow="clipboard-read; clipboard-write"
        onError={() => setBlocked(true)}
        onLoad={(e) => {
          try {
            const frame = e.currentTarget as HTMLIFrameElement;
            if (frame.contentDocument === null) setBlocked(true);
          } catch {
            setBlocked(true);
          }
        }}
      />
    </div>
  );
}
