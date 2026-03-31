import { useState, useCallback, useMemo, useEffect, lazy, Suspense } from "react";
import { authFetch } from "@/lib/queryClient";
import { Upload, FileSpreadsheet, X, Play, Download, ChevronRight, DollarSign, FileDown, Calculator, ChevronDown, ExternalLink, AlertTriangle, XCircle, Loader2, Check, Info } from "lucide-react";
import { SiGooglesheets } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DiscrepancySummaryWorkspace } from "@/components/discrepancy-summary-workspace";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Adjustment, BookingForPayable, FinalNetSelection } from "@/components/amount-payable-modal";
const AmountPayablePanel = lazy(() =>
  import("@/components/amount-payable-panel").then(m => ({ default: m.AmountPayablePanel }))
);
const PurchaseReconciliationPanel = lazy(() =>
  import("@/components/purchase-reconciliation-panel").then(m => ({ default: m.PurchaseReconciliationPanel }))
);
const CancellationsWorkspace = lazy(() =>
  import("@/components/cancellations-workspace").then(m => ({ default: m.CancellationsWorkspace }))
);
import { AlreadyReconciledWorkspace } from "@/components/already-reconciled-workspace";
import type { ArWorkspaceBooking } from "@/components/already-reconciled-workspace";
import type { UploadedFile, OverallSummaryRow, DiscrepancyAnalysisRow, PrimaryRow, FxData } from "@shared/schema";

interface UploadPageProps {
  onFilesUploaded: (files: File[], onProgress: (progress: number, stage: string) => void) => Promise<UploadedFile[]>;
  onLoadDemo: () => void;
  uploadedFiles: UploadedFile[];
  currentRunId: string | null;
  onExportAnalysisGSheet: () => Promise<{ spreadsheetUrl?: string }>;
  onReconciliationFinalized: () => void;
  analysisGSheetUrl: string | null;
  initialRunResult?: {
    overallSummary: OverallSummaryRow[];
    secondaryVendorSummary: OverallSummaryRow[];
    primaryRows: PrimaryRow[];
    secondaryVendorRows: PrimaryRow[];
    unmappedRows: PrimaryRow[];
    fx?: FxData;
  } | null;
}

