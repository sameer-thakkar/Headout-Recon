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
import { AlertTriangle, Trash2, ExternalLink, Check, X, Pencil, RefreshCw, Loader2 } from "lucide-react";
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

export function IssueTrackerPage({ runId }: IssueTrackerPageProps) {
  const { toast } = useToast();
  const [deletingIssueId, setDeletingIssueId] = useState<string | null>(null);
  const [generatingWorkings, setGeneratingWorkings] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ issues: IssueRecord[] }>({
    queryKey: [`/api/issues/${runId}`],
    enabled: !!runId,
    refetchInterval: (query) => {
      const list = query.state.data?.issues;
      if (list && list.some((i: IssueRecord) => !i.workingsLink)) return 5000;
      return false;
    },
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

  const handleGenerateWorkings = async (issueId: string) => {
    setGeneratingWorkings(issueId);
    try {
      await apiRequest("POST", `/api/issues/${encodeURIComponent(issueId)}/generate-workings`);
      toast({
        title: "Workings Sheet Generated",
        description: "Google Sheet created with Draft Message and DRI Discrepancy tabs.",
      });
      await queryClient.invalidateQueries({ queryKey: [`/api/issues/${runId}`] });
    } catch (error: any) {
      console.error("Generate workings error:", error);
      toast({
        title: "Error",
        description: error?.message || "Failed to generate workings sheet. Please try again.",
        variant: "destructive",
      });
    } finally {
      setGeneratingWorkings(null);
    }
  };

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
    const counts: Record<string, number> = {};
    for (const issue of issues) {
      const status = issue.issueStatus || "Unset";
      counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
  }, [issues]);

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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-title">Issue Tracker</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track discrepancies logged as issues at the DRI-Discrepancy level
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground" data-testid="text-issue-count">
            {issues.length} issue{issues.length !== 1 ? "s" : ""}
          </p>
          <p className="font-mono text-sm font-medium" data-testid="text-total-usd">
            Total: ${formatCurrency(totals.discrepancyUsd)} USD
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(statusSummary).map(([status, count]) => (
          <Badge
            key={status}
            variant="outline"
            className={`text-xs ${getStatusColor(status === "Unset" ? undefined : status)}`}
            data-testid={`badge-status-${status}`}
          >
            {status}: {count}
          </Badge>
        ))}
      </div>

      <Card>
        <CardHeader className="py-3 px-4 border-b">
          <CardTitle className="text-sm font-medium">All Issues</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-24 text-xs">Issue ID</TableHead>
                  <TableHead className="w-24 text-xs">Date</TableHead>
                  <TableHead className="w-28 text-xs">Payment Method</TableHead>
                  <TableHead className="w-24 text-xs">Period</TableHead>
                  <TableHead className="w-28 text-xs">Assignee</TableHead>
                  <TableHead className="w-24 text-xs">BE ID</TableHead>
                  <TableHead className="w-32 text-xs">BE Name</TableHead>
                  <TableHead className="w-16 text-xs text-center">CCY</TableHead>
                  <TableHead className="w-28 text-xs text-right">Disc. LC</TableHead>
                  <TableHead className="w-28 text-xs text-right">Disc. USD</TableHead>
                  <TableHead className="w-28 text-xs">DRI Team</TableHead>
                  <TableHead className="w-32 text-xs">Error Bucket</TableHead>
                  <TableHead className="w-36 text-xs">RCA</TableHead>
                  <TableHead className="w-24 text-xs">Slack</TableHead>
                  <TableHead className="w-24 text-xs">Workings</TableHead>
                  <TableHead className="w-40 text-xs">Issue Status</TableHead>
                  <TableHead className="w-16 text-xs text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issues.map((issue) => {
                  const rcaOptions = issue.errorBucket
                    ? errorBucketRcaMapping[issue.errorBucket] || []
                    : [];

                  return (
                    <TableRow key={issue.issueId} data-testid={`row-issue-${issue.issueId}`}>
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
                      <TableCell className="font-mono text-xs" data-testid={`text-beid-${issue.issueId}`}>
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
                      <TableCell className="text-center text-xs" data-testid={`text-ccy-${issue.issueId}`}>
                        {issue.currency}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs" data-testid={`text-disclc-${issue.issueId}`}>
                        {formatCurrency(issue.discrepancyLocal)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-medium" data-testid={`text-discusd-${issue.issueId}`}>
                        {formatCurrency(issue.discrepancyUsd)}
                      </TableCell>
                      <TableCell>
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
                      <TableCell>
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
                          <div className="flex items-center gap-1 group">
                            <a
                              href={issue.workingsLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline truncate max-w-[80px]"
                              data-testid={`link-workings-${issue.issueId}`}
                            >
                              <ExternalLink className="h-3 w-3 inline mr-1" />
                              Sheet
                            </a>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => handleGenerateWorkings(issue.issueId)}
                              disabled={generatingWorkings === issue.issueId}
                              data-testid={`button-regenerate-workings-${issue.issueId}`}
                            >
                              {generatingWorkings === issue.issueId ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => handleGenerateWorkings(issue.issueId)}
                            disabled={generatingWorkings === issue.issueId}
                            data-testid={`button-generate-workings-${issue.issueId}`}
                          >
                            {generatingWorkings === issue.issueId ? (
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : (
                              <ExternalLink className="h-3 w-3 mr-1" />
                            )}
                            Generate
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>
                        <InlineSelectEdit
                          value={issue.issueStatus || ""}
                          options={[...issueStatuses]}
                          onSave={(val) => handleUpdateField(issue.issueId, "issueStatus", val)}
                          placeholder="Set status..."
                          issueId={issue.issueId}
                          field="issueStatus"
                        />
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
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
    </div>
  );
}
