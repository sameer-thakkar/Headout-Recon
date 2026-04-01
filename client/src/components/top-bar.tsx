import { RefreshCw, LogOut, Bookmark, BookmarkCheck } from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { RunRecord, RunStatus } from "@shared/schema";

interface TopBarProps {
  runs: RunRecord[];
  currentRunId: string | null;
  onRunChange: (runId: string) => void;
  status: RunStatus;
  lastFxRefresh: string | null;
  onFxRefresh: () => void;
  isRefreshing?: boolean;
  onLogout?: () => void;
  savedSessionIds?: Set<string>;
  onToggleSave?: (runId: string) => void;
}

export function TopBar({
  runs,
  currentRunId,
  onRunChange,
  status,
  lastFxRefresh,
  onFxRefresh,
  isRefreshing,
  onLogout,
  savedSessionIds,
  onToggleSave,
}: TopBarProps) {
  const isSaved = currentRunId ? savedSessionIds?.has(currentRunId) : false;

  return (
    <header className="h-16 border-b border-border bg-background flex items-center justify-between px-4 gap-4">
      <div className="flex items-center gap-2">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
        <Select
          value={currentRunId || ""}
          onValueChange={onRunChange}
          disabled={runs.length === 0}
        >
          <SelectTrigger className="w-[240px]" data-testid="select-run">
            <SelectValue placeholder="Select a run…" />
          </SelectTrigger>
          <SelectContent>
            {runs.map((run) => (
              <SelectItem key={run.id} value={run.id}>
                <span className="flex items-center gap-2">
                  {savedSessionIds?.has(run.id) && (
                    <BookmarkCheck className="h-3 w-3 text-primary flex-shrink-0" aria-hidden="true" />
                  )}
                  {run.name || run.id.slice(0, 8)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {currentRunId && onToggleSave && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={`h-8 w-8 p-0 ${isSaved ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => onToggleSave(currentRunId)}
                data-testid="button-save-session"
                aria-label={isSaved ? "Remove from tracker" : "Save to tracker"}
              >
                {isSaved ? (
                  <BookmarkCheck className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Bookmark className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {isSaved ? "Saved to Recon Tracker — click to remove" : "Save this session to Recon Tracker"}
            </TooltipContent>
          </Tooltip>
        )}
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
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            Refresh FX
          </Button>
          {lastFxRefresh && (
            <span className="text-xs text-muted-foreground">
              Last: {new Date(lastFxRefresh).toLocaleString()}
            </span>
          )}
        </div>
        <ThemeToggle />
        {onLogout && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onLogout}
            data-testid="button-logout"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </header>
  );
}