function formatDateDDMMYYYY(value: unknown): string | null {
  if (!value) return null;
  
  const strValue = String(value);
  const numValue = Number(strValue);
  if (!isNaN(numValue) && numValue > 1000 && numValue < 100000) {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + numValue * 24 * 60 * 60 * 1000);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
  
  const dateStr = strValue.split("T")[0];
  const [year, month, day] = dateStr.split("-");
  if (year && month && day && year.length === 4) {
    return `${day}/${month}/${year}`;
  }
  
  return strValue;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function consolidateSummaryByReason(rows: OverallSummaryRow[]): OverallSummaryRow[] {
  const grouped = new Map<string, { currencies: Set<string>; discrepancyLc: number; discrepancyUsd: number; countBid: number }>();
  
  for (const row of rows) {
    const existing = grouped.get(row.reason);
    if (existing) {
      existing.currencies.add(row.currency);
      existing.discrepancyLc += row.discrepancyLc;
      existing.discrepancyUsd += row.discrepancyUsd;
      existing.countBid += row.countBid;
    } else {
      grouped.set(row.reason, {
        currencies: new Set([row.currency]),
        discrepancyLc: row.discrepancyLc,
        discrepancyUsd: row.discrepancyUsd,
        countBid: row.countBid,
      });
    }
  }
  
  return Array.from(grouped.entries()).map(([reason, data]) => ({
    reason,
    currency: data.currencies.size > 1 ? "Multiple currencies" : Array.from(data.currencies)[0],
    discrepancyLc: data.discrepancyLc,
    discrepancyUsd: data.discrepancyUsd,
    countBid: data.countBid,
  }));
}

export function UploadPage({ onFilesUploaded, onLoadDemo, uploadedFiles, currentRunId, onExportAnalysisGSheet, onReconciliationFinalized, analysisGSheetUrl, initialRunResult }: UploadPageProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>(uploadedFiles);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPayableCurrency, setSelectedPayableCurrency] = useState<string | null>(null);
  const [adjustmentsPerCurrency, setAdjustmentsPerCurrency] = useState<Record<string, Adjustment[]>>({});
  const [finalNetSelectionsPerCurrency, setFinalNetSelectionsPerCurrency] = useState<Record<string, FinalNetSelection>>({});
  const [isExportingGSheet, setIsExportingGSheet] = useState(false);
  const [isSummaryOpen, setIsSummaryOpen] = useState(true);
  const [isComputeOpen, setIsComputeOpen] = useState(false);
  // Already Reconciled workspace state (single-click analysis-first flow)
  const [isAlreadyReconciledDetailModalOpen, setIsAlreadyReconciledDetailModalOpen] = useState(false);
  const [selectedArAnalysisRow, setSelectedArAnalysisRow] = useState<{ type: "same_be" | "different_be"; previousBe: string | null } | null>(null);
  // Already Reconciled action states
  const [arDecisions, setArDecisions] = useState<Map<string, { decision: "pay" | "dont_pay"; reason: string; customReason: string; finalAmount: number }>>(new Map());
  const [arActiveDisputes, setArActiveDisputes] = useState<Set<string>>(new Set());
  const [arDisputeAmounts, setArDisputeAmounts] = useState<Map<string, number>>(new Map());
  // Cancellations modal state
  const [isCancellationsModalOpen, setIsCancellationsModalOpen] = useState(false);
  const { toast } = useToast();

  // Only use React Query if initialRunResult is not provided (e.g., loading a saved session)
  const { data: queryRunResult, isLoading: isQueryLoading, isError: isResultsError, error: resultsError } = useQuery<{
    overallSummary: OverallSummaryRow[];
    secondaryVendorSummary: OverallSummaryRow[];
    primaryRows: PrimaryRow[];
    secondaryVendorRows: PrimaryRow[];
    unmappedRows: PrimaryRow[];
    fx?: FxData;
  }>({
    queryKey: ["/api/runs", currentRunId, "results"],
    enabled: !!currentRunId && !initialRunResult, // Only query if no initial result provided
    staleTime: Infinity, // Cache permanently — run results don't change after processing
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 3,
    retryDelay: 1000,
  });

  const { data: discrepancyData, isLoading: isDiscrepancyLoading } = useQuery<{ analysisRows: DiscrepancyAnalysisRow[] }>({
    queryKey: ["/api/runs", currentRunId, "discrepancy-analysis", selectedReason],
    enabled: !!currentRunId && !!selectedReason && isModalOpen,
  });

  // Use initialRunResult if available, otherwise fall back to query result
  const runResult = initialRunResult || queryRunResult;
  const isResultsLoading = !initialRunResult && isQueryLoading;
  
  const overallSummary = runResult?.overallSummary || [];
  const secondaryVendorSummaryFromApi = runResult?.secondaryVendorSummary || [];
  const primaryRows = runResult?.primaryRows || [];
  const secondaryVendorRows = runResult?.secondaryVendorRows || [];
  const unmappedRows = runResult?.unmappedRows || [];
  const fxData = runResult?.fx || null;


  const bookingsForPayableModal = useMemo((): BookingForPayable[] => {
    if (!selectedPayableCurrency) return [];
    // Combine primary, secondary vendor, and unmapped rows
    const allRows = [...primaryRows, ...secondaryVendorRows, ...unmappedRows];
    return allRows
      .filter(row => row.hoCurrency === selectedPayableCurrency)
      .map(row => ({
        bookingId: row.bookingId,
        tid: row.tid || row.bookingId,
        reason: row.reason,
        hoNet: row.hoNet,
        spNet: row.spNetInHo,
        currency: row.hoCurrency,
        beId: row.beId,
        billingEntityName: row.billingEntityName,
        ticketId: row.ticketId,
        paymentBasis: row.paymentBasis,
        // Cross-cutting Secondary Vendor flag
        isSecondaryVendor: row.isSecondaryVendor || false,
        hoBeId: row.hoBeId,
        spBeId: row.spBeId,
        // Payment method fields for mismatch detection
        paymentMethod: row.paymentMethod,
        spPaymentMethod: row.spPaymentMethod,
        // Vendor ID from HO data
        vid: row.vid,
        // Pax breakdown data
        paxBreakdown: row.paxBreakdown,
        experienceName: row.experienceName,
        experienceDate: row.experienceDate,
        bookingCreationDate: row.bookingCreationDate,
        // Amount Paid & Dispute Settled from HO data
        amountPaid: row.amountPaid,
        disputeSettled: row.disputeSettled,
        // Dispute & Discrepancy fields from HO data
        disputedAmount: row.disputedAmount,
        disputeAdjustedTotal: row.disputeAdjustedTotal,
        discrepancyAmount: row.discrepancyAmount,
        disputeAdjustment: row.disputeAdjustment,
        finalDiscrepancyTotal: row.finalDiscrepancyTotal,
        disputeStatus: row.disputeStatus,
        adjustedInTicketId: row.adjustedInTicketId,
      }));
  }, [primaryRows, secondaryVendorRows, unmappedRows, selectedPayableCurrency]);

  // Derive actual currencies from reconciled data
  const actualCurrencies = useMemo(() => {
    const allRows = [...primaryRows, ...secondaryVendorRows, ...unmappedRows];
    const currencySet = new Set(allRows.map(r => r.hoCurrency).filter(Boolean));
    return Array.from(currencySet);
  }, [primaryRows, secondaryVendorRows, unmappedRows]);

  const spDetails = useMemo(() => {
    const firstRow = primaryRows[0];
    if (!firstRow) return null;
    const currencySet = new Set(primaryRows.map(r => r.hoCurrency));
    const currencies = Array.from(currencySet);
    
    // Calculate payment method distribution
    const paymentMethodCounts: Record<string, number> = {};
    primaryRows.forEach(row => {
      const method = row.paymentMethod || "Unknown";
      paymentMethodCounts[method] = (paymentMethodCounts[method] || 0) + 1;
    });
    
    // Find the dominant payment method (85%+ threshold)
    const totalBookings = primaryRows.length;
    let dominantMethod = "";
    let dominantCount = 0;
    const anomalies: Array<{ method: string; count: number }> = [];
    
    Object.entries(paymentMethodCounts).forEach(([method, count]) => {
      if (count > dominantCount) {
        // If there was a previous dominant, it becomes an anomaly
        if (dominantMethod && dominantCount > 0) {
          anomalies.push({ method: dominantMethod, count: dominantCount });
        }
        dominantMethod = method;
        dominantCount = count;
      } else {
        anomalies.push({ method, count });
      }
    });
    
    // Check if dominant has 85%+ share
    const dominantShare = totalBookings > 0 ? dominantCount / totalBookings : 0;
    const hasAnomalies = anomalies.length > 0 && anomalies.some(a => a.count > 0);
    
    return {
      beId: firstRow.beId || "",
      billingEntityName: firstRow.billingEntityName || "",
      ticketId: firstRow.ticketId || "",
      paymentBasis: firstRow.paymentBasis || "",
      paymentMethod: dominantMethod,
      paymentMethodAnomalies: hasAnomalies ? anomalies.filter(a => a.count > 0) : [],
      currency: currencies.join(", "),
    };
  }, [primaryRows]);

  // Reset currency selection when run changes or currencies change
  useEffect(() => {
    if (actualCurrencies.length > 0) {
      // Auto-select the first available currency from actual data
      setSelectedPayableCurrency(actualCurrencies[0]);
    } else {
      setSelectedPayableCurrency(null);
    }
  }, [currentRunId, actualCurrencies.length > 0 ? actualCurrencies.join(",") : ""]);

  // Already Reconciled computed data
  const alreadyReconciledData = useMemo(() => {
    // Filter bookings with Already Reconciled reasons
    const sameBEBookings = primaryRows.filter(r => r.reason === "Already Reconciled-Same BE");
    const differentBEBookings = primaryRows.filter(r => r.reason === "Already Reconciled-Different BE");
    
    // Calculate summaries for each classification
    const sameBESummary = {
      count: sameBEBookings.length,
      reconciledNet: sameBEBookings.reduce((sum, r) => sum + r.hoNet, 0),
      spNet: sameBEBookings.reduce((sum, r) => sum + r.spNetInHo, 0),
    };
    
    const differentBESummary = {
      count: differentBEBookings.length,
      reconciledNet: differentBEBookings.reduce((sum, r) => sum + r.hoNet, 0),
      spNet: differentBEBookings.reduce((sum, r) => sum + r.spNetInHo, 0),
    };
    
    const totalCount = sameBESummary.count + differentBESummary.count;
    const hasAlreadyReconciled = totalCount > 0;
    
    const allBks = [...sameBEBookings, ...differentBEBookings];
    const allCurrencies = Array.from(new Set(allBks.map(b => b.hoCurrency).filter(Boolean)));
    const currency = allCurrencies.length > 1 ? "Multiple currencies" : (allCurrencies[0] || "USD");
    
    return {
      hasAlreadyReconciled,
      totalCount,
      currency,
      sameBE: { ...sameBESummary, bookings: sameBEBookings },
      differentBE: { ...differentBESummary, bookings: differentBEBookings },
    };
  }, [primaryRows]);

  // Build analysis table rows from alreadyReconciledData for the workspace
  const arAnalysisRows = useMemo(() => {
    const rows: Array<{
      type: "same_be" | "different_be";
      discrepancyLc: number;
      discrepancyUsd: number;
      previousBe: string | null;
      bidCount: number;
      ticketIds: string[];
      paymentMethods: string[];
    }> = [];
    const toUsd = (lc: number, currency: string) => {
      const rate = fxData?.usdToCcy?.[currency] || 1;
      return lc / rate;
    };
    if (alreadyReconciledData.sameBE.count > 0) {
      const bks = alreadyReconciledData.sameBE.bookings;
      const discLc = bks.reduce((s, b) => s + (b.hoNet - b.spNetInHo), 0);
      const discUsd = bks.reduce((s, b) => s + toUsd(b.hoNet - b.spNetInHo, b.hoCurrency || "USD"), 0);
      rows.push({
        type: "same_be",
        discrepancyLc: discLc,
        discrepancyUsd: discUsd,
        previousBe: null,
        bidCount: bks.length,
        ticketIds: [...new Set(bks.map(b => b.ticketId).filter(Boolean) as string[])],
        paymentMethods: [...new Set(bks.map(b => b.paymentMethod || b.spPaymentMethod).filter(Boolean) as string[])],
      });
    }
    if (alreadyReconciledData.differentBE.count > 0) {
      const byPrevBe = new Map<string, typeof alreadyReconciledData.differentBE.bookings>();
      for (const b of alreadyReconciledData.differentBE.bookings) {
        const key = b.hoBeId || "unknown";
        if (!byPrevBe.has(key)) byPrevBe.set(key, []);
        byPrevBe.get(key)!.push(b);
      }
      for (const [prevBe, bks] of byPrevBe) {
        const discLc = bks.reduce((s, b) => s + (b.hoNet - b.spNetInHo), 0);
        const discUsd = bks.reduce((s, b) => s + toUsd(b.hoNet - b.spNetInHo, b.hoCurrency || "USD"), 0);
        rows.push({
          type: "different_be",
          discrepancyLc: discLc,
          discrepancyUsd: discUsd,
          previousBe: prevBe === "unknown" ? null : prevBe,
          bidCount: bks.length,
          ticketIds: [...new Set(bks.map(b => b.ticketId).filter(Boolean) as string[])],
          paymentMethods: [...new Set(bks.map(b => b.paymentMethod || b.spPaymentMethod).filter(Boolean) as string[])],
        });
      }
    }
    return rows;
  }, [alreadyReconciledData, fxData]);

  // Filter out Already Reconciled from main summary and create combined row
  // Cancellation types to group under "Cancellations"
  const cancellationReasons = [
    "Cancelled-SP error",
    "Cancelled-Insured Booking",
    "Cancelled-Check for Charge loss",
    "Cancelled-DSS policy",
    "Cancelled-OK",
    "Cancelled-Refund OK",
  ];

  // Calculate cancellation breakdown data
  const cancellationData = useMemo(() => {
    // Get cancellation rows from primaryRows (individual bookings)
    const cancellationBookings = primaryRows.filter(r => cancellationReasons.includes(r.reason));
    
    if (cancellationBookings.length === 0) {
      return { hasCancellations: false, breakdown: [], totalCount: 0, totalDiscrepancyLc: 0, totalDiscrepancyUsd: 0, currency: "USD" };
    }
    
    // Get unique currencies - show "Multiple currencies" if more than one
    const currencies = Array.from(new Set(cancellationBookings.map(b => b.hoCurrency).filter(Boolean)));
    const currency = currencies.length > 1 ? "Multiple currencies" : (currencies[0] || "USD");
    
    // Group by cancellation type
    const breakdown = cancellationReasons.map(reason => {
      const bookings = cancellationBookings.filter(b => b.reason === reason);
      // For cancellations, discrepancy is SP Net (what the supplier is charging)
      const discrepancyLc = bookings.reduce((sum, b) => sum + (-Math.abs(b.spNetInHo)), 0);
      // Convert spNetInHo to USD using the HO currency FX rate
      const discrepancyUsd = bookings.reduce((sum, b) => {
        const hoRate = fxData?.usdToCcy?.[b.hoCurrency] || 1;
        return sum + (-Math.abs(b.spNetInHo) / hoRate);
      }, 0);
      return {
        reason,
        displayName: reason.replace("Cancelled-", ""),
        count: bookings.length,
        discrepancyLc,
        discrepancyUsd,
        bookings,
      };
    }).filter(item => item.count > 0);
    
    // Calculate totals - for cancellations, discrepancy is SP Net only (always negative)
    const totalDiscrepancyLc = breakdown.reduce((sum, item) => sum + item.discrepancyLc, 0);
    const totalDiscrepancyUsd = breakdown.reduce((sum, item) => sum + item.discrepancyUsd, 0);
    const totalCount = breakdown.reduce((sum, item) => sum + item.count, 0);
    
    return {
      hasCancellations: totalCount > 0,
      breakdown,
      totalCount,
      totalDiscrepancyLc,
      totalDiscrepancyUsd,
      currency,
    };
  }, [primaryRows, fxData]);

  const processedSummary = useMemo(() => {
    // Remove individual Already Reconciled rows and Cancellation rows from summary
    const filteredSummary = overallSummary.filter(
      row => row.reason !== "Already Reconciled-Same BE" && 
             row.reason !== "Already Reconciled-Different BE" &&
             !cancellationReasons.includes(row.reason)
    );
    
    // Consolidate rows by reason (combine multiple currencies)
    const consolidatedRows = consolidateSummaryByReason(filteredSummary);
    
    // Build result object
    let result: {
      rows: OverallSummaryRow[];
      alreadyReconciledRow: { reason: string; currency: string; discrepancyLc: number; discrepancyUsd: number; countBid: number } | null;
      cancellationsRow: { reason: string; currency: string; discrepancyLc: number; discrepancyUsd: number; countBid: number } | null;
    } = { rows: consolidatedRows, alreadyReconciledRow: null, cancellationsRow: null };
    
    // Add combined "Already Reconciled" row if there are any
    if (alreadyReconciledData.hasAlreadyReconciled) {
      const sameBECurrencies = alreadyReconciledData.sameBE.bookings.map(b => b.hoCurrency);
      const diffBECurrencies = alreadyReconciledData.differentBE.bookings.map(b => b.hoCurrency);
      const allCurrencies = Array.from(new Set([...sameBECurrencies, ...diffBECurrencies].filter(Boolean)));
      const currency = allCurrencies.length > 1 ? "Multiple currencies" : (allCurrencies[0] || "USD");
      
      const totalDiscrepancyLc = [...alreadyReconciledData.sameBE.bookings, ...alreadyReconciledData.differentBE.bookings]
        .reduce((sum, r) => sum + r.differenceLc, 0);
      const totalDiscrepancyUsd = [...alreadyReconciledData.sameBE.bookings, ...alreadyReconciledData.differentBE.bookings]
        .reduce((sum, r) => sum + r.differenceUsd, 0);
      
      result.alreadyReconciledRow = {
        reason: "Already Reconciled",
        currency,
        discrepancyLc: totalDiscrepancyLc,
        discrepancyUsd: totalDiscrepancyUsd,
        countBid: alreadyReconciledData.totalCount,
      };
    }
    
    // Add combined "Cancellations" row if there are any
    if (cancellationData.hasCancellations) {
      result.cancellationsRow = {
        reason: "Cancellations",
        currency: cancellationData.currency,
        discrepancyLc: cancellationData.totalDiscrepancyLc,
        discrepancyUsd: cancellationData.totalDiscrepancyUsd,
        countBid: cancellationData.totalCount,
      };
    }
    
    return result;
  }, [overallSummary, alreadyReconciledData, cancellationData]);

  // Get bookings for the selected analysis row in the AR workspace
  const selectedAlreadyReconciledBookings = useMemo(() => {
    if (!selectedArAnalysisRow) return [];
    if (selectedArAnalysisRow.type === "same_be") {
      return alreadyReconciledData.sameBE.bookings;
    }
    // Diff BE: filter to bookings matching the previousBe (hoBeId)
    return alreadyReconciledData.differentBE.bookings.filter(b =>
      (b.hoBeId || "unknown") === (selectedArAnalysisRow.previousBe || "unknown")
    );
  }, [selectedArAnalysisRow, alreadyReconciledData]);

  // Pre-populate arDecisions with finalAmount=0 when the AR detail modal opens
  useEffect(() => {
    if (isAlreadyReconciledDetailModalOpen && selectedAlreadyReconciledBookings.length > 0) {
      setArDecisions(prev => {
        const next = new Map(prev);
        for (const booking of selectedAlreadyReconciledBookings) {
          if (!next.has(booking.bookingId)) {
            next.set(booking.bookingId, { decision: "pay", reason: "", customReason: "", finalAmount: 0 });
          }
        }
        return next;
      });
    }
  }, [isAlreadyReconciledDetailModalOpen, selectedAlreadyReconciledBookings]);

  // Split summary into Primary Vendor and Secondary Vendor sections
  // Uses separate arrays from API (no prefix needed)
  // Consolidate both by reason to handle multiple currencies
  const { primaryVendorSummary, secondaryVendorSummary } = useMemo(() => {
    // Primary Vendor: Filter out Reconciled (only show discrepancies), then consolidate
    const primaryFiltered = overallSummary.filter(r => r.reason !== "Reconciled");
    const primaryConsolidated = consolidateSummaryByReason(primaryFiltered);
    // Secondary Vendor: Show ALL reason types including Reconciled (full BE ID mismatch picture), then consolidate
    const secondaryConsolidated = consolidateSummaryByReason(secondaryVendorSummaryFromApi);
    
    return {
      primaryVendorSummary: primaryConsolidated,
      secondaryVendorSummary: secondaryConsolidated,
    };
  }, [overallSummary, secondaryVendorSummaryFromApi]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      (f) => f.name.endsWith(".xlsx") || f.name.endsWith(".csv")
    );
    
    if (droppedFiles.length === 0) {
      toast({
        title: "Invalid file type",
        description: "Please upload .xlsx or .csv files only",
        variant: "destructive",
      });
      return;
    }
    
    await uploadFiles(droppedFiles);
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      await uploadFiles(selectedFiles);
    }
  };

  const uploadFiles = async (newFiles: File[]) => {
    setIsUploading(true);
    setUploadProgress(0);
    setUploadStage("Starting...");
    try {
      const handleProgress = (progress: number, stage: string) => {
        setUploadProgress(progress);
        setUploadStage(stage);
      };
      const uploaded = await onFilesUploaded(newFiles, handleProgress);
      setFiles((prev) => [...prev, ...uploaded]);
      setUploadProgress(100);
      setUploadStage("Complete!");
      toast({
        title: "Files uploaded",
        description: `Successfully uploaded ${uploaded.length} file(s)`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "There was an error uploading your files";
      toast({
        title: "Upload failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setTimeout(() => {
        setIsUploading(false);
        setUploadProgress(0);
        setUploadStage("");
      }, 1000);
    }
  };

  const removeFile = (fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  const handleReasonClick = (reason: string) => {
    setSelectedReason(reason);
    setIsModalOpen(true);
  };

  const handleModalClose = (open: boolean) => {
    setIsModalOpen(open);
    if (!open) {
      setSelectedReason(null);
    }
  };

  const handlePayableModalApply = useCallback((
    newAdjustments: Adjustment[],
    selections: FinalNetSelection,
    finalAmount: number
  ) => {
    if (!selectedPayableCurrency) return;
    
    setAdjustmentsPerCurrency(prev => ({
      ...prev,
      [selectedPayableCurrency]: newAdjustments,
    }));
    
    setFinalNetSelectionsPerCurrency(prev => ({
      ...prev,
      [selectedPayableCurrency]: selections,
    }));
    
    onReconciliationFinalized();
  }, [selectedPayableCurrency, onReconciliationFinalized]);

  const handleExportExcel = useCallback(async () => {
    if (!currentRunId || primaryRows.length === 0) {
      toast({
        title: "No data to export",
        description: "Please run a reconciliation first",
        variant: "destructive",
      });
      return;
    }

    try {
      toast({
        title: "Generating export...",
        description: "Please wait while the export file is being prepared",
      });

      const analysisResponse = await authFetch(`/api/runs/${currentRunId}/export/analysis`);
      if (!analysisResponse.ok) {
        throw new Error("Failed to generate export");
      }

      const timestamp = new Date().toISOString().slice(0, 10);

      const analysisBlob = await analysisResponse.blob();
      const analysisUrl = window.URL.createObjectURL(analysisBlob);
      const a1 = document.createElement("a");
      a1.href = analysisUrl;
      a1.download = `discrepancy_analysis_${timestamp}.xlsx`;
      document.body.appendChild(a1);
      a1.click();
      window.URL.revokeObjectURL(analysisUrl);
      document.body.removeChild(a1);

      toast({
        title: "Export complete",
        description: "Discrepancy Analysis has been downloaded",
      });
    } catch (error) {
      console.error("Export error:", error);
      toast({
        title: "Export failed",
        description: "Failed to generate export file",
        variant: "destructive",
      });
    }
  }, [currentRunId, primaryRows.length, toast]);

  const handleExportAnalysisGSheet = useCallback(async () => {
    if (!currentRunId) {
      toast({ title: "No data to export", description: "Please run a reconciliation first", variant: "destructive" });
      return;
    }
    setIsExportingGSheet(true);
    try {
      const result = await onExportAnalysisGSheet();
      if (result.spreadsheetUrl) {
        toast({ title: "Export complete", description: "Discrepancy Analysis Google Sheet created" });
      }
    } catch (error) {
      toast({ title: "Export failed", description: "Could not create Google Sheet", variant: "destructive" });
    } finally {
      setIsExportingGSheet(false);
    }
  }, [currentRunId, onExportAnalysisGSheet, toast]);


  const hasResults = currentRunId && overallSummary.length > 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b flex-shrink-0 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-lg font-semibold">Reconciliation</h1>
          {files.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {files.map((file) => (
                <Badge
                  key={file.id}
                  variant="secondary"
                  className="flex items-center gap-1.5 pr-1"
                  data-testid={`file-item-${file.id}`}
                >
                  <FileSpreadsheet className="h-3 w-3" />
                  <span className="max-w-[120px] truncate">{file.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => { e.stopPropagation(); removeFile(file.id); }}
                    data-testid={`button-remove-${file.id}`}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              ))}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          <input
            id="file-input"
            type="file"
            accept=".xlsx,.csv"
            multiple
            className="hidden"
            onChange={handleFileSelect}
            data-testid="input-file"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => document.getElementById("file-input")?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            disabled={isUploading}
            data-testid="dropzone"
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                {uploadProgress}%
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-1.5" />
                Upload
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            asChild
          >
            <a
              href="/sample-reconciliation-template.xlsx"
              download="sample-reconciliation-template.xlsx"
              data-testid="link-download-template"
            >
              <Download className="h-4 w-4 mr-1.5" />
              Template
            </a>
          </Button>
        </div>
      </div>

      {isUploading && (
        <div className="px-4 py-3 border-b bg-muted/30" data-testid="upload-progress-bar">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm font-medium">{uploadStage}</span>
            </div>
            <span className="text-sm font-mono text-muted-foreground">{uploadProgress}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div 
              className="bg-primary h-full rounded-full transition-all duration-300 ease-out"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">

          {spDetails && hasResults && (
            <div className="grid grid-cols-6 gap-4 text-sm border-b pb-4" data-testid="sp-details-section">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Billing Entity ID</p>
                <p className="font-mono font-medium" data-testid="text-sp-be-id">{spDetails.beId || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Billing Entity Name</p>
                <p className="font-medium" data-testid="text-sp-entity-name">{spDetails.billingEntityName || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Ticket ID</p>
                <p className="font-mono font-medium" data-testid="text-sp-ticket-id">{spDetails.ticketId || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Payment Basis</p>
                <p className="font-medium" data-testid="text-sp-payment-basis">{spDetails.paymentBasis || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Payment Method</p>
                <div className="flex items-center gap-1.5">
                  <p className="font-medium" data-testid="text-sp-payment-method">{spDetails.paymentMethod || "—"}</p>
                  {spDetails.paymentMethodAnomalies && spDetails.paymentMethodAnomalies.length > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <AlertTriangle className="h-4 w-4 text-amber-500 cursor-help" data-testid="icon-payment-method-warning" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <div className="text-sm space-y-1">
                          {spDetails.paymentMethodAnomalies.map((anomaly, idx) => (
                            <p key={idx}>
                              {anomaly.count} Booking{anomaly.count > 1 ? 's' : ''} with payment method "{anomaly.method}" found in the reconciliation
                            </p>
                          ))}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Currency</p>
                <p className="font-mono font-medium" data-testid="text-sp-currency">{spDetails.currency || "—"}</p>
              </div>
            </div>
          )}

          <Collapsible open={isSummaryOpen} onOpenChange={setIsSummaryOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="pb-3 cursor-pointer hover-elevate">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      {isSummaryOpen ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-sm font-medium">Overall Reconciliation Summary</span>
                    </div>
                    {hasResults && (
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" disabled={isExportingGSheet} data-testid="button-export-dropdown">
                              {isExportingGSheet ? "Exporting..." : (
                                <>
                                  <FileDown className="h-4 w-4 mr-1" />
                                  Export
                                  <ChevronDown className="h-4 w-4 ml-1" />
                                </>
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={handleExportExcel} data-testid="menu-export-excel">
                              <FileSpreadsheet className="h-4 w-4 mr-2" />
                              Excel (.xlsx)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleExportAnalysisGSheet} data-testid="menu-export-analysis-gsheet">
                              <SiGooglesheets className="h-4 w-4 mr-2" />
                              Discrepancy Analysis (Google Sheets)
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {analysisGSheetUrl && (
                          <Button
                            variant="outline"
                            size="sm"
                            asChild
                            data-testid="link-analysis-gsheet"
                          >
                            <a
                              href={analysisGSheetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="h-3.5 w-3.5 mr-1" />
                              Open Sheet
                            </a>
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  {!hasResults && (
                    <CardDescription>
                      Upload a file to see reconciliation summary
                    </CardDescription>
                  )}
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  {hasResults ? (
                    <>
                    <Table className="text-sm table-fixed">
                      <colgroup>
                        <col className="w-[40%]" />
                        <col className="w-[10%]" />
                        <col className="w-[15%]" />
                        <col className="w-[15%]" />
                        <col className="w-[8%]" />
                        <col className="w-[12%]" />
                      </colgroup>
                      <TableHeader>
                        <TableRow className="h-8">
                          <TableHead className="py-1.5 text-xs pl-4">Reason</TableHead>
                          <TableHead className="py-1.5 text-xs">Currency</TableHead>
                          <TableHead className="py-1.5 text-xs text-right">Disc. LC</TableHead>
                          <TableHead className="py-1.5 text-xs text-right">Disc. USD</TableHead>
                          <TableHead className="py-1.5 text-xs text-right">Count</TableHead>
                          <TableHead className="py-1.5 text-xs text-right pr-4">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {/* Already Reconciled combined row (if exists) */}
                        {processedSummary.alreadyReconciledRow && (() => {
                          const usd = Math.abs(processedSummary.alreadyReconciledRow.discrepancyUsd);
                          const severityClass = usd > 5000 ? "bg-red-500" : usd > 1000 ? "bg-amber-500" : usd > 0 ? "bg-blue-400" : "bg-green-500";
                          return (
                            <TableRow
                              className="h-9 cursor-pointer hover-elevate bg-amber-50 dark:bg-amber-950/30 relative"
                              onClick={() => setIsAlreadyReconciledDetailModalOpen(true)}
                              data-testid="summary-row-already-reconciled"
                            >
                              <TableCell className="py-1.5 pl-4 relative">
                                <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l ${severityClass}`} />
                                <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  {processedSummary.alreadyReconciledRow.reason}
                                </span>
                              </TableCell>
                              <TableCell className="py-1.5">{processedSummary.alreadyReconciledRow.currency}</TableCell>
                              <TableCell className="py-1.5 text-right font-mono">
                                {formatNumber(processedSummary.alreadyReconciledRow.discrepancyLc)}
                              </TableCell>
                              <TableCell className="py-1.5 text-right font-mono">
                                {formatNumber(processedSummary.alreadyReconciledRow.discrepancyUsd)}
                              </TableCell>
                              <TableCell className="py-1.5 text-right">{processedSummary.alreadyReconciledRow.countBid}</TableCell>
                              <TableCell className="py-1.5 pr-4 text-right" onClick={e => e.stopPropagation()}>
                                <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setIsAlreadyReconciledDetailModalOpen(true)} data-testid="manage-btn-already-reconciled">
                                  Manage <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })()}
                        {/* Cancellations combined row (if exists) */}
                        {processedSummary.cancellationsRow && (() => {
                          const usd = Math.abs(processedSummary.cancellationsRow.discrepancyUsd);
                          const severityClass = usd > 5000 ? "bg-red-500" : usd > 1000 ? "bg-amber-500" : usd > 0 ? "bg-blue-400" : "bg-green-500";
                          return (
                            <TableRow
                              className="h-9 cursor-pointer hover-elevate bg-red-50 dark:bg-red-950/30 relative"
                              onClick={() => setIsCancellationsModalOpen(true)}
                              data-testid="summary-row-cancellations"
                            >
                              <TableCell className="py-1.5 pl-4 relative">
                                <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l ${severityClass}`} />
                                <span className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                                  <XCircle className="h-3 w-3" />
                                  {processedSummary.cancellationsRow.reason}
                                </span>
                              </TableCell>
                              <TableCell className="py-1.5">{processedSummary.cancellationsRow.currency}</TableCell>
                              <TableCell className="py-1.5 text-right font-mono text-red-600 dark:text-red-400">
                                {formatNumber(processedSummary.cancellationsRow.discrepancyLc)}
                              </TableCell>
                              <TableCell className="py-1.5 text-right font-mono text-red-600 dark:text-red-400">
                                {formatNumber(processedSummary.cancellationsRow.discrepancyUsd)}
                              </TableCell>
                              <TableCell className="py-1.5 text-right">{processedSummary.cancellationsRow.countBid}</TableCell>
                              <TableCell className="py-1.5 pr-4 text-right" onClick={e => e.stopPropagation()}>
                                <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setIsCancellationsModalOpen(true)} data-testid="manage-btn-cancellations">
                                  Manage <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })()}
                        {/* Regular summary rows */}
                        {processedSummary.rows.map((row, index) => {
                          const isClickable = true;
                          const isReconciled = row.reason === "Reconciled";
                          const usd = Math.abs(row.discrepancyUsd);
                          const severityClass = isReconciled ? "bg-green-500" : usd > 5000 ? "bg-red-500" : usd > 1000 ? "bg-amber-500" : usd > 0 ? "bg-blue-400" : "bg-green-500";
                          return (
                            <TableRow
                              key={`${row.reason}-${row.currency}-${index}`}
                              className={`h-9 relative ${isClickable ? "cursor-pointer hover-elevate" : ""} ${isReconciled ? "bg-green-50/40 dark:bg-green-950/10" : ""}`}
                              onClick={() => isClickable && handleReasonClick(row.reason)}
                              data-testid={`summary-row-${row.reason}-${row.currency}`}
                            >
                              <TableCell className="py-1.5 pl-4 relative">
                                <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l ${severityClass}`} />
                                <span className={`text-xs ${isReconciled ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                                  {row.reason}
                                </span>
                              </TableCell>
                              <TableCell className="py-1.5">{row.currency}</TableCell>
                              <TableCell className="py-1.5 text-right font-mono">
                                {formatNumber(row.discrepancyLc)}
                              </TableCell>
                              <TableCell className="py-1.5 text-right font-mono">
                                {formatNumber(row.discrepancyUsd)}
                              </TableCell>
                              <TableCell className="py-1.5 text-right">{row.countBid}</TableCell>
                              <TableCell className="py-1.5 pr-4 text-right" onClick={e => e.stopPropagation()}>
                                {isClickable && (
                                  <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => handleReasonClick(row.reason)} data-testid={`manage-btn-${row.reason}`}>
                                    Manage <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    {/* Secondary Vendor Section */}
                    {secondaryVendorSummary.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-dashed border-amber-500/50">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle className="h-4 w-4 text-amber-600" />
                          <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                            Secondary Vendor (BE ID Mismatch)
                          </span>
                          <Badge variant="outline" className="text-xs border-amber-500 text-amber-700 dark:text-amber-400">
                            {secondaryVendorSummary.reduce((sum, r) => sum + r.countBid, 0)} bookings
                          </Badge>
                        </div>
                        <Table className="text-sm table-fixed">
                          <colgroup>
                            <col className="w-[40%]" />
                            <col className="w-[10%]" />
                            <col className="w-[15%]" />
                            <col className="w-[15%]" />
                            <col className="w-[8%]" />
                            <col className="w-[12%]" />
                          </colgroup>
                          <TableBody>
                            {secondaryVendorSummary.map((row, index) => {
                              const isClickable = row.reason !== "Reconciled";
                              const usd = Math.abs(row.discrepancyUsd);
                              const severityClass = usd > 5000 ? "bg-red-500" : usd > 1000 ? "bg-amber-500" : usd > 0 ? "bg-blue-400" : "bg-green-500";
                              return (
                                <TableRow
                                  key={`sv-${row.reason}-${row.currency}-${index}`}
                                  className={`h-9 bg-amber-50/50 dark:bg-amber-950/20 relative ${isClickable ? "cursor-pointer hover-elevate" : ""}`}
                                  onClick={() => isClickable && handleReasonClick(row.reason)}
                                  data-testid={`summary-row-sv-${row.reason}-${row.currency}`}
                                >
                                  <TableCell className="py-1.5 pl-4 relative">
                                    <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l ${severityClass}`} />
                                    <span className="text-xs text-amber-700 dark:text-amber-400">
                                      {row.reason}
                                    </span>
                                  </TableCell>
                                  <TableCell className="py-1.5">{row.currency}</TableCell>
                                  <TableCell className="py-1.5 text-right font-mono">
                                    {formatNumber(row.discrepancyLc)}
                                  </TableCell>
                                  <TableCell className="py-1.5 text-right font-mono">
                                    {formatNumber(row.discrepancyUsd)}
                                  </TableCell>
                                  <TableCell className="py-1.5 text-right">{row.countBid}</TableCell>
                                  <TableCell className="py-1.5 pr-4 text-right" onClick={e => e.stopPropagation()}>
                                    {isClickable && (
                                      <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => handleReasonClick(row.reason)} data-testid={`manage-btn-sv-${row.reason}`}>
                                        Manage <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                                      </Button>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </>
                  ) : isResultsLoading && currentRunId ? (
                    <div className="h-24 flex items-center justify-center text-muted-foreground">
                      <div className="text-center">
                        <div className="h-8 w-8 mx-auto mb-2 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                        <p className="text-sm">Loading results...</p>
                      </div>
                    </div>
                  ) : (
                    <div className="h-24 flex items-center justify-center text-muted-foreground">
                      <div className="text-center">
                        <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No data yet - upload a file to get started</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium">
                  {spDetails?.paymentMethod?.toUpperCase() === "PORTAL_DEPOSIT" 
                    ? `Purchase Reconciliation - ${spDetails?.billingEntityName || "Supplier"}`
                    : `Amount Payable to ${spDetails?.billingEntityName || "Supplier"}`
                  }
                </span>
                {hasResults && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsComputeOpen(!isComputeOpen)}
                    data-testid="button-compute"
                  >
                    <Calculator className="h-4 w-4 mr-1" />
                    {isComputeOpen ? "Close" : "Compute"}
                  </Button>
                )}
              </div>
              {!hasResults && (
                <CardDescription>
                  Summary will appear after processing
                </CardDescription>
              )}
            </CardHeader>
            {isComputeOpen && hasResults && (
              <CardContent className="pt-0">
                <Suspense fallback={<div className="flex items-center justify-center py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading panel...</div>}>
                  {spDetails?.paymentMethod?.toUpperCase() === "PORTAL_DEPOSIT" ? (
                    <PurchaseReconciliationPanel
                      primaryRows={primaryRows}
                      secondaryVendorRows={secondaryVendorRows}
                      unmappedRows={unmappedRows}
                      currency={selectedPayableCurrency || actualCurrencies[0] || ""}
                      billingEntityName={spDetails?.billingEntityName || ""}
                      beId={spDetails?.beId || ""}
                      onClose={() => setIsComputeOpen(false)}
                      fxRateToUsd={fxData?.usdToCcy ? (1 / (fxData.usdToCcy[selectedPayableCurrency || actualCurrencies[0] || "USD"] || 1)) : undefined}
                      runId={currentRunId}
                      onReconciliationFinalized={onReconciliationFinalized}
                    />
                  ) : (
                    <AmountPayablePanel
                      bookings={bookingsForPayableModal}
                      currency={selectedPayableCurrency || actualCurrencies[0] || ""}
                      adjustments={adjustmentsPerCurrency[selectedPayableCurrency || actualCurrencies[0] || ""] || []}
                      finalNetSelections={finalNetSelectionsPerCurrency[selectedPayableCurrency || actualCurrencies[0] || ""] || {}}
                      onApply={handlePayableModalApply}
                      onClose={() => setIsComputeOpen(false)}
                      runId={currentRunId}
                      allRows={primaryRows}
                      onCurrencyChange={setSelectedPayableCurrency}
                      availableCurrencies={actualCurrencies}
                      dominantPaymentMethod={spDetails?.paymentMethod || ""}
                    />
                  )}
                </Suspense>
              </CardContent>
            )}
          </Card>
        </div>
      </ScrollArea>

      <DiscrepancySummaryWorkspace
        open={isModalOpen}
        onOpenChange={handleModalClose}
        reason={selectedReason}
        runId={currentRunId}
        primaryRows={primaryRows}
        secondaryVendorRows={secondaryVendorRows}
        unmappedRows={unmappedRows}
        analysisRows={discrepancyData?.analysisRows || []}
        isLoadingAnalysis={isDiscrepancyLoading}
        billingEntityId={spDetails?.beId || ""}
        billingEntityName={spDetails?.billingEntityName || ""}
        currency={spDetails?.currency || "USD"}
      />

      {/* Already Reconciled — Analysis Workspace (single dialog, analysis-first) */}
      <Dialog open={isAlreadyReconciledDetailModalOpen} onOpenChange={(open) => {
        setIsAlreadyReconciledDetailModalOpen(open);
        if (!open) setSelectedArAnalysisRow(null);
      }}>
        <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] flex flex-col gap-0 p-0 overflow-hidden [&>button.absolute]:hidden">
          <DialogHeader className="px-6 pt-5 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Already Reconciled — Analysis
              <Badge variant="outline" className="ml-1 text-xs font-normal">
                {alreadyReconciledData.totalCount} bookings
              </Badge>
            </DialogTitle>
          </DialogHeader>

          {/* Analysis table */}
          <div className="px-6 pt-4 pb-2 shrink-0">
            <p className="text-xs text-muted-foreground mb-2">Summary of already reconciled bookings. Use the workspace below to review and action each booking.</p>
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead className="py-2">Type</TableHead>
                  <TableHead className="py-2 text-right">Discrepancy LC</TableHead>
                  <TableHead className="py-2 text-right">Discrepancy USD</TableHead>
                  <TableHead className="py-2">Previous BE</TableHead>
                  <TableHead className="py-2">Payment Methods</TableHead>
                  <TableHead className="py-2 text-right">BID Count</TableHead>
                  <TableHead className="py-2">Ticket IDs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {arAnalysisRows.map((row, idx) => {
                  const isSelected = selectedArAnalysisRow?.type === row.type && selectedArAnalysisRow?.previousBe === row.previousBe;
                  return (
                    <TableRow
                      key={idx}
                      className={`cursor-pointer text-xs transition-colors ${isSelected ? "bg-amber-50 dark:bg-amber-950/40 border-l-2 border-l-amber-400" : "hover:bg-muted/50"}`}
                      onClick={() => setSelectedArAnalysisRow({ type: row.type, previousBe: row.previousBe })}
                      data-testid={`ar-analysis-row-${row.type}-${idx}`}
                    >
                      <TableCell className="py-2 font-medium">
                        {row.type === "same_be" ? (
                          <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-[10px]">Same BE</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 text-[10px]">Diff BE</Badge>
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-right font-mono">{formatNumber(row.discrepancyLc)}</TableCell>
                      <TableCell className="py-2 text-right font-mono">{formatNumber(row.discrepancyUsd)}</TableCell>
                      <TableCell className="py-2 font-mono text-muted-foreground">{row.previousBe || "—"}</TableCell>
                      <TableCell className="py-2">{row.paymentMethods.join(", ") || "—"}</TableCell>
                      <TableCell className="py-2 text-right font-mono">{row.bidCount}</TableCell>
                      <TableCell className="py-2 font-mono text-[10px] text-muted-foreground max-w-[180px] truncate" title={row.ticketIds.join(", ")}>{row.ticketIds.join(", ") || "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Already Reconciled Workspace — replaces flat booking table */}
          {alreadyReconciledData.totalCount > 0 && (
            <div className="flex flex-col flex-1 overflow-hidden border-t mt-1">
              <AlreadyReconciledWorkspace
                bookings={[
                  ...alreadyReconciledData.sameBE.bookings,
                  ...alreadyReconciledData.differentBE.bookings,
                ].map<ArWorkspaceBooking>(b => ({
                  bookingId: b.bookingId,
                  tid: b.tid,
                  reason: b.reason,
                  hoNet: b.hoNet,
                  spNet: b.spNetInHo,
                  amountPaid: b.amountPaid || 0,
                  paymentMethod: b.paymentMethod,
                  spPaymentMethod: b.spPaymentMethod,
                  hoBeId: b.hoBeId,
                  beId: b.beId,
                  ticketId: b.ticketId,
                }))}
                currency={alreadyReconciledData.currency}
                decisions={arDecisions}
                onDecisionChange={setArDecisions}
                activeDisputes={arActiveDisputes}
                disputeAmounts={arDisputeAmounts}
                onDisputeChange={(newActive, newAmounts) => {
                  setArActiveDisputes(newActive);
                  setArDisputeAmounts(newAmounts);
                }}
                onClose={() => setIsAlreadyReconciledDetailModalOpen(false)}
                showApplyConfirm
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Cancellations Workspace - Full-screen analysis + TID action */}
      <Dialog open={isCancellationsModalOpen} onOpenChange={setIsCancellationsModalOpen}>
        <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] p-0 gap-0 flex flex-col overflow-hidden [&>button.absolute]:hidden" data-testid="cancellations-workspace-dialog">
          <Suspense fallback={<div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading workspace…</div>}>
            <CancellationsWorkspace
              cancellationBookings={primaryRows.filter(r => cancellationReasons.includes(r.reason))}
              allRows={primaryRows}
              currency={cancellationData.currency}
              beId={spDetails?.beId || ""}
              supplierName={spDetails?.billingEntityName || ""}
              onClose={() => setIsCancellationsModalOpen(false)}
              fxData={fxData}
              runId={currentRunId}
            />
          </Suspense>
        </DialogContent>
      </Dialog>

    </div>
  );
}
