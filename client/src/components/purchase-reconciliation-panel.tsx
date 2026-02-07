import { useMemo, useState, Fragment, useCallback, useEffect } from "react";
import { Calculator, TrendingUp, TrendingDown, ArrowRight, Minus, Plus, Wallet, Loader2, AlertCircle, ChevronDown, ChevronRight, FileWarning, AlertTriangle, Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PrimaryRow, VendorBalance } from "@shared/schema";

interface BookingForDispute {
  bookingId: string;
  spNet: number;
  hoNet: number;
  difference: number;
  reason: string;
}

interface PurchaseReconciliationPanelProps {
  primaryRows: PrimaryRow[];
  secondaryVendorRows?: PrimaryRow[]; // Include secondary vendor for complete SP Invoice total
  unmappedRows?: PrimaryRow[]; // SP Invoice rows with no HO match
  currency: string;
  billingEntityName: string;
  beId: string;
  onClose: () => void;
  fxRateToUsd?: number; // FX rate to convert from local currency to USD
  runId?: string | null; // Run ID for saving disputes and issues
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function PurchaseReconciliationPanel({
  primaryRows,
  secondaryVendorRows = [],
  unmappedRows = [],
  currency,
  billingEntityName,
  beId,
  onClose,
  fxRateToUsd,
  runId,
}: PurchaseReconciliationPanelProps) {
  const { toast } = useToast();
  
  // State for expanded rows (line items 10 and 11)
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  // State for expanded reason groups within rows 10 and 11
  const [expandedReasons, setExpandedReasons] = useState<Set<string>>(new Set());
  
  // Dispute tracking state
  const [activeDisputes, setActiveDisputes] = useState<Set<string>>(new Set());
  const [disputeAmounts, setDisputeAmounts] = useState<Map<string, number>>(new Map());
  const [disputesLoaded, setDisputesLoaded] = useState(false);
  
  // Modal for raising dispute
  const [disputeModalOpen, setDisputeModalOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<BookingForDispute | null>(null);
  const [disputeAmountInput, setDisputeAmountInput] = useState("");
  const [isSavingDispute, setIsSavingDispute] = useState(false);
  
  // Modal for flagging issue
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [issueBooking, setIssueBooking] = useState<BookingForDispute | null>(null);
  const [isSavingIssue, setIsSavingIssue] = useState(false);
  
  const effectiveFxRate = useMemo(() => {
    if (fxRateToUsd) return fxRateToUsd;
    if (currency === "USD") return 1;
    return null;
  }, [fxRateToUsd, currency]);
  
  // Load existing disputes when runId changes
  useEffect(() => {
    if (runId) {
      // Reset state when runId changes
      setActiveDisputes(new Set());
      setDisputeAmounts(new Map());
      
      fetch(`/api/disputes/${runId}`)
        .then(res => res.json())
        .then(data => {
          const disputes = data.disputes || [];
          const newActiveDisputes = new Set<string>();
          const newDisputeAmounts = new Map<string, number>();
          for (const d of disputes) {
            if (d.closureStatus === "open") {
              newActiveDisputes.add(d.bookingId);
              newDisputeAmounts.set(d.bookingId, d.disputeAmount);
            }
          }
          setActiveDisputes(newActiveDisputes);
          setDisputeAmounts(newDisputeAmounts);
          setDisputesLoaded(true);
        })
        .catch(err => {
          console.error("Failed to load existing disputes:", err);
          setDisputesLoaded(true);
        });
    } else {
      // No runId, clear state
      setActiveDisputes(new Set());
      setDisputeAmounts(new Map());
      setDisputesLoaded(false);
    }
  }, [runId]); // Only depend on runId, reload when it changes
  
  const toggleRowExpand = (rowId: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };
  
  const toggleReasonExpand = (key: string) => {
    setExpandedReasons(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };
  
  // Handler to open dispute modal for a booking
  const openDisputeModal = useCallback((booking: BookingForDispute) => {
    setSelectedBooking(booking);
    // Pre-fill with discrepancy amount (absolute value)
    setDisputeAmountInput(Math.abs(booking.difference).toFixed(2));
    setDisputeModalOpen(true);
  }, []);
  
  // Handler to save a dispute
  const handleSaveDispute = useCallback(async () => {
    if (!runId || !selectedBooking) return;
    
    const amount = parseFloat(disputeAmountInput);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid dispute amount greater than zero.",
        variant: "destructive",
      });
      return;
    }
    
    setIsSavingDispute(true);
    try {
      // Find the row in primary/secondary/unmapped to get ticket ID
      const allRows = [...primaryRows, ...secondaryVendorRows, ...unmappedRows];
      const bookingRow = allRows.find(r => r.bookingId === selectedBooking.bookingId);
      
      await apiRequest("POST", `/api/disputes/${runId}`, {
        bookingId: selectedBooking.bookingId,
        billingEntityId: beId,
        billingEntityName: billingEntityName,
        ticketId: bookingRow?.ticketId || "",
        tid: bookingRow?.tid || "",
        currency: currency,
        disputeAmount: amount,
        maxDisputeAmount: Math.abs(selectedBooking.difference),
        reconciledNet: Math.abs(selectedBooking.hoNet),
        status: "pending",
        closureStatus: "open",
      });
      
      // Update local state
      setActiveDisputes(prev => {
        const next = new Set(prev);
        next.add(selectedBooking.bookingId);
        return next;
      });
      setDisputeAmounts(prev => {
        const next = new Map(prev);
        next.set(selectedBooking.bookingId, amount);
        return next;
      });
      
      toast({
        title: "Dispute Raised",
        description: `Dispute for ${amount.toFixed(2)} ${currency} raised for booking ${selectedBooking.bookingId}.`,
      });
      
      // Invalidate disputes query
      queryClient.invalidateQueries({ queryKey: [`/api/disputes/${runId}`] });
      
      setDisputeModalOpen(false);
      setSelectedBooking(null);
      setDisputeAmountInput("");
    } catch (error) {
      console.error("Failed to save dispute:", error);
      toast({
        title: "Error",
        description: "Failed to save dispute. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingDispute(false);
    }
  }, [runId, selectedBooking, disputeAmountInput, beId, billingEntityName, currency, primaryRows, secondaryVendorRows, unmappedRows, toast]);
  
  // Handler to open issue modal
  const openIssueModal = useCallback((booking: BookingForDispute) => {
    setIssueBooking(booking);
    setIssueModalOpen(true);
  }, []);
  
  // Handler to flag issue
  const handleFlagIssue = useCallback(async () => {
    if (!runId || !issueBooking) return;
    
    setIsSavingIssue(true);
    try {
      // Find the row in primary/secondary/unmapped to get TID and ticketId
      const allRows = [...primaryRows, ...secondaryVendorRows, ...unmappedRows];
      const bookingRow = allRows.find(r => r.bookingId === issueBooking.bookingId);
      
      // Determine DRI team based on reason
      let driTeam = "Finance";
      if (issueBooking.reason.includes("Cancelled")) {
        driTeam = "Operations";
      } else if (issueBooking.reason.includes("NPD") || issueBooking.reason.includes("MTB")) {
        driTeam = "Supplier Management";
      }
      
      const fxRate = effectiveFxRate || 1;
      
      await apiRequest("POST", `/api/issues`, {
        runId,
        createdDate: new Date().toISOString(),
        billingEntityId: beId,
        billingEntityName: billingEntityName,
        currency: currency,
        discrepancyLocal: issueBooking.difference,
        discrepancyUsd: issueBooking.difference * fxRate,
        reason: issueBooking.reason,
        driTeam: driTeam,
        bookingIds: [issueBooking.bookingId],
        ticketId: bookingRow?.ticketId || "",
        tid: bookingRow?.tid || "",
      });
      
      toast({
        title: "Issue Flagged",
        description: `Issue created for booking ${issueBooking.bookingId}. Check Issue Tracker for details.`,
      });
      
      // Invalidate issues query
      queryClient.invalidateQueries({ queryKey: [`/api/issues/${runId}`] });
      
      setIssueModalOpen(false);
      setIssueBooking(null);
    } catch (error) {
      console.error("Failed to flag issue:", error);
      toast({
        title: "Error",
        description: "Failed to flag issue. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingIssue(false);
    }
  }, [runId, issueBooking, beId, billingEntityName, currency, effectiveFxRate, primaryRows, secondaryVendorRows, unmappedRows, toast]);
  
  // Remove dispute handler
  const handleRemoveDispute = useCallback(async (bookingId: string) => {
    if (!runId) return;
    
    try {
      await apiRequest("DELETE", `/api/disputes/${runId}/${bookingId}`);
      
      setActiveDisputes(prev => {
        const next = new Set(prev);
        next.delete(bookingId);
        return next;
      });
      setDisputeAmounts(prev => {
        const next = new Map(prev);
        next.delete(bookingId);
        return next;
      });
      
      toast({
        title: "Dispute Removed",
        description: `Dispute for booking ${bookingId} has been removed.`,
      });
      
      queryClient.invalidateQueries({ queryKey: [`/api/disputes/${runId}`] });
    } catch (error) {
      console.error("Failed to remove dispute:", error);
      toast({
        title: "Error",
        description: "Failed to remove dispute. Please try again.",
        variant: "destructive",
      });
    }
  }, [runId, toast]);
  
  // Combine all rows for complete SP Invoice calculations (primary + secondary + unmapped)
  const allRows = useMemo(() => [...primaryRows, ...secondaryVendorRows, ...unmappedRows], [primaryRows, secondaryVendorRows, unmappedRows]);
  const { data: balanceData, isLoading: isLoadingBalance } = useQuery<{ balance: VendorBalance | null }>({
    queryKey: ['/api/vendor-balances', beId],
    enabled: !!beId,
  });

  const balance = balanceData?.balance;
  const hasBalance = !!balance;

  const calculations = useMemo(() => {
    const openingBalance = balance?.openingBalance ?? 0;
    const reloads = balance?.reloads ?? 0;
    const closingBalance = balance?.closingBalance ?? 0;
    
    // Refunds: All negative SP values from entire SP Invoice (primary + secondary)
    const refunds = allRows
      .filter(row => row.spNetInHo < 0)
      .reduce((sum, row) => sum + row.spNetInHo, 0);
    
    const computedPurchase = openingBalance + reloads + refunds - closingBalance;
    
    // Actual Purchase: Total from entire SP Invoice data (primary + secondary)
    const actualPurchase = allRows.reduce((sum, row) => sum + row.spNetInHo, 0);
    
    const timingDifference = computedPurchase - actualPurchase;
    
    // Purchases as per HO: Only primary vendor fulfillments (HO Net)
    const purchasesAsPerHO = primaryRows
      .filter(row => !row.isSecondaryVendor)
      .reduce((sum, row) => sum + row.hoNet, 0);
    
    const difference = purchasesAsPerHO - actualPurchase;
    
    // In SP not in HO: From all rows where SP Net > HO Net
    const inSPNotInHO = allRows
      .filter(row => row.spNetInHo > row.hoNet)
      .reduce((sum, row) => sum + (row.spNetInHo - row.hoNet), 0);
    
    // In HO not in SP: From all rows where HO Net > SP Net
    const inHONotInSP = allRows
      .filter(row => row.hoNet > row.spNetInHo)
      .reduce((sum, row) => sum + (row.hoNet - row.spNetInHo), 0);

    const netDifference = difference + inSPNotInHO - inHONotInSP;
    
    // Breakup data for row 10: In SP not in HO (grouped by reason)
    const row10ByReason = new Map<string, { bookingId: string; spNet: number; hoNet: number; difference: number; reason: string }[]>();
    allRows
      .filter(row => row.spNetInHo > row.hoNet)
      .forEach(row => {
        const reason = row.reason || "Unknown";
        if (!row10ByReason.has(reason)) {
          row10ByReason.set(reason, []);
        }
        row10ByReason.get(reason)!.push({
          bookingId: row.bookingId,
          spNet: row.spNetInHo,
          hoNet: row.hoNet,
          difference: row.spNetInHo - row.hoNet,
          reason,
        });
      });
    
    // Convert to array and sort by total discrepancy
    const row10Breakup = Array.from(row10ByReason.entries())
      .map(([reason, bookings]) => ({
        reason,
        bookings: bookings.sort((a, b) => b.difference - a.difference),
        totalDifference: bookings.reduce((sum, b) => sum + b.difference, 0),
        count: bookings.length,
      }))
      .sort((a, b) => b.totalDifference - a.totalDifference);
    
    // Breakup data for row 11: In HO not in SP (grouped by reason)
    const row11ByReason = new Map<string, { bookingId: string; spNet: number; hoNet: number; difference: number; reason: string }[]>();
    allRows
      .filter(row => row.hoNet > row.spNetInHo)
      .forEach(row => {
        const reason = row.reason || "Unknown";
        if (!row11ByReason.has(reason)) {
          row11ByReason.set(reason, []);
        }
        row11ByReason.get(reason)!.push({
          bookingId: row.bookingId,
          spNet: row.spNetInHo,
          hoNet: row.hoNet,
          difference: row.hoNet - row.spNetInHo,
          reason,
        });
      });
    
    // Convert to array and sort by total discrepancy
    const row11Breakup = Array.from(row11ByReason.entries())
      .map(([reason, bookings]) => ({
        reason,
        bookings: bookings.sort((a, b) => b.difference - a.difference),
        totalDifference: bookings.reduce((sum, b) => sum + b.difference, 0),
        count: bookings.length,
      }))
      .sort((a, b) => b.totalDifference - a.totalDifference);

    return {
      openingBalance,
      reloads,
      refunds,
      closingBalance,
      computedPurchase,
      actualPurchase,
      timingDifference,
      purchasesAsPerHO,
      difference,
      inSPNotInHO,
      inHONotInSP,
      netDifference,
      row10Breakup,
      row11Breakup,
    };
  }, [allRows, primaryRows, balance]);

  const lineItems = [
    {
      id: 1,
      label: "Opening Balance",
      value: calculations.openingBalance,
      description: hasBalance ? "From database" : "Not configured",
      icon: Wallet,
      isFromDb: true,
    },
    {
      id: 2,
      label: "Reloads",
      value: calculations.reloads,
      description: hasBalance ? "From database" : "Not configured",
      icon: Plus,
      isFromDb: true,
    },
    {
      id: 3,
      label: "Refunds",
      value: calculations.refunds,
      description: "SP Invoice negative values",
      icon: Minus,
    },
    {
      id: 4,
      label: "Closing Balance",
      value: calculations.closingBalance,
      description: hasBalance ? "From database" : "Not configured",
      icon: Wallet,
      isFromDb: true,
    },
    {
      id: 5,
      label: "Computed Purchase",
      value: calculations.computedPurchase,
      description: "= 1 + 2 + 3 - 4",
      icon: Calculator,
      isFormula: true,
    },
    {
      id: 6,
      label: "Actual Purchase",
      value: calculations.actualPurchase,
      description: "Total from SP Invoice data",
      icon: TrendingUp,
    },
    {
      id: 7,
      label: "Timing Difference in Closing Balance",
      value: calculations.timingDifference,
      description: "= 5 - 6",
      icon: ArrowRight,
      isFormula: true,
    },
    {
      id: 8,
      label: "Purchases as per HO",
      value: calculations.purchasesAsPerHO,
      description: "Total of primary fulfillments (HO Net)",
      icon: TrendingUp,
    },
    {
      id: 9,
      label: "Difference",
      value: calculations.difference,
      description: "= 8 - 6",
      icon: ArrowRight,
      isFormula: true,
      isHighlight: true,
    },
    {
      id: 10,
      label: "In SP data not in HO",
      value: calculations.inSPNotInHO,
      description: "Sum where SP Net > HO Net",
      icon: TrendingDown,
      isReco: true,
    },
    {
      id: 11,
      label: "In HO data not in SP",
      value: calculations.inHONotInSP,
      description: "Sum where HO Net > SP Net",
      icon: TrendingUp,
      isReco: true,
    },
    {
      id: 12,
      label: "Net Difference",
      value: calculations.netDifference,
      description: "= 9 + 10 - 11 (should be 0)",
      icon: Calculator,
      isFormula: true,
      isValidation: true,
    },
  ];

  if (!beId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
          <Wallet className="h-5 w-5 text-amber-600" />
          <span className="text-amber-800 dark:text-amber-200">
            No Billing Entity ID available. Cannot load balance data.
          </span>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="button-close-purchase-reco">
            Close
          </Button>
        </div>
      </div>
    );
  }

  if (isLoadingBalance) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading balances...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-primary" />
          <span className="font-semibold">Purchase Reconciliation</span>
          <Badge variant="outline" className="text-xs">
            {currency}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            PORTAL_DEPOSIT
          </Badge>
          {beId && (
            <Badge variant="outline" className="text-xs font-mono">
              BE: {beId}
            </Badge>
          )}
        </div>
      </div>

      {!hasBalance && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <span className="text-sm text-amber-800 dark:text-amber-200">
            No balances configured for this BE ID. Upload balances from the home page to enable accurate calculations.
          </span>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <span>{billingEntityName || "Supplier"}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="h-8">
                <TableHead className="py-1.5 text-xs w-8">#</TableHead>
                <TableHead className="py-1.5 text-xs">Line Item</TableHead>
                <TableHead className="py-1.5 text-xs text-right">Amount ({currency})</TableHead>
                <TableHead className="py-1.5 text-xs text-right">Amount (USD)</TableHead>
                <TableHead className="py-1.5 text-xs">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.map((item) => {
                const IconComponent = item.icon;
                const isNegative = item.value < 0;
                const isPositive = item.value > 0;
                const usdValue = effectiveFxRate ? item.value * effectiveFxRate : null;
                const isUsdNegative = usdValue !== null && usdValue < 0;
                const isUsdPositive = usdValue !== null && usdValue > 0;
                const breakupData = item.id === 10 ? calculations.row10Breakup : item.id === 11 ? calculations.row11Breakup : [];
                const hasBreakup = (item.id === 10 || item.id === 11) && breakupData.length > 0;
                const isExpanded = expandedRows.has(item.id);
                
                return (
                  <Fragment key={item.id}>
                    <TableRow 
                      className={`h-10 ${item.isHighlight ? "bg-primary/5" : ""} ${item.isReco ? "bg-muted/50" : ""} ${item.isValidation ? (item.value === 0 ? "bg-green-50 dark:bg-green-950/30 border-t-2 border-green-200 dark:border-green-800" : "bg-red-50 dark:bg-red-950/30 border-t-2 border-red-200 dark:border-red-800") : ""} ${hasBreakup ? "cursor-pointer hover-elevate" : ""}`}
                      data-testid={`purchase-reco-row-${item.id}`}
                      onClick={hasBreakup ? () => toggleRowExpand(item.id) : undefined}
                    >
                      <TableCell className="py-2 font-mono text-xs text-muted-foreground">
                        {item.id}
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex items-center gap-2">
                          {hasBreakup && (
                            isExpanded ? <ChevronDown className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                          <IconComponent className={`h-4 w-4 ${item.isFormula ? "text-blue-500" : "text-muted-foreground"}`} />
                          <span className={`${item.isHighlight ? "font-semibold" : ""}`}>
                            {item.label}
                          </span>
                          {item.isFromDb && !hasBalance && (
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                              Not set
                            </Badge>
                          )}
                          {hasBreakup && (
                            <Badge variant="secondary" className="text-xs">
                              {breakupData.length} items
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className={`py-2 text-right font-mono ${isNegative ? "text-red-600 dark:text-red-400" : isPositive && item.isHighlight ? "text-green-600 dark:text-green-400" : ""}`}>
                        {formatNumber(item.value)}
                      </TableCell>
                      <TableCell className={`py-2 text-right font-mono ${isUsdNegative ? "text-red-600 dark:text-red-400" : isUsdPositive && item.isHighlight ? "text-green-600 dark:text-green-400" : ""}`}>
                        {usdValue !== null ? formatNumber(usdValue) : "-"}
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">
                        {item.description}
                        {hasBreakup && <span className="ml-1 text-primary">(click to expand)</span>}
                      </TableCell>
                    </TableRow>
                    {hasBreakup && isExpanded && (
                      <TableRow className="bg-muted/30">
                        <TableCell colSpan={5} className="py-3 px-8">
                          <div className="space-y-2">
                            {breakupData.map((reasonGroup, groupIdx) => {
                              const reasonKey = `${item.id}-${reasonGroup.reason}`;
                              const isReasonExpanded = expandedReasons.has(reasonKey);
                              return (
                                <div key={`${item.id}-reason-${groupIdx}`} className="rounded-md border bg-background overflow-hidden">
                                  <div 
                                    className="flex items-center justify-between px-3 py-2 bg-muted/50 cursor-pointer hover-elevate"
                                    onClick={() => toggleReasonExpand(reasonKey)}
                                    data-testid={`reason-header-${item.id}-${groupIdx}`}
                                  >
                                    <div className="flex items-center gap-2">
                                      {isReasonExpanded ? (
                                        <ChevronDown className="h-4 w-4 text-primary" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                      )}
                                      <span className="font-medium text-sm">{reasonGroup.reason}</span>
                                      <Badge variant="secondary" className="text-xs">{reasonGroup.count} items</Badge>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs">
                                      <span className="text-muted-foreground">Total:</span>
                                      <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                                        {formatNumber(reasonGroup.totalDifference)} {currency}
                                      </span>
                                    </div>
                                  </div>
                                  {isReasonExpanded && (
                                    <Table className="text-xs">
                                      <TableHeader>
                                        <TableRow className="h-7">
                                          <TableHead className="py-1 text-xs">Booking ID</TableHead>
                                          <TableHead className="py-1 text-xs text-right">SP Net ({currency})</TableHead>
                                          <TableHead className="py-1 text-xs text-right">HO Net ({currency})</TableHead>
                                          <TableHead className="py-1 text-xs text-right">Difference ({currency})</TableHead>
                                          {runId && <TableHead className="py-1 text-xs text-center">Actions</TableHead>}
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {reasonGroup.bookings.map((booking, bookingIdx) => {
                                          const hasDispute = activeDisputes.has(booking.bookingId);
                                          const disputeAmount = disputeAmounts.get(booking.bookingId);
                                          return (
                                            <TableRow key={`${item.id}-booking-${groupIdx}-${bookingIdx}`} className={`h-8 ${hasDispute ? "bg-amber-50/50 dark:bg-amber-950/20" : ""}`}>
                                              <TableCell className="py-1 font-mono">
                                                <div className="flex items-center gap-1">
                                                  {booking.bookingId}
                                                  {hasDispute && (
                                                    <Badge variant="outline" className="text-[10px] px-1 py-0 text-amber-600 border-amber-300">
                                                      Dispute: {disputeAmount?.toFixed(2)}
                                                    </Badge>
                                                  )}
                                                </div>
                                              </TableCell>
                                              <TableCell className="py-1 text-right font-mono">{formatNumber(booking.spNet)}</TableCell>
                                              <TableCell className="py-1 text-right font-mono">{formatNumber(booking.hoNet)}</TableCell>
                                              <TableCell className="py-1 text-right font-mono text-amber-600 dark:text-amber-400">
                                                {formatNumber(booking.difference)}
                                              </TableCell>
                                              {runId && (
                                                <TableCell className="py-1">
                                                  <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                                                    {hasDispute ? (
                                                      <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-xs text-red-600"
                                                        onClick={() => handleRemoveDispute(booking.bookingId)}
                                                        data-testid={`button-remove-dispute-${booking.bookingId}`}
                                                      >
                                                        <X className="h-3 w-3 mr-1" />
                                                        Remove
                                                      </Button>
                                                    ) : (
                                                      <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-xs text-amber-600"
                                                        onClick={() => openDisputeModal({
                                                          bookingId: booking.bookingId,
                                                          spNet: booking.spNet,
                                                          hoNet: booking.hoNet,
                                                          difference: booking.difference,
                                                          reason: reasonGroup.reason,
                                                        })}
                                                        data-testid={`button-raise-dispute-${booking.bookingId}`}
                                                      >
                                                        <FileWarning className="h-3 w-3 mr-1" />
                                                        Dispute
                                                      </Button>
                                                    )}
                                                    <Button
                                                      size="sm"
                                                      variant="ghost"
                                                      className="text-xs text-blue-600"
                                                      onClick={() => openIssueModal({
                                                        bookingId: booking.bookingId,
                                                        spNet: booking.spNet,
                                                        hoNet: booking.hoNet,
                                                        difference: booking.difference,
                                                        reason: reasonGroup.reason,
                                                      })}
                                                      data-testid={`button-flag-issue-${booking.bookingId}`}
                                                    >
                                                      <AlertTriangle className="h-3 w-3 mr-1" />
                                                      Issue
                                                    </Button>
                                                  </div>
                                                </TableCell>
                                              )}
                                            </TableRow>
                                          );
                                        })}
                                      </TableBody>
                                    </Table>
                                  )}
                                </div>
                              );
                            })}
                            <div className="flex items-center justify-end gap-3 pt-2 border-t text-sm">
                              <span className="text-muted-foreground">Grand Total ({breakupData.reduce((sum, g) => sum + g.count, 0)} items):</span>
                              <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                                {formatNumber(breakupData.reduce((sum, g) => sum + g.totalDifference, 0))} {currency}
                              </span>
                              {effectiveFxRate && (
                                <span className="font-mono text-muted-foreground">
                                  ({formatNumber(breakupData.reduce((sum, g) => sum + g.totalDifference, 0) * effectiveFxRate)} USD)
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>

          <Separator className="my-4" />

          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Reconciliation Summary:</span>
              <Badge variant={calculations.netDifference === 0 ? "default" : "destructive"}>
                {calculations.netDifference === 0 ? "Balanced" : "Unbalanced"}
              </Badge>
              {effectiveFxRate && effectiveFxRate !== 1 && (
                <Badge variant="outline" className="text-xs">
                  FX Rate: {effectiveFxRate.toFixed(6)}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <span className="text-xs text-muted-foreground">Net Difference (Line 12)</span>
                <p className={`font-mono font-semibold ${calculations.netDifference !== 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                  {formatNumber(calculations.netDifference)} {currency}
                  {effectiveFxRate && (
                    <span className="text-xs text-muted-foreground ml-2">
                      ({formatNumber(calculations.netDifference * effectiveFxRate)} USD)
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end pt-2">
        <Button variant="outline" size="sm" onClick={onClose} data-testid="button-close-purchase-reco">
          Close
        </Button>
      </div>
      
      {/* Raise Dispute Modal */}
      <Dialog open={disputeModalOpen} onOpenChange={setDisputeModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileWarning className="h-5 w-5 text-amber-600" />
              Raise Dispute
            </DialogTitle>
            <DialogDescription>
              Create a dispute for this booking that will appear in the Dispute Tracker.
            </DialogDescription>
          </DialogHeader>
          {selectedBooking && (
            <div className="space-y-4">
              <div className="rounded-md border p-3 bg-muted/50 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Booking ID:</span>
                  <span className="font-mono font-medium">{selectedBooking.bookingId}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Reason:</span>
                  <Badge variant="outline" className="text-xs">{selectedBooking.reason}</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">SP Net:</span>
                  <span className="font-mono">{formatNumber(selectedBooking.spNet)} {currency}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">HO Net:</span>
                  <span className="font-mono">{formatNumber(selectedBooking.hoNet)} {currency}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Difference:</span>
                  <span className="font-mono text-amber-600 font-semibold">{formatNumber(selectedBooking.difference)} {currency}</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Dispute Amount ({currency})</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={disputeAmountInput}
                  onChange={(e) => setDisputeAmountInput(e.target.value)}
                  placeholder="Enter dispute amount"
                  data-testid="input-dispute-amount"
                />
                <p className="text-xs text-muted-foreground">
                  Max dispute: {formatNumber(Math.abs(selectedBooking.difference))} {currency}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDisputeModalOpen(false);
                setSelectedBooking(null);
                setDisputeAmountInput("");
              }}
              data-testid="button-cancel-dispute"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveDispute}
              disabled={isSavingDispute}
              data-testid="button-submit-dispute"
            >
              {isSavingDispute ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Raise Dispute
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Flag Issue Modal */}
      <Dialog open={issueModalOpen} onOpenChange={setIssueModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-blue-600" />
              Flag Issue
            </DialogTitle>
            <DialogDescription>
              Create an issue for this booking that will appear in the Issue Tracker.
            </DialogDescription>
          </DialogHeader>
          {issueBooking && (
            <div className="space-y-4">
              <div className="rounded-md border p-3 bg-muted/50 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Booking ID:</span>
                  <span className="font-mono font-medium">{issueBooking.bookingId}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Reason:</span>
                  <Badge variant="outline" className="text-xs">{issueBooking.reason}</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Discrepancy ({currency}):</span>
                  <span className="font-mono text-amber-600 font-semibold">{formatNumber(issueBooking.difference)}</span>
                </div>
                {effectiveFxRate && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Discrepancy (USD):</span>
                    <span className="font-mono text-muted-foreground">{formatNumber(issueBooking.difference * effectiveFxRate)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Billing Entity:</span>
                  <span className="font-medium">{billingEntityName}</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                This issue will be assigned to the appropriate DRI team based on the reason classification.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIssueModalOpen(false);
                setIssueBooking(null);
              }}
              data-testid="button-cancel-issue"
            >
              Cancel
            </Button>
            <Button
              onClick={handleFlagIssue}
              disabled={isSavingIssue}
              data-testid="button-submit-issue"
            >
              {isSavingIssue ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Flag Issue
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
