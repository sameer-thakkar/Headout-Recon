import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "./theme-toggle";
import { StatusPill } from "./status-pill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RunRecord, RunStatus } from "@shared/schema";

interface TopBarProps {
  runs: RunRecord[];
  currentRunId: string | null;
  onRunChange: (runId: string) => void;
  status: RunStatus;
  lastFxRefresh: string | null;
  onFxRefresh: () => void;
  isRefreshing?: boolean;
}

export function TopBar({
  runs,
  currentRunId,
  onRunChange,
  status,
  lastFxRefresh,
  onFxRefresh,
  isRefreshing,
}: TopBarProps) {
  return (
    <header className="h-16 border-b border-border bg-background flex items-center justify-between px-4 gap-4">
      <div className="flex items-center gap-4">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
        <Select
          value={currentRunId || ""}
          onValueChange={onRunChange}
          disabled={runs.length === 0}
        >
          <SelectTrigger className="w-[240px]" data-testid="select-run">
            <SelectValue placeholder="Select a run..." />
          </SelectTrigger>
          <SelectContent>
            {runs.map((run) => (
              <SelectItem key={run.id} value={run.id}>
                {run.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-4">
        <StatusPill status={status} />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onFxRefresh}
            disabled={isRefreshing}
            data-testid="button-fx-refresh"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh FX
          </Button>
          {lastFxRefresh && (
            <span className="text-xs text-muted-foreground">
              Last: {new Date(lastFxRefresh).toLocaleString()}
            </span>
          )}
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
