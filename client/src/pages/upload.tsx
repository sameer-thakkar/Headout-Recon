import { useState, useCallback, useMemo, useEffect, lazy, Suspense } from "react";
import { authFetch } from "@/lib/queryClient";
import { Upload, FileSpreadsheet, X, Play, Download, ChevronRight, DollarSign, FileDown, Calculator, ChevronDown, ExternalLink, AlertTriangle, XCircle, Loader2, Check, Search, Calendar, TrendingDown, CreditCard } from "lucide-react";
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
  // Already Reconciled modal states
  const [isAlreadyReconciledModalOpen, setIsAlreadyReconciledModalOpen] = useState(false);
  const [selectedAlreadyReconciledType, setSelectedAlreadyReconciledType] = useState<"same_be" | "different_be" | null>(null);
  const [isAlreadyReconciledDetailModalOpen, setIsAlreadyReconciledDetailModalOpen] = useState(false);
  // Already Reconciled action states
  const [arDecisions, setArDecisions] = useState<Map<string, { decision: "pay" | "dont_pay"; reason: string; customReason: string; finalAmount: number }>>(new Map());
  const [arActiveDisputes, setArActiveDisputes] = useState<Set<string>>(new Set());
  const [arDisputeAmounts, setArDisputeAmounts] = useState<Map<string, number>>(new Map());
  const [arSearchQuery, setArSearchQuery] = useState("");
  const [arSelectedBookings, setArSelectedBookings] = useState<Set<string>>(new Set());
  const [arExpandedTids, setArExpandedTids] = useState<Set<string>>(new Set());
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
    
    return {
      hasAlreadyReconciled,
      totalCount,
      sameBE: { ...sameBESummary, bookings: sameBEBookings },
      differentBE: { ...differentBESummary, bookings: differentBEBookings },
    };
  }, [primaryRows]);

  // Filter out Already Reconciled from main summary and create combined row
  // Cancellation types to group under "Cancellations"
  const cancellationReasons = [
    "Cancelled-SP error",
    "Cancelled-Insured Booking",
    "Cancelled-Check for Charge loss",
    "Cancelled-DSS policy",
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

  // Get bookings for selected Already Reconciled type
  const selectedAlreadyReconciledBookings = useMemo(() => {
    if (!selectedAlreadyReconciledType) return [];
    if (selectedAlreadyReconciledType === "same_be") {
      return alreadyReconciledData.sameBE.bookings;
    }
    return alreadyReconciledData.differentBE.bookings;
  }, [selectedAlreadyReconciledType, alreadyReconciledData]);

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
    if (reason === "Reconciled") return;
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
            <div className="grid grid-cols-8 gap-4 text-sm border-b pb-4" data-testid="sp-details-section">
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
                    <Table className="text-sm">
                      <TableHeader>
                        <TableRow className="h-8">
                          <TableHead className="py-1.5 text-xs pl-4">Reason</TableHead>
                          <TableHead className="py-1.5 text-xs">Currency</TableHead>
                          <TableHead className="py-1.5 text-xs text-right">Disc. LC</TableHead>
                          <TableHead className="py-1.5 text-xs text-right">Disc. USD</TableHead>
                          <TableHead className="py-1.5 text-xs text-right">Count</TableHead>
                          <TableHead className="py-1.5 text-xs text-right pr-4 w-24">Action</TableHead>
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
                              onClick={() => setIsAlreadyReconciledModalOpen(true)}
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
                                <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setIsAlreadyReconciledModalOpen(true)} data-testid="manage-btn-already-reconciled">
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
                          const isClickable = row.reason !== "Reconciled";
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
                    {/* Grand Total footer */}
                    {(() => {
                      const allRows = [
                        processedSummary.alreadyReconciledRow,
                        processedSummary.cancellationsRow,
                        ...processedSummary.rows,
                      ].filter(Boolean) as typeof processedSummary.rows;
                      const totalCount = allRows.reduce((s, r) => s + r.countBid, 0);
                      const totalLc = allRows.reduce((s, r) => s + r.discrepancyLc, 0);
                      const totalUsd = allRows.reduce((s, r) => s + r.discrepancyUsd, 0);
                      return (
                        <div className="border-t bg-muted/30 px-4 py-2.5 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-muted-foreground">Grand Total</span>
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{totalCount} bookings</Badge>
                          </div>
                          <div className="flex items-center gap-5">
                            <div><span className="text-muted-foreground mr-1.5">LC</span><span className="font-mono font-semibold text-red-600">{formatNumber(totalLc)}</span></div>
                            <div><span className="text-muted-foreground mr-1.5">USD</span><span className="font-mono font-semibold text-red-600">{formatNumber(totalUsd)}</span></div>
                          </div>
                        </div>
                      );
                    })()}
                    {/* Severity legend */}
                    <div className="flex items-center gap-3 px-4 py-2 text-[10px] text-muted-foreground border-t">
                      <div className="flex items-center gap-1.5"><div className="w-3 h-2 bg-red-500 rounded-sm" />&gt; 5,000</div>
                      <div className="flex items-center gap-1.5"><div className="w-3 h-2 bg-amber-500 rounded-sm" />&gt; 1,000</div>
                      <div className="flex items-center gap-1.5"><div className="w-3 h-2 bg-blue-400 rounded-sm" />&lt; 1,000</div>
                      <div className="flex items-center gap-1.5"><div className="w-3 h-2 bg-green-500 rounded-sm" />Reconciled</div>
                    </div>
                    
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
                        <Table className="text-sm">
                          <TableHeader>
                            <TableRow className="h-8">
                              <TableHead className="py-1.5 text-xs pl-4">Reason</TableHead>
                              <TableHead className="py-1.5 text-xs">Currency</TableHead>
                              <TableHead className="py-1.5 text-xs text-right">Disc. LC</TableHead>
                              <TableHead className="py-1.5 text-xs text-right">Disc. USD</TableHead>
                              <TableHead className="py-1.5 text-xs text-right">Count</TableHead>
                              <TableHead className="py-1.5 text-xs text-right pr-4 w-24">Action</TableHead>
                            </TableRow>
                          </TableHeader>
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

      {/* Already Reconciled - First Level Modal (Classification Breakdown) */}
      <Dialog open={isAlreadyReconciledModalOpen} onOpenChange={setIsAlreadyReconciledModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Already Reconciled Bookings
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              These bookings have been previously reconciled. Click on a classification to view details.
            </p>
            
            {/* Same Billing Entity */}
            {alreadyReconciledData.sameBE.count > 0 && (
              <Card
                className="cursor-pointer hover-elevate border-green-200 dark:border-green-800"
                onClick={() => {
                  setSelectedAlreadyReconciledType("same_be");
                  setIsAlreadyReconciledDetailModalOpen(true);
                }}
                data-testid="already-reconciled-same-be-card"
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                      Same Billing Entity
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Bookings</p>
                      <p className="font-mono font-medium">{alreadyReconciledData.sameBE.count}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Reconciled Net</p>
                      <p className="font-mono font-medium">{formatNumber(alreadyReconciledData.sameBE.reconciledNet)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">SP Net</p>
                      <p className="font-mono font-medium">{formatNumber(alreadyReconciledData.sameBE.spNet)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {/* Different Billing Entity */}
            {alreadyReconciledData.differentBE.count > 0 && (
              <Card
                className="cursor-pointer hover-elevate border-orange-200 dark:border-orange-800"
                onClick={() => {
                  setSelectedAlreadyReconciledType("different_be");
                  setIsAlreadyReconciledDetailModalOpen(true);
                }}
                data-testid="already-reconciled-different-be-card"
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                      Different Billing Entity
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Bookings</p>
                      <p className="font-mono font-medium">{alreadyReconciledData.differentBE.count}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Reconciled Net</p>
                      <p className="font-mono font-medium">{formatNumber(alreadyReconciledData.differentBE.reconciledNet)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">SP Net</p>
                      <p className="font-mono font-medium">{formatNumber(alreadyReconciledData.differentBE.spNet)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Already Reconciled - Second Level Modal (Enhanced Workspace) */}
      <Dialog open={isAlreadyReconciledDetailModalOpen} onOpenChange={(open) => {
        setIsAlreadyReconciledDetailModalOpen(open);
        if (!open) {
          setSelectedAlreadyReconciledType(null);
          setArSearchQuery("");
          setArSelectedBookings(new Set());
        }
      }}>
        <DialogContent className="max-w-[95vw] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedAlreadyReconciledType === "same_be" ? (
                <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                  Same Billing Entity
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                  Different Billing Entity
                </Badge>
              )}
              Booking Details
              <Badge variant="outline" className="ml-2 text-xs">
                {selectedAlreadyReconciledBookings.length} bookings
              </Badge>
              {(() => {
                const decidedCount = selectedAlreadyReconciledBookings.filter(b => arDecisions.has(b.bookingId)).length;
                const total = selectedAlreadyReconciledBookings.length;
                return decidedCount > 0 ? (
                  <Badge variant="secondary" className="ml-1 text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                    Decided: {decidedCount}/{total}
                  </Badge>
                ) : null;
              })()}
            </DialogTitle>
          </DialogHeader>

          {(() => {
            const allBookings = selectedAlreadyReconciledBookings;
            const payMismatchCount = allBookings.filter(b => {
              const ho = b.paymentMethod || "";
              const sp = b.spPaymentMethod || "";
              return ho && sp && ho !== sp;
            }).length;
            const priceDriftBookings = allBookings.filter(b => Math.abs(b.hoNet - b.spNetInHo) > 0.01);
            const priceDriftDelta = priceDriftBookings.reduce((s, b) => s + (b.spNetInHo - b.hoNet), 0);
            const dates = allBookings
              .map(b => b.dateOfPayment || b.spDateOfPayment)
              .filter(Boolean)
              .map(d => String(d))
              .sort();
            const earliestDate = dates.length > 0 ? formatDateDDMMYYYY(dates[0]) : null;
            const latestDate = dates.length > 1 ? formatDateDDMMYYYY(dates[dates.length - 1]) : earliestDate;

            const query = arSearchQuery.toLowerCase();
            const filteredBookings = query
              ? allBookings.filter(b =>
                  (b.tid || "").toLowerCase().includes(query) ||
                  b.bookingId.toLowerCase().includes(query)
                )
              : allBookings;

            const tidGroups = new Map<string, typeof filteredBookings>();
            for (const b of filteredBookings) {
              const tid = b.tid || "NO_TID";
              if (!tidGroups.has(tid)) tidGroups.set(tid, []);
              tidGroups.get(tid)!.push(b);
            }
            const sortedTids = Array.from(tidGroups.entries()).sort((a, b) => {
              const aDelta = Math.abs(a[1].reduce((s, bk) => s + (bk.spNetInHo - bk.hoNet), 0));
              const bDelta = Math.abs(b[1].reduce((s, bk) => s + (bk.spNetInHo - bk.hoNet), 0));
              return bDelta - aDelta;
            });

            const allFilteredIds = filteredBookings.map(b => b.bookingId);
            const allSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => arSelectedBookings.has(id));
            const someSelected = arSelectedBookings.size > 0;

            return (
              <>
                {/* Insight Cards */}
                <div className="grid grid-cols-3 gap-3 mb-3">
                  {selectedAlreadyReconciledType === "same_be" && (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <CreditCard className="h-3.5 w-3.5 text-amber-600" />
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Payment Mismatch</span>
                      </div>
                      <p className="text-lg font-mono font-semibold">{payMismatchCount}</p>
                      <p className="text-[10px] text-muted-foreground">of {allBookings.length} bookings have different payment methods</p>
                    </div>
                  )}
                  {selectedAlreadyReconciledType === "different_be" && (
                    <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20 p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <CreditCard className="h-3.5 w-3.5 text-orange-600" />
                        <span className="text-xs font-medium text-orange-700 dark:text-orange-400">Unique TIDs</span>
                      </div>
                      <p className="text-lg font-mono font-semibold">{tidGroups.size}</p>
                      <p className="text-[10px] text-muted-foreground">across {allBookings.length} bookings</p>
                    </div>
                  )}
                  <div className="rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20 p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <TrendingDown className="h-3.5 w-3.5 text-violet-600" />
                      <span className="text-xs font-medium text-violet-700 dark:text-violet-400">Price Drift</span>
                    </div>
                    <p className="text-lg font-mono font-semibold">{priceDriftBookings.length > 0 ? formatNumber(Math.abs(priceDriftDelta)) : "0.00"}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {priceDriftBookings.length > 0
                        ? `net delta across ${priceDriftBookings.length} bookings`
                        : "all prices match"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Calendar className="h-3.5 w-3.5 text-blue-600" />
                      <span className="text-xs font-medium text-blue-700 dark:text-blue-400">Date Spread</span>
                    </div>
                    <p className="text-sm font-mono font-semibold">
                      {earliestDate && latestDate && earliestDate !== latestDate
                        ? `${earliestDate} – ${latestDate}`
                        : earliestDate || "No dates"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">payment date range</p>
                  </div>
                </div>

                {/* Search Bar */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      className="h-8 text-xs pl-8 pr-8"
                      placeholder="Search by TID or Booking ID..."
                      value={arSearchQuery}
                      onChange={(e) => setArSearchQuery(e.target.value)}
                      data-testid="ar-search-input"
                    />
                    {arSearchQuery && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5"
                        onClick={() => setArSearchQuery("")}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  {query && (
                    <span className="text-xs text-muted-foreground">
                      Showing {filteredBookings.length} of {allBookings.length} bookings
                    </span>
                  )}
                </div>

                {/* TID-Grouped Collapsible View */}
                <div className="flex-1 overflow-auto border rounded-lg">
                  {sortedTids.map(([tid, tidBookings]) => {
                    const isSingleBooking = tidBookings.length === 1;
                    const isExpanded = isSingleBooking || arExpandedTids.has(tid);
                    const tidReconNet = tidBookings.reduce((s, b) => s + b.hoNet, 0);
                    const tidSpNet = tidBookings.reduce((s, b) => s + b.spNetInHo, 0);
                    const tidDelta = tidSpNet - tidReconNet;
                    const allTidSelected = tidBookings.every(b => arSelectedBookings.has(b.bookingId));

                    return (
                      <div key={tid} className="border-b last:border-b-0" data-testid={`ar-tid-group-${tid}`}>
                        {/* TID Header Row */}
                        <div
                          className={`flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/50 ${!isSingleBooking ? "cursor-pointer" : ""}`}
                          onClick={() => {
                            if (isSingleBooking) return;
                            setArExpandedTids(prev => {
                              const n = new Set(prev);
                              n.has(tid) ? n.delete(tid) : n.add(tid);
                              return n;
                            });
                          }}
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border-gray-300"
                            checked={allTidSelected}
                            onChange={(e) => {
                              e.stopPropagation();
                              setArSelectedBookings(prev => {
                                const n = new Set(prev);
                                tidBookings.forEach(b => allTidSelected ? n.delete(b.bookingId) : n.add(b.bookingId));
                                return n;
                              });
                            }}
                            data-testid={`ar-tid-checkbox-${tid}`}
                          />
                          {!isSingleBooking && (
                            isExpanded
                              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <span className="font-mono text-xs font-medium">{tid === "NO_TID" ? "No TID" : tid}</span>
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{tidBookings.length}</Badge>
                          <div className="flex-1" />
                          <div className="flex gap-4 text-xs font-mono">
                            <span className="text-muted-foreground">Recon: <span className="text-foreground">{formatNumber(tidReconNet)}</span></span>
                            <span className="text-muted-foreground">SP: <span className="text-foreground">{formatNumber(tidSpNet)}</span></span>
                            {Math.abs(tidDelta) > 0.01 && (
                              <span className={tidDelta > 0 ? "text-red-600" : "text-green-600"}>
                                {tidDelta > 0 ? "+" : ""}{formatNumber(tidDelta)}
                              </span>
                            )}
                          </div>
                          <div className="flex gap-1 ml-2" onClick={e => e.stopPropagation()}>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-[10px] px-1.5"
                              onClick={() => {
                                const newDecisions = new Map(arDecisions);
                                tidBookings.forEach(b => {
                                  newDecisions.set(b.bookingId, {
                                    decision: "pay",
                                    reason: arDecisions.get(b.bookingId)?.reason || "",
                                    customReason: arDecisions.get(b.bookingId)?.customReason || "",
                                    finalAmount: arDecisions.get(b.bookingId)?.finalAmount ?? b.spNetInHo,
                                  });
                                });
                                setArDecisions(newDecisions);
                              }}
                              data-testid={`ar-tid-pay-all-${tid}`}
                            >
                              Pay All
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-[10px] px-1.5 text-red-600 border-red-200"
                              onClick={() => {
                                const newDecisions = new Map(arDecisions);
                                tidBookings.forEach(b => {
                                  newDecisions.set(b.bookingId, {
                                    decision: "dont_pay",
                                    reason: arDecisions.get(b.bookingId)?.reason || "",
                                    customReason: arDecisions.get(b.bookingId)?.customReason || "",
                                    finalAmount: arDecisions.get(b.bookingId)?.finalAmount ?? b.spNetInHo,
                                  });
                                });
                                setArDecisions(newDecisions);
                              }}
                              data-testid={`ar-tid-dontpay-all-${tid}`}
                            >
                              Don't Pay All
                            </Button>
                          </div>
                        </div>

                        {/* Expanded Booking Rows */}
                        {isExpanded && (
                          <div>
                            {tidBookings.map((booking, index) => {
                              const hoPaymentMethod = booking.paymentMethod || "";
                              const spPaymentMethod = booking.spPaymentMethod || "";
                              const paymentMethodMismatch = hoPaymentMethod && spPaymentMethod && hoPaymentMethod !== spPaymentMethod;
                              const decision = arDecisions.get(booking.bookingId);
                              const isPay = !decision || decision.decision === "pay";
                              const isDontPay = decision?.decision === "dont_pay";
                              const isDisputeActive = arActiveDisputes.has(booking.bookingId);
                              const disputeAmount = arDisputeAmounts.get(booking.bookingId) || 0;
                              const currentFinalAmount = decision?.finalAmount ?? booking.spNetInHo;
                              const reasonOptions = ["", "Cancellations", "Multiple tickets booked", "Manual Error", "Partial Fulfillment"];
                              const isCustomReason = decision?.reason && !reasonOptions.includes(decision.reason);

                              return (
                                <div
                                  key={`${booking.bookingId}-${index}`}
                                  className={`flex items-center gap-2 px-3 py-1.5 border-t text-xs ${isDontPay ? "opacity-50 bg-muted/20" : ""}`}
                                  data-testid={`already-reconciled-row-${booking.bookingId}`}
                                >
                                  <input
                                    type="checkbox"
                                    className="h-3.5 w-3.5 rounded border-gray-300"
                                    checked={arSelectedBookings.has(booking.bookingId)}
                                    onChange={() => {
                                      setArSelectedBookings(prev => {
                                        const n = new Set(prev);
                                        n.has(booking.bookingId) ? n.delete(booking.bookingId) : n.add(booking.bookingId);
                                        return n;
                                      });
                                    }}
                                    data-testid={`ar-checkbox-${booking.bookingId}`}
                                  />
                                  <div className="w-24 font-mono truncate" title={booking.bookingId}>{booking.bookingId}</div>
                                  <div className="w-20 text-right font-mono">{formatNumber(booking.hoNet)}</div>
                                  <div className="w-20 text-right font-mono">{formatNumber(booking.spNetInHo)}</div>
                                  {selectedAlreadyReconciledType === "same_be" && (
                                    <div className="w-28">
                                      {paymentMethodMismatch ? (
                                        <Badge variant="destructive" className="text-[10px]">
                                          {hoPaymentMethod} vs {spPaymentMethod}
                                        </Badge>
                                      ) : (
                                        <span className="text-muted-foreground">-</span>
                                      )}
                                    </div>
                                  )}
                                  {selectedAlreadyReconciledType === "different_be" && (
                                    <>
                                      <div className="w-16 truncate">{hoPaymentMethod || spPaymentMethod || "-"}</div>
                                      <div className="w-14 font-mono truncate">{booking.hoBeId || "-"}</div>
                                      <div className="w-14 font-mono truncate">{booking.beId || "-"}</div>
                                    </>
                                  )}
                                  <div className="w-20">{formatDateDDMMYYYY(booking.dateOfPayment || booking.spDateOfPayment) || "-"}</div>
                                  <div className="w-[85px]">
                                    <Select
                                      value={decision?.decision || "pay"}
                                      onValueChange={(v: "pay" | "dont_pay") => {
                                        const newDecisions = new Map(arDecisions);
                                        newDecisions.set(booking.bookingId, {
                                          decision: v,
                                          reason: decision?.reason || "",
                                          customReason: decision?.customReason || "",
                                          finalAmount: decision?.finalAmount ?? booking.spNetInHo,
                                        });
                                        setArDecisions(newDecisions);
                                      }}
                                    >
                                      <SelectTrigger className="h-6 text-[11px] px-1.5" data-testid={`ar-select-decision-${booking.bookingId}`}>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="pay">Pay</SelectItem>
                                        <SelectItem value="dont_pay">Don't Pay</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="w-[140px]">
                                    <div className="flex gap-0.5">
                                      <Select
                                        value={isCustomReason ? "" : (decision?.reason || "")}
                                        onValueChange={(v) => {
                                          const newDecisions = new Map(arDecisions);
                                          newDecisions.set(booking.bookingId, {
                                            decision: decision?.decision || "pay",
                                            reason: v === "none" ? "" : v,
                                            customReason: "",
                                            finalAmount: decision?.finalAmount ?? booking.spNetInHo,
                                          });
                                          setArDecisions(newDecisions);
                                        }}
                                      >
                                        <SelectTrigger className="h-6 text-[11px] px-1 flex-1" data-testid={`ar-select-reason-${booking.bookingId}`}>
                                          <SelectValue placeholder="-" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="none">-</SelectItem>
                                          <SelectItem value="Cancellations">Cancellations</SelectItem>
                                          <SelectItem value="Multiple tickets booked">Multiple tickets</SelectItem>
                                          <SelectItem value="Manual Error">Manual Error</SelectItem>
                                          <SelectItem value="Partial Fulfillment">Partial Fulfillment</SelectItem>
                                        </SelectContent>
                                      </Select>
                                      {(isCustomReason || decision?.reason === "") && decision && (
                                        <Input
                                          className="h-6 text-[11px] px-1 w-14"
                                          placeholder="Other..."
                                          value={isCustomReason ? decision?.reason : ""}
                                          onChange={(e) => {
                                            const newDecisions = new Map(arDecisions);
                                            newDecisions.set(booking.bookingId, {
                                              decision: decision?.decision || "pay",
                                              reason: e.target.value,
                                              customReason: e.target.value,
                                              finalAmount: decision?.finalAmount ?? booking.spNetInHo,
                                            });
                                            setArDecisions(newDecisions);
                                          }}
                                          data-testid={`ar-input-custom-reason-${booking.bookingId}`}
                                        />
                                      )}
                                    </div>
                                  </div>
                                  <div className="w-[100px]">
                                    {isDisputeActive ? (
                                      <div className="flex items-center gap-0.5">
                                        <Input
                                          type="number"
                                          step="0.01"
                                          className="h-6 text-[11px] px-1 w-14 text-right font-mono"
                                          value={disputeAmount || ""}
                                          onChange={(e) => {
                                            const val = Math.round((parseFloat(e.target.value) || 0) * 100) / 100;
                                            setArDisputeAmounts(prev => {
                                              const newMap = new Map(prev);
                                              newMap.set(booking.bookingId, val);
                                              return newMap;
                                            });
                                          }}
                                          data-testid={`ar-input-dispute-amount-${booking.bookingId}`}
                                        />
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-5 w-5"
                                          onClick={() => {
                                            setArActiveDisputes(prev => {
                                              const newSet = new Set(prev);
                                              newSet.delete(booking.bookingId);
                                              return newSet;
                                            });
                                            setArDisputeAmounts(prev => {
                                              const newMap = new Map(prev);
                                              newMap.delete(booking.bookingId);
                                              return newMap;
                                            });
                                          }}
                                          data-testid={`ar-button-cancel-dispute-${booking.bookingId}`}
                                        >
                                          <X className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    ) : (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-6 text-[10px] px-1.5"
                                        onClick={() => {
                                          setArActiveDisputes(prev => new Set(prev).add(booking.bookingId));
                                          setArDisputeAmounts(prev => {
                                            const newMap = new Map(prev);
                                            newMap.set(booking.bookingId, Math.abs(booking.spNetInHo - booking.hoNet));
                                            return newMap;
                                          });
                                        }}
                                        data-testid={`ar-button-dispute-${booking.bookingId}`}
                                      >
                                        Dispute
                                      </Button>
                                    )}
                                  </div>
                                  <div className="w-[90px]">
                                    {isPay ? (
                                      <Input
                                        type="number"
                                        step="0.01"
                                        className="h-6 text-[11px] px-1 text-right font-mono"
                                        value={currentFinalAmount}
                                        onChange={(e) => {
                                          const newDecisions = new Map(arDecisions);
                                          newDecisions.set(booking.bookingId, {
                                            decision: decision?.decision || "pay",
                                            reason: decision?.reason || "",
                                            customReason: decision?.customReason || "",
                                            finalAmount: Math.round((parseFloat(e.target.value) || 0) * 100) / 100,
                                          });
                                          setArDecisions(newDecisions);
                                        }}
                                        data-testid={`ar-input-final-amount-${booking.bookingId}`}
                                      />
                                    ) : (
                                      <span className="text-muted-foreground">-</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {sortedTids.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      {query ? "No bookings match your search" : "No bookings found"}
                    </div>
                  )}
                </div>

                {/* Bulk Action Bar */}
                {someSelected && (
                  <div className="flex items-center gap-3 px-3 py-2 bg-primary/5 border rounded-lg mt-2">
                    <span className="text-xs font-medium">{arSelectedBookings.size} selected</span>
                    <div className="flex gap-1.5 ml-auto">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs px-2 border-green-300 text-green-700 hover:bg-green-50"
                        onClick={() => {
                          const newDecisions = new Map(arDecisions);
                          arSelectedBookings.forEach(id => {
                            const b = allBookings.find(bk => bk.bookingId === id);
                            if (b) {
                              newDecisions.set(id, {
                                decision: "pay",
                                reason: arDecisions.get(id)?.reason || "",
                                customReason: arDecisions.get(id)?.customReason || "",
                                finalAmount: arDecisions.get(id)?.finalAmount ?? b.spNetInHo,
                              });
                            }
                          });
                          setArDecisions(newDecisions);
                        }}
                        data-testid="ar-bulk-pay"
                      >
                        <Check className="h-3 w-3 mr-1" /> Set Pay
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs px-2 border-red-300 text-red-700 hover:bg-red-50"
                        onClick={() => {
                          const newDecisions = new Map(arDecisions);
                          arSelectedBookings.forEach(id => {
                            const b = allBookings.find(bk => bk.bookingId === id);
                            if (b) {
                              newDecisions.set(id, {
                                decision: "dont_pay",
                                reason: arDecisions.get(id)?.reason || "",
                                customReason: arDecisions.get(id)?.customReason || "",
                                finalAmount: arDecisions.get(id)?.finalAmount ?? b.spNetInHo,
                              });
                            }
                          });
                          setArDecisions(newDecisions);
                        }}
                        data-testid="ar-bulk-dontpay"
                      >
                        <X className="h-3 w-3 mr-1" /> Set Don't Pay
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs px-2 border-amber-300 text-amber-700 hover:bg-amber-50"
                        onClick={() => {
                          arSelectedBookings.forEach(id => {
                            const b = allBookings.find(bk => bk.bookingId === id);
                            if (b) {
                              setArActiveDisputes(prev => new Set(prev).add(id));
                              setArDisputeAmounts(prev => {
                                const newMap = new Map(prev);
                                newMap.set(id, Math.abs(b.spNetInHo - b.hoNet));
                                return newMap;
                              });
                            }
                          });
                        }}
                        data-testid="ar-bulk-dispute"
                      >
                        <AlertTriangle className="h-3 w-3 mr-1" /> Dispute Selected
                      </Button>
                    </div>
                  </div>
                )}

                {/* Footer */}
                {allBookings.length > 0 && (
                  <div className="flex items-center justify-between pt-3 border-t mt-2">
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>
                        <Check className="h-3 w-3 inline mr-1 text-green-500" />
                        Pay: {allBookings.filter(b => {
                          const d = arDecisions.get(b.bookingId);
                          return !d || d.decision === "pay";
                        }).length}
                      </span>
                      <span>
                        <X className="h-3 w-3 inline mr-1 text-red-500" />
                        Don't Pay: {allBookings.filter(b => {
                          const d = arDecisions.get(b.bookingId);
                          return d?.decision === "dont_pay";
                        }).length}
                      </span>
                      <span>
                        Disputes: {allBookings.filter(b => arActiveDisputes.has(b.bookingId)).length}
                      </span>
                    </div>
                    <div className="flex gap-6 text-xs">
                      <div>
                        <span className="text-muted-foreground mr-1">Excluded:</span>
                        <span className="font-mono font-medium text-red-600">
                          {formatNumber(allBookings.reduce((sum, b) => {
                            const d = arDecisions.get(b.bookingId);
                            if (d?.decision !== "dont_pay") return sum;
                            return sum + (d?.finalAmount ?? b.spNetInHo);
                          }, 0))}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground mr-1">Total Payable:</span>
                        <span className="font-mono font-semibold text-sm">
                          {formatNumber(allBookings.reduce((sum, b) => {
                            const d = arDecisions.get(b.bookingId);
                            if (d?.decision === "dont_pay") return sum;
                            return sum + (d?.finalAmount ?? b.spNetInHo);
                          }, 0))}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Cancellations Modal - Breakdown by Type */}
      <Dialog open={isCancellationsModalOpen} onOpenChange={setIsCancellationsModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-600" />
              Cancellations Breakdown
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Click on a cancellation type to view detailed bookings.
            </p>
            <div className="space-y-2">
              {cancellationData.breakdown.map((item) => (
                <Card 
                  key={item.reason}
                  className="cursor-pointer hover-elevate border-red-200 dark:border-red-900/50"
                  onClick={() => {
                    setIsCancellationsModalOpen(false);
                    setSelectedReason(item.reason);
                    setIsModalOpen(true);
                  }}
                  data-testid={`cancellation-type-${item.displayName}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="destructive" className="text-xs">
                          {item.displayName}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {item.count} booking{item.count !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-mono text-red-600 dark:text-red-400">
                          {formatNumber(item.discrepancyLc)} LC
                        </p>
                        <p className="text-xs font-mono text-muted-foreground">
                          {formatNumber(item.discrepancyUsd)} USD
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="pt-3 border-t">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Total Cancellations</span>
                <div className="text-right">
                  <p className="font-mono font-medium text-red-600 dark:text-red-400">
                    {formatNumber(cancellationData.totalDiscrepancyLc)} LC
                  </p>
                  <p className="text-xs font-mono text-muted-foreground">
                    {formatNumber(cancellationData.totalDiscrepancyUsd)} USD
                  </p>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
