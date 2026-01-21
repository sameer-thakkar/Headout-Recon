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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FileWarning, AlertCircle, ChevronRight, XCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface DisputeRecord {
  disputeId: string;
  bookingId: string;
  billingEntityId: string;
  billingEntityName: string;
  ticketId?: string;
  currency: string;
  disputeAmount: number;
  maxDisputeAmount: number;
  status: "pending" | "submitted" | "resolved" | "rejected";
  createdAt: string;
  closureStatus: "open" | "closed";
  closureType?: "adjustment" | "manual_writeoff";
  closureNote?: string;
  closedAt?: string;
  closedByAdjustmentAmount?: number;
}

interface AggregatedDispute {
  displayId: string;
  billingEntityId: string;
  billingEntityName: string;
  currency: string;
  totalDisputeAmount: number;
  bookingCount: number;
  disputes: DisputeRecord[];
  actualDisputeIds: string[];
  status: "pending" | "submitted" | "resolved" | "rejected";
  closureStatus: "open" | "closed";
  closureType?: "adjustment" | "manual_writeoff";
  closureNote?: string;
  closedAt?: string;
  closedByAdjustmentAmount?: number;
}

interface DisputeTrackerPageProps {
  runId: string | null;
}

export function DisputeTrackerPage({ runId }: DisputeTrackerPageProps) {
  const [selectedDispute, setSelectedDispute] = useState<AggregatedDispute | null>(null);
  const [writeOffDispute, setWriteOffDispute] = useState<AggregatedDispute | null>(null);
  const [writeOffNote, setWriteOffNote] = useState("");
  const [isWritingOff, setIsWritingOff] = useState(false);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ disputes: DisputeRecord[] }>({
    queryKey: [`/api/disputes/${runId}`],
    enabled: !!runId,
  });

  const disputes = data?.disputes || [];

  const handleWriteOff = async () => {
    if (!writeOffDispute) return;
    
    setIsWritingOff(true);
    try {
      await apiRequest("POST", "/api/disputes/manual-close", {
        disputeIds: writeOffDispute.actualDisputeIds,
        note: writeOffNote || undefined,
      });
      
      toast({
        title: "Dispute Written Off",
        description: `${writeOffDispute.displayId} has been closed as a write-off.`,
      });
      
      await queryClient.invalidateQueries({ queryKey: [`/api/disputes/${runId}`] });
      setWriteOffDispute(null);
      setWriteOffNote("");
    } catch (error) {
      console.error("Write off error:", error);
      toast({
        title: "Error",
        description: "Failed to write off dispute. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsWritingOff(false);
    }
  };

  const aggregatedDisputes = useMemo(() => {
    const groupedByBillingEntity = new Map<string, DisputeRecord[]>();
    
    for (const dispute of disputes) {
      const key = `${dispute.billingEntityId}-${dispute.currency}`;
      if (!groupedByBillingEntity.has(key)) {
        groupedByBillingEntity.set(key, []);
      }
      groupedByBillingEntity.get(key)!.push(dispute);
    }

    const aggregated: AggregatedDispute[] = [];
    let counter = 1;

    for (const group of Array.from(groupedByBillingEntity.values())) {
      if (group.length === 0) continue;
      
      const first = group[0];
      const totalAmount = group.reduce((sum: number, d: DisputeRecord) => sum + d.disputeAmount, 0);
      
      const statuses = group.map((d: DisputeRecord) => d.status);
      let aggregatedStatus: AggregatedDispute["status"] = "pending";
      if (statuses.every((s: DisputeRecord["status"]) => s === "resolved")) {
        aggregatedStatus = "resolved";
      } else if (statuses.every((s: DisputeRecord["status"]) => s === "rejected")) {
        aggregatedStatus = "rejected";
      } else if (statuses.some((s: DisputeRecord["status"]) => s === "submitted")) {
        aggregatedStatus = "submitted";
      }

      // Determine closure status - closed if ALL disputes in group are closed
      const closureStatuses = group.map((d: DisputeRecord) => d.closureStatus || "open");
      const isAllClosed = closureStatuses.every((s) => s === "closed");
      const closedDispute = isAllClosed ? group.find(d => d.closedAt) : undefined;

      // Collect actual dispute IDs for API calls
      const actualIds = group.map((d: DisputeRecord) => d.disputeId);

      aggregated.push({
        displayId: `DID-#${counter}`,
        billingEntityId: first.billingEntityId,
        billingEntityName: first.billingEntityName,
        currency: first.currency,
        totalDisputeAmount: totalAmount,
        bookingCount: group.length,
        disputes: group,
        actualDisputeIds: actualIds,
        status: aggregatedStatus,
        closureStatus: isAllClosed ? "closed" : "open",
        closureType: closedDispute?.closureType,
        closureNote: closedDispute?.closureNote,
        closedAt: closedDispute?.closedAt,
        closedByAdjustmentAmount: closedDispute?.closedByAdjustmentAmount,
      });
      counter++;
    }

    return aggregated;
  }, [disputes]);

  // Indian numbering format: 1,00,000.00 with currency symbol
  const formatCurrency = (amount: number, currency: string = "USD") => {
    // Use Indian locale for grouping (lakhs/crores)
    const formatted = amount.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    // Add currency symbol
    const symbols: Record<string, string> = {
      USD: "$",
      EUR: "€",
      GBP: "£",
      INR: "₹",
    };
    return `${symbols[currency] || currency} ${formatted}`;
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

  const getClosureBadge = (closureStatus: "open" | "closed") => {
    if (closureStatus === "closed") {
      return <Badge className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" data-testid="badge-closure-closed">Closed</Badge>;
    }
    return <Badge variant="outline" data-testid="badge-closure-open">Open</Badge>;
  };

  // Separate open and closed disputes for display
  const openDisputes = aggregatedDisputes.filter(d => d.closureStatus === "open");
  const closedDisputes = aggregatedDisputes.filter(d => d.closureStatus === "closed");

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

      {/* Open Disputes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            Open Disputes
            <Badge variant="secondary" className="ml-2" data-testid="badge-open-dispute-count">
              {openDisputes.length} {openDisputes.length === 1 ? 'dispute' : 'disputes'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {openDisputes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileWarning className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>No open disputes.</p>
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
                    <TableHead className="font-semibold text-center" data-testid="header-bookings">Bookings</TableHead>
                    <TableHead className="font-semibold text-center" data-testid="header-status">Status</TableHead>
                    <TableHead className="font-semibold text-center" data-testid="header-actions">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openDisputes.map((dispute) => (
                    <TableRow 
                      key={dispute.displayId} 
                      data-testid={`row-dispute-${dispute.displayId}`}
                      className="hover-elevate cursor-pointer"
                      onClick={() => setSelectedDispute(dispute)}
                    >
                      <TableCell data-testid={`cell-dispute-id-${dispute.displayId}`}>
                        <Button 
                          variant="ghost" 
                          className="p-0 h-auto font-mono text-sm text-primary hover:underline hover:bg-transparent"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDispute(dispute);
                          }}
                          data-testid={`button-dispute-id-${dispute.displayId}`}
                        >
                          {dispute.displayId}
                          <ChevronRight className="h-3 w-3 ml-1" />
                        </Button>
                      </TableCell>
                      <TableCell className="font-mono text-sm" data-testid={`cell-billing-entity-id-${dispute.displayId}`}>
                        {dispute.billingEntityId || "-"}
                      </TableCell>
                      <TableCell data-testid={`cell-billing-entity-name-${dispute.displayId}`}>
                        {dispute.billingEntityName || "-"}
                      </TableCell>
                      <TableCell className="font-mono" data-testid={`cell-currency-${dispute.displayId}`}>
                        {dispute.currency}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium text-orange-600 dark:text-orange-400" data-testid={`cell-dispute-amount-${dispute.displayId}`}>
                        {formatCurrency(dispute.totalDisputeAmount, dispute.currency)}
                      </TableCell>
                      <TableCell className="text-center" data-testid={`cell-bookings-${dispute.displayId}`}>
                        <Badge variant="outline">{dispute.bookingCount}</Badge>
                      </TableCell>
                      <TableCell className="text-center" data-testid={`cell-status-${dispute.displayId}`}>
                        {getStatusBadge(dispute.status)}
                      </TableCell>
                      <TableCell className="text-center" data-testid={`cell-actions-${dispute.displayId}`}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-orange-600 hover:text-orange-700 border-orange-200 hover:border-orange-300 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-800 dark:hover:bg-orange-950"
                          onClick={(e) => {
                            e.stopPropagation();
                            setWriteOffDispute(dispute);
                          }}
                          data-testid={`button-writeoff-${dispute.displayId}`}
                        >
                          <XCircle className="h-3 w-3 mr-1" />
                          Write Off
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Closed Disputes */}
      {closedDisputes.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              Closed Disputes
              <Badge className="ml-2 bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" data-testid="badge-closed-dispute-count">
                {closedDisputes.length} {closedDisputes.length === 1 ? 'dispute' : 'disputes'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">Dispute ID</TableHead>
                    <TableHead className="font-semibold">Billing Entity Name</TableHead>
                    <TableHead className="font-semibold">Currency</TableHead>
                    <TableHead className="font-semibold text-right">Dispute Amount</TableHead>
                    <TableHead className="font-semibold text-center">Closure Type</TableHead>
                    <TableHead className="font-semibold text-right">Adjustment Used</TableHead>
                    <TableHead className="font-semibold text-center">Closed Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closedDisputes.map((dispute) => (
                    <TableRow 
                      key={dispute.displayId} 
                      data-testid={`row-closed-dispute-${dispute.displayId}`}
                      className="opacity-70 hover-elevate cursor-pointer"
                      onClick={() => setSelectedDispute(dispute)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{dispute.displayId}</span>
                          {getClosureBadge(dispute.closureStatus)}
                        </div>
                      </TableCell>
                      <TableCell>{dispute.billingEntityName || "-"}</TableCell>
                      <TableCell className="font-mono">{dispute.currency}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(dispute.totalDisputeAmount, dispute.currency)}
                      </TableCell>
                      <TableCell className="text-center">
                        {dispute.closureType === "adjustment" ? (
                          <Badge className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
                            Adjusted
                          </Badge>
                        ) : dispute.closureType === "manual_writeoff" ? (
                          <Badge className="bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20">
                            Written Off
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Unknown</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-green-600 dark:text-green-400">
                        {dispute.closureType === "adjustment" && dispute.closedByAdjustmentAmount !== undefined 
                          ? formatCurrency(dispute.closedByAdjustmentAmount, dispute.currency)
                          : "-"
                        }
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {dispute.closedAt 
                          ? new Date(dispute.closedAt).toLocaleDateString()
                          : "-"
                        }
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedDispute} onOpenChange={(open) => !open && setSelectedDispute(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileWarning className="h-5 w-5" />
              Dispute Details - {selectedDispute?.displayId}
            </DialogTitle>
          </DialogHeader>
          
          {selectedDispute && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">Billing Entity ID</p>
                  <p className="font-mono font-medium">{selectedDispute.billingEntityId || "-"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Billing Entity Name</p>
                  <p className="font-medium">{selectedDispute.billingEntityName || "-"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Currency</p>
                  <p className="font-mono font-medium">{selectedDispute.currency}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Dispute Amount</p>
                  <p className="font-mono font-medium text-orange-600 dark:text-orange-400">
                    {formatCurrency(selectedDispute.totalDisputeAmount, selectedDispute.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Bookings</p>
                  <p className="font-medium">{selectedDispute.bookingCount}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(selectedDispute.status)}
                    {getClosureBadge(selectedDispute.closureStatus)}
                  </div>
                </div>
                {selectedDispute.closureStatus === "closed" && (
                  <>
                    <div>
                      <p className="text-sm text-muted-foreground">Closure Type</p>
                      <div className="mt-1">
                        {selectedDispute.closureType === "adjustment" ? (
                          <Badge className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
                            Adjusted
                          </Badge>
                        ) : selectedDispute.closureType === "manual_writeoff" ? (
                          <Badge className="bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20">
                            Written Off
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Unknown</Badge>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Closed Date</p>
                      <p className="font-medium">
                        {selectedDispute.closedAt 
                          ? new Date(selectedDispute.closedAt).toLocaleDateString()
                          : "-"
                        }
                      </p>
                    </div>
                    {selectedDispute.closureType === "adjustment" && (
                      <div>
                        <p className="text-sm text-muted-foreground">Adjustment Amount Used</p>
                        <p className="font-mono font-medium text-green-600 dark:text-green-400">
                          {selectedDispute.closedByAdjustmentAmount !== undefined
                            ? formatCurrency(selectedDispute.closedByAdjustmentAmount, selectedDispute.currency)
                            : "-"
                          }
                        </p>
                      </div>
                    )}
                    {selectedDispute.closureType === "manual_writeoff" && selectedDispute.closureNote && (
                      <div className="col-span-2">
                        <p className="text-sm text-muted-foreground">Write-Off Note</p>
                        <p className="text-sm mt-1">{selectedDispute.closureNote}</p>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div>
                <h4 className="font-medium mb-2">Booking Details</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Individual booking disputes under this billing entity
                </p>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="font-semibold">Booking ID</TableHead>
                        <TableHead className="font-semibold">Ticket ID</TableHead>
                        <TableHead className="font-semibold text-right">Dispute Amount</TableHead>
                        <TableHead className="font-semibold text-center">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedDispute.disputes.map((d) => (
                        <TableRow key={d.bookingId}>
                          <TableCell className="font-mono text-sm">{d.bookingId}</TableCell>
                          <TableCell className="font-mono text-sm" data-testid={`text-ticket-id-${d.bookingId}`}>
                            {d.ticketId || "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-orange-600 dark:text-orange-400">
                            {formatCurrency(d.disputeAmount, d.currency)}
                          </TableCell>
                          <TableCell className="text-center">
                            {getStatusBadge(d.status)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Write Off Confirmation Dialog */}
      <Dialog open={!!writeOffDispute} onOpenChange={(open) => {
        if (!open) {
          setWriteOffDispute(null);
          setWriteOffNote("");
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600">
              <XCircle className="h-5 w-5" />
              Write Off Dispute
            </DialogTitle>
            <DialogDescription>
              This will close the dispute as a write-off (Headout loss). This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          
          {writeOffDispute && (
            <div className="space-y-4">
              <div className="p-4 bg-muted/30 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Dispute ID</span>
                  <span className="font-mono font-medium">{writeOffDispute.displayId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Billing Entity</span>
                  <span className="font-medium">{writeOffDispute.billingEntityName || "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Amount</span>
                  <span className="font-mono font-medium text-orange-600 dark:text-orange-400">
                    {formatCurrency(writeOffDispute.totalDisputeAmount, writeOffDispute.currency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Bookings</span>
                  <span className="font-medium">{writeOffDispute.bookingCount}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="writeoff-note">Note (optional)</Label>
                <Textarea
                  id="writeoff-note"
                  placeholder="e.g., SP rejected claim - Headout to absorb loss"
                  value={writeOffNote}
                  onChange={(e) => setWriteOffNote(e.target.value)}
                  className="min-h-[80px]"
                  data-testid="input-writeoff-note"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setWriteOffDispute(null);
                setWriteOffNote("");
              }}
              disabled={isWritingOff}
              data-testid="button-cancel-writeoff"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              className="bg-orange-600 hover:bg-orange-700 text-white"
              onClick={handleWriteOff}
              disabled={isWritingOff}
              data-testid="button-confirm-writeoff"
            >
              {isWritingOff ? "Writing Off..." : "Confirm Write Off"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
