import { useState, useEffect } from "react";
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
import { FileWarning, AlertCircle } from "lucide-react";

interface DisputeRecord {
  disputeId: string;
  billingEntityId: string;
  billingEntityName: string;
  currency: string;
  disputeAmount: number;
  status: "pending" | "submitted" | "resolved" | "rejected";
}

interface DisputeTrackerPageProps {
  runId: string | null;
}

export function DisputeTrackerPage({ runId }: DisputeTrackerPageProps) {
  const { data, isLoading, error } = useQuery<{ disputes: DisputeRecord[] }>({
    queryKey: [`/api/disputes/${runId}`],
    enabled: !!runId,
  });

  const disputes = data?.disputes || [];

  const formatCurrency = (amount: number, currency: string = "USD") => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const getStatusBadge = (status: DisputeRecord["status"]) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary" data-testid={`badge-status-pending`}>Pending</Badge>;
      case "submitted":
        return <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" data-testid={`badge-status-submitted`}>Submitted</Badge>;
      case "resolved":
        return <Badge className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20" data-testid={`badge-status-resolved`}>Resolved</Badge>;
      case "rejected":
        return <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" data-testid={`badge-status-rejected`}>Rejected</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (!runId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Reconciliation Run Selected</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Please run a reconciliation first to view disputes. Go to the Reconciliation page to upload files and run the reconciliation process.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <span className="ml-3">Loading disputes...</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <FileWarning className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold" data-testid="text-dispute-tracker-title">Dispute Tracker</h1>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            Active Disputes
            <Badge variant="secondary" className="ml-2" data-testid="badge-dispute-count">
              {disputes.length} disputes
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {disputes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileWarning className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>No disputes recorded yet.</p>
              <p className="text-sm mt-1">Disputes created in the Amount Payable Calculator will appear here.</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold" data-testid="header-dispute-id">Dispute ID</TableHead>
                    <TableHead className="font-semibold" data-testid="header-billing-entity-id">Billing Entity ID</TableHead>
                    <TableHead className="font-semibold" data-testid="header-billing-entity-name">Billing Entity Name</TableHead>
                    <TableHead className="font-semibold" data-testid="header-currency">Currency</TableHead>
                    <TableHead className="font-semibold text-right" data-testid="header-dispute-amount">Dispute Amount</TableHead>
                    <TableHead className="font-semibold text-center" data-testid="header-status">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {disputes.map((dispute) => (
                    <TableRow key={dispute.disputeId} data-testid={`row-dispute-${dispute.disputeId}`}>
                      <TableCell className="font-mono text-sm" data-testid={`cell-dispute-id-${dispute.disputeId}`}>
                        {dispute.disputeId}
                      </TableCell>
                      <TableCell className="font-mono text-sm" data-testid={`cell-billing-entity-id-${dispute.disputeId}`}>
                        {dispute.billingEntityId || "-"}
                      </TableCell>
                      <TableCell data-testid={`cell-billing-entity-name-${dispute.disputeId}`}>
                        {dispute.billingEntityName || "-"}
                      </TableCell>
                      <TableCell className="font-mono" data-testid={`cell-currency-${dispute.disputeId}`}>
                        {dispute.currency}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium text-orange-600 dark:text-orange-400" data-testid={`cell-dispute-amount-${dispute.disputeId}`}>
                        {formatCurrency(dispute.disputeAmount, dispute.currency)}
                      </TableCell>
                      <TableCell className="text-center" data-testid={`cell-status-${dispute.disputeId}`}>
                        {getStatusBadge(dispute.status)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
