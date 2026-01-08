import { Loader2, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RunStatus } from "@shared/schema";

interface StatusPillProps {
  status: RunStatus;
}

const statusConfig: Record<RunStatus, { label: string; icon: React.ElementType; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  idle: { label: "Idle", icon: Clock, variant: "secondary" },
  processing: { label: "Processing", icon: Loader2, variant: "default" },
  done: { label: "Done", icon: CheckCircle2, variant: "outline" },
  error: { label: "Error", icon: AlertCircle, variant: "destructive" },
};

export function StatusPill({ status }: StatusPillProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="gap-1.5 uppercase text-xs" data-testid="status-pill">
      <Icon className={`h-3 w-3 ${status === "processing" ? "animate-spin" : ""}`} />
      {config.label}
    </Badge>
  );
}
