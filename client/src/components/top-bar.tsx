import { useState } from "react";
import { RefreshCw, LogOut, Bookmark, BookmarkCheck, ChevronDown, Shield, User, KeyRound, Users } from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { UserManagement } from "./user-management";
import { ChangePasswordDialog } from "./change-password-dialog";
import type { RunRecord, RunStatus, SafeUser } from "@shared/schema";

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
  currentUser?: SafeUser | null;
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
  currentUser,
}: TopBarProps) {
  const isSaved = currentRunId ? savedSessionIds?.has(currentRunId) : false;
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [userManagementOpen, setUserManagementOpen] = useState(false);

  return (
    <>
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

        <div className="flex items-center gap-3">
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
              <span className="text-xs text-muted-foreground hidden lg:inline">
                Last: {new Date(lastFxRefresh).toLocaleString()}
              </span>
            )}
          </div>
          <ThemeToggle />

          {currentUser ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 h-9 px-2"
                  data-testid="button-user-menu"
                  aria-label="User menu"
                >
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    {currentUser.role === "admin" ? (
                      <Shield className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                    ) : (
                      <User className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    )}
                  </div>
                  <span className="text-sm font-medium hidden sm:inline max-w-[120px] truncate">
                    {currentUser.username}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium text-sm">{currentUser.username}</span>
                    <Badge
                      variant={currentUser.role === "admin" ? "default" : "secondary"}
                      className="text-xs h-4 px-1.5 w-fit"
                    >
                      {currentUser.role}
                    </Badge>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setChangePasswordOpen(true)}
                  className="cursor-pointer"
                  data-testid="button-change-password"
                >
                  <KeyRound className="h-4 w-4 mr-2" aria-hidden="true" />
                  Change password
                </DropdownMenuItem>
                {currentUser.role === "admin" && (
                  <DropdownMenuItem
                    onClick={() => setUserManagementOpen(true)}
                    className="cursor-pointer"
                    data-testid="button-open-user-management"
                  >
                    <Users className="h-4 w-4 mr-2" aria-hidden="true" />
                    Manage users
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onLogout}
                  className="text-destructive focus:text-destructive cursor-pointer"
                  data-testid="button-logout"
                >
                  <LogOut className="h-4 w-4 mr-2" aria-hidden="true" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            onLogout && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onLogout}
                data-testid="button-logout"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </Button>
            )
          )}
        </div>
      </header>

      {/* Dialogs rendered outside header to avoid nesting issues */}
      {currentUser && (
        <>
          <ChangePasswordDialog
            open={changePasswordOpen}
            onOpenChange={setChangePasswordOpen}
          />
          {currentUser.role === "admin" && (
            <UserManagement
              currentUser={currentUser}
              open={userManagementOpen}
              onOpenChange={setUserManagementOpen}
            />
          )}
        </>
      )}
    </>
  );
}
