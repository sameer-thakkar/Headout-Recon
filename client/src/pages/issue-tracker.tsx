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
import { Button } from "@/components/ui/button";
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
import { AlertTriangle, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

export function IssueTrackerPage({ runId }: IssueTrackerPageProps) {
  const { toast } = useToast();
  const [deletingIssueId, setDeletingIssueId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ issues: IssueRecord[] }>({
    queryKey: [`/api/issues/${runId}`],
    enabled: !!runId,
  });

  const issues = data?.issues || [];

  const handleDeleteIssue = async (issueId: string) => {
    setDeletingIssueId(issueId);
    try {
      await apiRequest("DELETE", `/api/issues/${issueId}`);
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

  const totals = useMemo(() => {
    return issues.reduce(
      (acc, issue) => ({
        discrepancyLocal: acc.discrepancyLocal + issue.discrepancyLocal,
        discrepancyUsd: acc.discrepancyUsd + issue.discrepancyUsd,
      }),
      { discrepancyLocal: 0, discrepancyUsd: 0 }
    );
  }, [issues]);

  if (!runId) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[400px]">
        <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-medium mb-2">No Reconciliation Run Selected</h2>
        <p className="text-muted-foreground text-center">
          Upload files and run reconciliation to start tracking issues.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Loading issues...</p>
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[400px]">
        <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-medium mb-2">No Issues Logged</h2>
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
          <h1 className="text-2xl font-semibold">Issue Tracker</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track discrepancies logged as issues at the DRI-Discrepancy level
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">{issues.length} issue{issues.length !== 1 ? "s" : ""}</p>
          <p className="font-mono text-sm font-medium">
            Total: ${formatCurrency(totals.discrepancyUsd)} USD
          </p>
        </div>
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
                  <TableHead className="w-24">Issue ID</TableHead>
                  <TableHead className="w-28">Created Date</TableHead>
                  <TableHead className="w-28">BE ID</TableHead>
                  <TableHead>BE Name</TableHead>
                  <TableHead className="w-20 text-center">Currency</TableHead>
                  <TableHead className="w-32 text-right">Disc. Local</TableHead>
                  <TableHead className="w-32 text-right">Disc. USD</TableHead>
                  <TableHead className="w-40">Reason</TableHead>
                  <TableHead className="w-28">DRI Team</TableHead>
                  <TableHead className="w-16 text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issues.map((issue) => (
                  <TableRow key={issue.issueId} data-testid={`row-issue-${issue.issueId}`}>
                    <TableCell className="font-mono text-xs font-medium">
                      {issue.issueId}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(issue.createdDate)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {issue.billingEntityId}
                    </TableCell>
                    <TableCell className="text-xs truncate max-w-[200px]" title={issue.billingEntityName}>
                      {issue.billingEntityName}
                    </TableCell>
                    <TableCell className="text-center text-xs">
                      {issue.currency}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatCurrency(issue.discrepancyLocal)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium">
                      {formatCurrency(issue.discrepancyUsd)}
                    </TableCell>
                    <TableCell className="text-xs truncate max-w-[160px]" title={issue.reason}>
                      {issue.reason}
                    </TableCell>
                    <TableCell className="text-xs">
                      {issue.driTeam}
                    </TableCell>
                    <TableCell className="text-center">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
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
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
