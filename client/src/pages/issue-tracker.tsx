import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertTriangle,
  Trash2,
  ExternalLink,
  Check,
  X,
  Pencil,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FileWarning,
  DollarSign,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  errorBucketRcaMapping,
  errorBucketOptions,
  issueStatuses,
  driTeams,
} from "@shared/schema";

interface IssueRecord {
  issueId: string;
  runId: string;
  createdDate: string;
  billingEntityId: string;
  billingEntityName: string;
  currency: string;
  discrepancyLocal: number;
  discrepancyUsd: number;
  reason: string;
  driTeam: string;
  bookingIds?: string[];
  paymentMethod?: string;
  period?: string;
  assignee?: string;
  errorBucket?: string;
  rca?: string;
  slackLink?: string;
  workingsLink?: string;
  issueStatus?: string;
}

interface IssueTrackerPageProps {
  runId: string | null;
}

type SortField = "issueId" | "createdDate" | "discrepancyLocal" | "discrepancyUsd" | "issueStatus" | "driTeam";
type SortDirection = "asc" | "desc";

function formatCurrency(value: number): string {
  const absValue = Math.abs(value);
  const isNegative = value < 0;
  const [intPart, decPart] = absValue.toFixed(2).split(".");

  let result = "";
  const len = intPart.length;

  if (len <= 3) {
    result = intPart;
  } else {
    result = intPart.slice(-3);
    let remaining = intPart.slice(0, -3);
    while (remaining.length > 0) {
      const chunk = remaining.slice(-2);
      result = chunk + "," + result;
      remaining = remaining.slice(0, -2);
    }
  }

  return (isNegative ? "-" : "") + result + "." + decPart;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  const day = date.getUTCDate().toString().padStart(2, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function getStatusColor(status?: string): string {
  if (!status) return "bg-muted text-muted-foreground";
  if (status.startsWith("Issue resolved - Loss")) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (status.startsWith("Issue resolved - No loss")) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  if (status.startsWith("Pending")) return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
  return "bg-muted text-muted-foreground";
}

function getStatusBadgeVariant(status?: string): { bg: string; text: string; dot: string } {
  if (!status) return { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-600 dark:text-gray-400", dot: "bg-gray-400" };
  if (status.startsWith("Issue resolved - Loss")) return { bg: "bg-red-50 dark:bg-red-950/40", text: "text-red-700 dark:text-red-300", dot: "bg-red-500" };
  if (status.startsWith("Issue resolved - No loss")) return { bg: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" };
  if (status.startsWith("Pending")) return { bg: "bg-amber-50 dark:bg-amber-950/40", text: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500" };
  return { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-600 dark:text-gray-400", dot: "bg-gray-400" };
}

function getDiscrepancyColor(value: number): string {
  if (value > 0) return "text-red-600 dark:text-red-400";
  if (value < 0) return "text-emerald-600 dark:text-emerald-400";
  return "";
}

function InlineTextEdit({
  value,
  onSave,
  placeholder,
  issueId,
  field,
  isLink,
}: {
  value: string;
  onSave: (val: string) => void;
  placeholder: string;
  issueId: string;
  field: string;
  isLink?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleSave = () => {
    onSave(draft);
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="text-xs min-w-[120px]"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") handleCancel();
          }}
          data-testid={`input-${field}-${issueId}`}
        />
        <Button variant="ghost" size="icon" onClick={handleSave} data-testid={`save-${field}-${issueId}`}>
          <Check className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleCancel} data-testid={`cancel-${field}-${issueId}`}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  if (isLink && value) {
    return (
      <div className="flex items-center gap-1 group">
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[120px]"
          title={value}
          data-testid={`link-${field}-${issueId}`}
        >
          <ExternalLink className="h-3 w-3 inline mr-1" />
          Link
        </a>
        <Button
          variant="ghost"
          size="icon"
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => setEditing(true)}
          data-testid={`edit-${field}-${issueId}`}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1 cursor-pointer group min-h-[24px]"
      onClick={() => setEditing(true)}
      data-testid={`click-edit-${field}-${issueId}`}
    >
      <span className="text-xs text-muted-foreground truncate max-w-[120px]">
        {value || placeholder}
      </span>
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}

function InlineSelectEdit({
  value,
  options,
  onSave,
  placeholder,
  issueId,
  field,
}: {
  value: string;
  options: readonly string[] | string[];
  onSave: (val: string) => void;
  placeholder: string;
  issueId: string;
  field: string;
}) {
  return (
    <Select
      value={value || ""}
      onValueChange={(val) => onSave(val)}
    >
      <SelectTrigger
        className="text-xs border-dashed min-w-[130px]"
        data-testid={`select-${field}-${issueId}`}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt} value={opt} className="text-xs">
            {opt}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SortableHeader({
  label,
  field,
  currentSort,
  currentDirection,
  onSort,
  className,
}: {
  label: string;
  field: SortField;
  currentSort: SortField | null;
  currentDirection: SortDirection;
  onSort: (field: SortField) => void;
  className?: string;
}) {
  const isActive = currentSort === field;
  return (
    <TableHead
      className={`text-xs ${className || ""}`}
    >
      <button
        type="button"
        className="flex items-center gap-1 w-full text-left"
        onClick={() => onSort(field)}
        aria-sort={isActive ? (currentDirection === "asc" ? "ascending" : "descending") : undefined}
        data-testid={`sort-${field}`}
      >
        <span>{label}</span>
        {isActive ? (
          currentDirection === "asc" ? (
            <ArrowUp className="h-3 w-3 text-primary" />
          ) : (
            <ArrowDown className="h-3 w-3 text-primary" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />
        )}
      </button>
    </TableHead>
  );
}

export function IssueTrackerPage({ runId }: IssueTrackerPageProps) {
  const { toast } = useToast();
  const [deletingIssueId, setDeletingIssueId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const { data, isLoading } = useQuery<{ issues: IssueRecord[] }>({
    queryKey: [`/api/issues/${runId}`],
    enabled: !!runId,
  });

  const issues = data?.issues || [];

  const updateMutation = useMutation({
    mutationFn: async ({ issueId, updates }: { issueId: string; updates: Partial<IssueRecord> }) => {
      return apiRequest("PATCH", `/api/issues/${encodeURIComponent(issueId)}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/issues/${runId}`] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update issue. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleUpdateField = useCallback(
    (issueId: string, field: string, value: string) => {
      const updates: Partial<IssueRecord> = { [field]: value };
      if (field === "errorBucket") {
        updates.rca = undefined;
      }
      updateMutation.mutate({ issueId, updates });
    },
    [updateMutation]
  );

  const handleDeleteIssue = async (issueId: string) => {
    setDeletingIssueId(issueId);
    try {
      await apiRequest("DELETE", `/api/issues/${encodeURIComponent(issueId)}`);
      toast({
        title: "Issue Deleted",
        description: `${issueId} has been removed from the tracker.`,
      });
      await queryClient.invalidateQueries({ queryKey: [`/api/issues/${runId}`] });
    } catch (error) {
      console.error("Delete issue error:", error);
      toast({
        title: "Error",
        description: "Failed to delete issue. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeletingIssueId(null);
    }
  };

  const handleSort = useCallback((field: SortField) => {
    setSortField(prev => {
      if (prev === field) {
        setSortDirection(d => d === "asc" ? "desc" : "asc");
        return field;
      }
      setSortDirection("asc");
      return field;
    });
  }, []);

  const totals = useMemo(() => {
    return issues.reduce(
      (acc, issue) => ({
        discrepancyLocal: acc.discrepancyLocal + issue.discrepancyLocal,
        discrepancyUsd: acc.discrepancyUsd + issue.discrepancyUsd,
      }),
      { discrepancyLocal: 0, discrepancyUsd: 0 }
    );
  }, [issues]);

  const statusSummary = useMemo(() => {
    const counts = { total: issues.length, openPending: 0, resolved: 0 };
    for (const issue of issues) {
      const status = issue.issueStatus || "";
      if (status.startsWith("Issue resolved")) {
        counts.resolved++;
      } else if (status.startsWith("Pending")) {
        counts.openPending++;
      }
    }
    return counts;
  }, [issues]);

  const statusCountMap = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const issue of issues) {
      const status = issue.issueStatus || "Unset";
      counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
  }, [issues]);

  const filteredAndSortedIssues = useMemo(() => {
    let result = [...issues];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(issue =>
        issue.issueId.toLowerCase().includes(q) ||
        issue.billingEntityName.toLowerCase().includes(q) ||
        issue.billingEntityId.toLowerCase().includes(q) ||
        (issue.driTeam || "").toLowerCase().includes(q) ||
        (issue.reason || "").toLowerCase().includes(q) ||
        (issue.assignee || "").toLowerCase().includes(q) ||
        (issue.paymentMethod || "").toLowerCase().includes(q)
      );
    }

    if (statusFilter !== "all") {
      if (statusFilter === "Unset") {
        result = result.filter(issue => !issue.issueStatus);
      } else {
        result = result.filter(issue => issue.issueStatus === statusFilter);
      }
    }

    if (sortField) {
      result.sort((a, b) => {
        let cmp = 0;
        switch (sortField) {
          case "issueId":
            cmp = a.issueId.localeCompare(b.issueId);
            break;
          case "createdDate":
            cmp = new Date(a.createdDate).getTime() - new Date(b.createdDate).getTime();
            break;
          case "discrepancyLocal":
            cmp = a.discrepancyLocal - b.discrepancyLocal;
            break;
          case "discrepancyUsd":
            cmp = a.discrepancyUsd - b.discrepancyUsd;
            break;
          case "issueStatus":
            cmp = (a.issueStatus || "").localeCompare(b.issueStatus || "");
            break;
          case "driTeam":
            cmp = (a.driTeam || "").localeCompare(b.driTeam || "");
            break;
        }
        return sortDirection === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [issues, searchQuery, statusFilter, sortField, sortDirection]);

  if (!runId) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[400px]">
        <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-medium mb-2" data-testid="text-no-run">No Reconciliation Run Selected</h2>
        <p className="text-muted-foreground text-center">
          Upload files and run reconciliation to start tracking issues.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground" data-testid="text-loading">Loading issues...</p>
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[400px]">
        <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-medium mb-2" data-testid="text-no-issues">No Issues Logged</h2>
        <p className="text-muted-foreground text-center">
          Issues logged from the Amount Payable Calculator will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-title">Issue Tracker</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Track discrepancies logged as issues at the DRI-Discrepancy level
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border shadow-sm" data-testid="card-total-issues">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40">
                <FileWarning className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Total Issues</p>
                <p className="text-xl font-bold" data-testid="text-total-count">{statusSummary.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm" data-testid="card-total-usd">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-950/40">
                <DollarSign className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Disc. USD</p>
                <p className={`text-xl font-bold font-mono ${getDiscrepancyColor(totals.discrepancyUsd)}`} data-testid="text-total-usd">
                  {formatCurrency(totals.discrepancyUsd)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm" data-testid="card-open-pending">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40">
                <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Open / Pending</p>
                <p className="text-xl font-bold" data-testid="text-open-count">{statusSummary.openPending}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm" data-testid="card-resolved">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Resolved</p>
                <p className="text-xl font-bold" data-testid="text-resolved-count">{statusSummary.resolved}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by ID, name, team, assignee..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-sm"
            data-testid="input-search"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px] text-sm" data-testid="select-status-filter">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-sm">All Statuses</SelectItem>
            <SelectItem value="Unset" className="text-sm">Unset</SelectItem>
            {issueStatuses.map((s) => (
              <SelectItem key={s} value={s} className="text-sm">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(statusCountMap).map(([status, count]) => (
            <Badge
              key={status}
              variant="outline"
              className={`text-xs cursor-pointer transition-all ${
                statusFilter === status ? "ring-2 ring-primary ring-offset-1" : ""
              } ${getStatusColor(status === "Unset" ? undefined : status)}`}
              onClick={() => setStatusFilter(statusFilter === status ? "all" : status)}
              data-testid={`badge-status-${status}`}
            >
              {status}: {count}
            </Badge>
          ))}
        </div>
      </div>

      {filteredAndSortedIssues.length === 0 && (searchQuery || statusFilter !== "all") && (
        <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-no-results">
          No issues match your search or filter criteria.
        </div>
      )}

      {filteredAndSortedIssues.length > 0 && (
        <Card className="border shadow-sm">
          <CardHeader className="py-3 px-4 border-b">
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-sm font-medium">
                {filteredAndSortedIssues.length === issues.length
                  ? `All Issues (${issues.length})`
                  : `Showing ${filteredAndSortedIssues.length} of ${issues.length}`}
              </CardTitle>
              {sortField && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setSortField(null); setSortDirection("asc"); }}
                  data-testid="button-clear-sort"
                >
                  Clear sort
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto relative">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow className="bg-muted/40">
                    <SortableHeader label="Issue ID" field="issueId" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} className="w-24" />
                    <SortableHeader label="Date" field="createdDate" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} className="w-24" />
                    <TableHead className="w-28 text-xs">Pay Method</TableHead>
                    <TableHead className="w-24 text-xs">Period</TableHead>
                    <TableHead className="w-28 text-xs">Assignee</TableHead>
                    <TableHead className="w-24 text-xs border-l border-border/40">BE ID</TableHead>
                    <TableHead className="w-32 text-xs">BE Name</TableHead>
                    <TableHead className="w-16 text-xs text-center border-l border-border/40">CCY</TableHead>
                    <SortableHeader label="Disc. LC" field="discrepancyLocal" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} className="w-28 text-right" />
                    <SortableHeader label="Disc. USD" field="discrepancyUsd" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} className="w-28 text-right" />
                    <SortableHeader label="DRI Team" field="driTeam" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} className="w-28 border-l border-border/40" />
                    <TableHead className="w-32 text-xs">Error Bucket</TableHead>
                    <TableHead className="w-36 text-xs">RCA</TableHead>
                    <TableHead className="w-24 text-xs border-l border-border/40">Slack</TableHead>
                    <TableHead className="w-24 text-xs">Workings</TableHead>
                    <SortableHeader label="Status" field="issueStatus" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} className="w-40 border-l border-border/40" />
                    <TableHead className="w-16 text-xs text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedIssues.map((issue, index) => {
                    const rcaOptions = issue.errorBucket
                      ? errorBucketRcaMapping[issue.errorBucket] || []
                      : [];
                    const statusStyle = getStatusBadgeVariant(issue.issueStatus);

                    return (
                      <TableRow
                        key={issue.issueId}
                        className={`transition-colors hover:bg-muted/40 ${index % 2 === 1 ? "bg-muted/15" : ""}`}
                        data-testid={`row-issue-${issue.issueId}`}
                      >
                        <TableCell className="font-mono text-xs font-medium" data-testid={`text-id-${issue.issueId}`}>
                          {issue.issueId}
                        </TableCell>
                        <TableCell className="text-xs" data-testid={`text-date-${issue.issueId}`}>
                          {formatDate(issue.createdDate)}
                        </TableCell>
                        <TableCell className="text-xs" data-testid={`text-payment-${issue.issueId}`}>
                          {issue.paymentMethod || "-"}
                        </TableCell>
                        <TableCell className="text-xs" data-testid={`text-period-${issue.issueId}`}>
                          {issue.period || "-"}
                        </TableCell>
                        <TableCell>
                          <InlineTextEdit
                            value={issue.assignee || ""}
                            onSave={(val) => handleUpdateField(issue.issueId, "assignee", val)}
                            placeholder="Assign..."
                            issueId={issue.issueId}
                            field="assignee"
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs border-l border-border/20" data-testid={`text-beid-${issue.issueId}`}>
                          {issue.billingEntityId}
                        </TableCell>
                        <TableCell>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-xs truncate block max-w-[120px]" data-testid={`text-bename-${issue.issueId}`}>
                                  {issue.billingEntityName}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">{issue.billingEntityName}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        <TableCell className="text-center text-xs border-l border-border/20" data-testid={`text-ccy-${issue.issueId}`}>
                          {issue.currency}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-xs font-medium ${getDiscrepancyColor(issue.discrepancyLocal)}`} data-testid={`text-disclc-${issue.issueId}`}>
                          {formatCurrency(issue.discrepancyLocal)}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-xs font-semibold ${getDiscrepancyColor(issue.discrepancyUsd)}`} data-testid={`text-discusd-${issue.issueId}`}>
                          {formatCurrency(issue.discrepancyUsd)}
                        </TableCell>
                        <TableCell className="border-l border-border/20">
                          <InlineSelectEdit
                            value={issue.driTeam}
                            options={[...driTeams]}
                            onSave={(val) => handleUpdateField(issue.issueId, "driTeam", val)}
                            placeholder="DRI Team"
                            issueId={issue.issueId}
                            field="driTeam"
                          />
                        </TableCell>
                        <TableCell>
                          <InlineSelectEdit
                            value={issue.errorBucket || ""}
                            options={[...errorBucketOptions]}
                            onSave={(val) => handleUpdateField(issue.issueId, "errorBucket", val)}
                            placeholder="Select..."
                            issueId={issue.issueId}
                            field="errorBucket"
                          />
                        </TableCell>
                        <TableCell>
                          {rcaOptions.length > 0 ? (
                            <InlineSelectEdit
                              value={issue.rca || ""}
                              options={rcaOptions}
                              onSave={(val) => handleUpdateField(issue.issueId, "rca", val)}
                              placeholder="Select RCA..."
                              issueId={issue.issueId}
                              field="rca"
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground italic">
                              Select bucket first
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="border-l border-border/20">
                          <InlineTextEdit
                            value={issue.slackLink || ""}
                            onSave={(val) => handleUpdateField(issue.issueId, "slackLink", val)}
                            placeholder="Add link..."
                            issueId={issue.issueId}
                            field="slackLink"
                            isLink
                          />
                        </TableCell>
                        <TableCell>
                          {issue.workingsLink ? (
                            <a
                              href={issue.workingsLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                              data-testid={`link-workings-${issue.issueId}`}
                            >
                              <ExternalLink className="h-3 w-3" />
                              Sheet
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="border-l border-border/20">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                              <span className="truncate max-w-[80px]">
                                {issue.issueStatus
                                  ? issue.issueStatus.replace("Issue resolved - ", "").replace("Pending - ", "P: ")
                                  : "Unset"}
                              </span>
                            </span>
                            <InlineSelectEdit
                              value={issue.issueStatus || ""}
                              options={[...issueStatuses]}
                              onSave={(val) => handleUpdateField(issue.issueId, "issueStatus", val)}
                              placeholder=""
                              issueId={issue.issueId}
                              field="issueStatus"
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                data-testid={`button-delete-issue-${issue.issueId}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Issue</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete {issue.issueId}? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteIssue(issue.issueId)}
                                  className="bg-destructive text-destructive-foreground"
                                  data-testid={`button-confirm-delete-${issue.issueId}`}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
