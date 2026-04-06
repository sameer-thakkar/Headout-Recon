import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, Search, Calendar, Building2, DollarSign, Bookmark, BookmarkCheck, BookmarkX } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ReconSession {
  id: string;
  name: string;
  createdAt: string;
  status: string;
  beId?: string;
  beName?: string;
  currency?: string;
  totalDiscrepancy?: number;
  bookingCount?: number;
  hoFileName?: string;
  bookmarked?: boolean;
}

interface ReconTrackerPageProps {
  runId: string | null;
  savedSessionIds?: Set<string>;
  onToggleSave?: (sessionId: string) => void;
}

export function ReconTrackerPage({ runId, savedSessionIds, onToggleSave }: ReconTrackerPageProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: sessionsData, isLoading } = useQuery<{ sessions: ReconSession[] }>({
    queryKey: ["/api/sessions"],
  });

  const allSessions = sessionsData?.sessions || [];

  const savedSessions = useMemo(() => {
    return allSessions.filter((s) =>
      savedSessionIds ? savedSessionIds.has(s.id) : s.bookmarked
    );
  }, [allSessions, savedSessionIds]);

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return savedSessions;
    const query = searchQuery.toLowerCase();
    return savedSessions.filter(
      (session) =>
        session.id.toLowerCase().includes(query) ||
        session.name?.toLowerCase().includes(query) ||
        session.beId?.toLowerCase().includes(query) ||
        session.beName?.toLowerCase().includes(query) ||
        session.hoFileName?.toLowerCase().includes(query)
    );
  }, [savedSessions, searchQuery]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "done":
      case "completed":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Done</Badge>;
      case "processing":
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Processing</Badge>;
      case "error":
        return <Badge variant="destructive">Error</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <ClipboardCheck className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Recon Tracker</h1>
            <p className="text-sm text-muted-foreground">
              Your saved reconciliation sessions
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Saved Sessions
            </CardTitle>
            {savedSessions.length > 0 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search sessions…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-64"
                  data-testid="input-search-sessions"
                />
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : savedSessions.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
                <Bookmark className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="font-medium text-muted-foreground">No saved sessions yet</p>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                Use the bookmark icon in the top bar or on the home page to save a session here.
              </p>
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No sessions match your search
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Bookings</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSessions.map((session) => (
                  <TableRow
                    key={session.id}
                    className={session.id === runId ? "bg-primary/5" : ""}
                    data-testid={`row-session-${session.id}`}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{session.name || session.id.slice(0, 8)}</p>
                        {session.hoFileName && (
                          <p className="text-xs text-muted-foreground font-mono">{session.hoFileName}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{formatDate(session.createdAt)}</TableCell>
                    <TableCell>{getStatusBadge(session.status)}</TableCell>
                    <TableCell className="text-right text-sm">
                      {session.bookingCount ?? "—"}
                    </TableCell>
                    <TableCell>
                      {onToggleSave && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => onToggleSave(session.id)}
                              data-testid={`button-unsave-session-${session.id}`}
                              aria-label="Remove from tracker"
                            >
                              <BookmarkX className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Remove from tracker</TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                <ClipboardCheck className="h-5 w-5 text-blue-600 dark:text-blue-300" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Saved Sessions</p>
                <p className="text-2xl font-semibold">{savedSessions.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900">
                <Building2 className="h-5 w-5 text-green-600 dark:text-green-300" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Completed</p>
                <p className="text-2xl font-semibold">
                  {savedSessions.filter((s) => s.status === "done" || s.status === "completed").length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900">
                <DollarSign className="h-5 w-5 text-amber-600 dark:text-amber-300" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">All Sessions</p>
                <p className="text-2xl font-semibold">{allSessions.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
