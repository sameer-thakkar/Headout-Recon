import { useState, useCallback, useMemo } from "react";
import { Upload, FileSpreadsheet, X, Play, Download, ChevronRight, DollarSign, FileDown, Calculator, ChevronDown, ExternalLink } from "lucide-react";
import { SiGooglesheets } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
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
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Adjustment, BookingForPayable, FinalNetSelection } from "@/components/amount-payable-modal";
import { AmountPayablePanel } from "@/components/amount-payable-panel";
import type { UploadedFile, OverallSummaryRow, DiscrepancyAnalysisRow, PrimaryRow } from "@shared/schema";

interface UploadPageProps {
  onFilesUploaded: (files: File[]) => Promise<UploadedFile[]>;
  onLoadDemo: () => void;
  uploadedFiles: UploadedFile[];
  currentRunId: string | null;
  onExportGSheet: () => Promise<{ spreadsheetUrl?: string }>;
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

export function UploadPage({ onFilesUploaded, onLoadDemo, uploadedFiles, currentRunId, onExportGSheet }: UploadPageProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>(uploadedFiles);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [amountPayable, setAmountPayable] = useState<Record<string, number>>({});
  const [selectedPayableCurrency, setSelectedPayableCurrency] = useState<string | null>(null);
  const [adjustmentsPerCurrency, setAdjustmentsPerCurrency] = useState<Record<string, Adjustment[]>>({});
  const [finalNetSelectionsPerCurrency, setFinalNetSelectionsPerCurrency] = useState<Record<string, FinalNetSelection>>({});
  const [isExportingGSheet, setIsExportingGSheet] = useState(false);
  const [gSheetUrl, setGSheetUrl] = useState<string | null>(null);
  const [isSummaryOpen, setIsSummaryOpen] = useState(true);
  const { toast } = useToast();

  const { data: runResult } = useQuery<{
    overallSummary: OverallSummaryRow[];
    primaryRows: PrimaryRow[];
    unmappedRows: PrimaryRow[];
  }>({
    queryKey: ["/api/runs", currentRunId, "results"],
    enabled: !!currentRunId,
  });

  const { data: discrepancyData, isLoading: isDiscrepancyLoading } = useQuery<{ analysisRows: DiscrepancyAnalysisRow[] }>({
    queryKey: ["/api/runs", currentRunId, "discrepancy-analysis", selectedReason],
    enabled: !!currentRunId && !!selectedReason && isModalOpen,
  });

  const overallSummary = runResult?.overallSummary || [];
  const primaryRows = runResult?.primaryRows || [];
  const unmappedRows = runResult?.unmappedRows || [];

  const amountPayableData = useMemo(() => {
    const currencyTotals: Record<string, { spTotal: number; hoTotal: number }> = {};
    
    for (const row of primaryRows) {
      const currency = row.hoCurrency;
      if (!currencyTotals[currency]) {
        currencyTotals[currency] = { spTotal: 0, hoTotal: 0 };
      }
      currencyTotals[currency].spTotal += row.spNetOriginal;
      currencyTotals[currency].hoTotal += row.hoNet;
    }
    
    return Object.entries(currencyTotals).map(([currency, totals]) => ({
      currency,
      asPerSP: totals.spTotal,
      asPerHO: totals.hoTotal,
      finalPayable: amountPayable[currency] ?? totals.spTotal,
    }));
  }, [primaryRows, amountPayable]);

  const filteredDiscrepancyRows = useMemo(() => {
    if (!discrepancyData?.analysisRows || !selectedReason) return [];
    const filtered = discrepancyData.analysisRows.filter(row => row.reason === selectedReason);
    // For NPD, sort by discrepancy USD from low (most negative) to high
    if (selectedReason === "Net Price Discrepancy") {
      return [...filtered].sort((a, b) => (a.discrepancyUsd ?? 0) - (b.discrepancyUsd ?? 0));
    }
    return filtered;
  }, [discrepancyData?.analysisRows, selectedReason]);

  const bookingsForPayableModal = useMemo((): BookingForPayable[] => {
    if (!selectedPayableCurrency) return [];
    // Combine primary and unmapped rows
    const allRows = [...primaryRows, ...unmappedRows];
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
      }));
  }, [primaryRows, unmappedRows, selectedPayableCurrency]);

  const spDetails = useMemo(() => {
    const firstRow = primaryRows[0];
    if (!firstRow) return null;
    const currencySet = new Set(primaryRows.map(r => r.hoCurrency));
    const currencies = Array.from(currencySet);
    return {
      beId: firstRow.beId || "",
      billingEntityName: firstRow.billingEntityName || "",
      ticketId: firstRow.ticketId || "",
      paymentBasis: firstRow.paymentBasis || "",
      currency: currencies.join(", "),
    };
  }, [primaryRows]);

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
    try {
      const uploaded = await onFilesUploaded(newFiles);
      setFiles((prev) => [...prev, ...uploaded]);
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
      setIsUploading(false);
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

  const handleFinalPayableChange = (currency: string, value: string) => {
    const numValue = parseFloat(value) || 0;
    setAmountPayable(prev => ({ ...prev, [currency]: numValue }));
  };

  const openPayableCalculator = (currency: string) => {
    if (selectedPayableCurrency === currency) {
      setSelectedPayableCurrency(null);
    } else {
      setSelectedPayableCurrency(currency);
    }
  };

  const closePayableCalculator = () => {
    setSelectedPayableCurrency(null);
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
    
    setAmountPayable(prev => ({ ...prev, [selectedPayableCurrency]: finalAmount }));
  }, [selectedPayableCurrency]);

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

      const response = await fetch(`/api/runs/${currentRunId}/export`);
      if (!response.ok) {
        throw new Error("Failed to generate export");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const timestamp = new Date().toISOString().slice(0, 10);
      a.download = `reconciliation_export_${timestamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Export complete",
        description: "Your reconciliation report has been downloaded",
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

  const handleExportGSheet = useCallback(async () => {
    if (!currentRunId) {
      toast({
        title: "No data to export",
        description: "Please run a reconciliation first",
        variant: "destructive",
      });
      return;
    }
    
    setIsExportingGSheet(true);
    setGSheetUrl(null);
    try {
      const result = await onExportGSheet();
      if (result.spreadsheetUrl) {
        setGSheetUrl(result.spreadsheetUrl);
        toast({ title: "Export complete", description: "Google Sheet created successfully" });
      }
    } catch (error) {
      toast({ title: "Export failed", description: "Could not create Google Sheet", variant: "destructive" });
    } finally {
      setIsExportingGSheet(false);
    }
  }, [currentRunId, onExportGSheet, toast]);

  const hasResults = currentRunId && overallSummary.length > 0;
  const isMTBReason = selectedReason === "Multiple Tickets Booked";
  const isNPDReason = selectedReason === "Net Price Discrepancy";

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
            <Upload className="h-4 w-4 mr-1.5" />
            {isUploading ? "Uploading..." : "Upload"}
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

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">

          {spDetails && hasResults && (
            <div className="grid grid-cols-5 gap-4 text-sm border-b pb-4" data-testid="sp-details-section">
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
                      <CardTitle className="text-base">Overall Reconciliation Summary</CardTitle>
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
                            <DropdownMenuItem onClick={handleExportGSheet} data-testid="menu-export-gsheet">
                              <SiGooglesheets className="h-4 w-4 mr-2" />
                              Google Sheets
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {gSheetUrl && (
                          <a
                            href={gSheetUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-sm text-green-600 hover:underline"
                            data-testid="link-gsheet"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Open Sheet
                          </a>
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
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Reason</TableHead>
                          <TableHead>Currency</TableHead>
                          <TableHead className="text-right">Discrepancy (LC)</TableHead>
                          <TableHead className="text-right">Discrepancy (USD)</TableHead>
                          <TableHead className="text-right">Count BID</TableHead>
                          <TableHead className="w-8"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {overallSummary.map((row, index) => {
                          const isClickable = row.reason !== "Reconciled";
                          return (
                            <TableRow
                              key={`${row.reason}-${row.currency}-${index}`}
                              className={isClickable ? "cursor-pointer hover-elevate" : ""}
                              onClick={() => isClickable && handleReasonClick(row.reason)}
                              data-testid={`summary-row-${row.reason}-${row.currency}`}
                            >
                              <TableCell>
                                <Badge 
                                  variant={row.reason === "Reconciled" ? "default" : "secondary"}
                                  className="text-xs"
                                >
                                  {row.reason}
                                </Badge>
                              </TableCell>
                              <TableCell>{row.currency}</TableCell>
                              <TableCell className="text-right font-mono">
                                {formatNumber(row.discrepancyLc)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatNumber(row.discrepancyUsd)}
                              </TableCell>
                              <TableCell className="text-right">{row.countBid}</TableCell>
                              <TableCell>
                                {isClickable && (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
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
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Amount Payable
              </CardTitle>
              {!hasResults && (
                <CardDescription>
                  Summary will appear after processing
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {hasResults ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Currency</TableHead>
                      <TableHead className="text-right">As per SP</TableHead>
                      <TableHead className="text-right">As per HO</TableHead>
                      <TableHead className="text-right">Final Payable</TableHead>
                      <TableHead className="text-center">Calculate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {amountPayableData.map((row) => (
                      <TableRow key={row.currency} data-testid={`payable-row-${row.currency}`}>
                        <TableCell className="font-medium">{row.currency}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatNumber(row.asPerSP)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatNumber(row.asPerHO)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={amountPayable[row.currency] ?? row.asPerSP}
                            onChange={(e) => handleFinalPayableChange(row.currency, e.target.value)}
                            className="w-32 h-8 text-right font-mono ml-auto"
                            data-testid={`input-payable-${row.currency}`}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openPayableCalculator(row.currency)}
                            data-testid={`button-calculate-${row.currency}`}
                          >
                            <Calculator className="h-4 w-4 mr-1" />
                            Calculate
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-16 flex items-center justify-center text-muted-foreground">
                  <p className="text-sm">No data yet</p>
                </div>
              )}
            </CardContent>
          </Card>

          {selectedPayableCurrency && (
            <Card>
              <CardContent className="p-0">
                <AmountPayablePanel
                  bookings={bookingsForPayableModal}
                  currency={selectedPayableCurrency}
                  adjustments={adjustmentsPerCurrency[selectedPayableCurrency] || []}
                  finalNetSelections={finalNetSelectionsPerCurrency[selectedPayableCurrency] || {}}
                  onApply={handlePayableModalApply}
                  onClose={closePayableCalculator}
                  runId={currentRunId}
                  allRows={primaryRows}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>

      <Dialog open={isModalOpen} onOpenChange={handleModalClose}>
        <DialogContent className="max-w-[95vw] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Discrepancy Analysis: {selectedReason}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <Table className="min-w-max">
              <TableHeader>
                <TableRow>
                  <TableHead>TID</TableHead>
                  {isMTBReason && (
                    <>
                      <TableHead className="text-right">Discrepancy USD</TableHead>
                      <TableHead>Fulfilment Method</TableHead>
                      <TableHead>Times Charged</TableHead>
                      <TableHead>Start Date</TableHead>
                      <TableHead>End Date</TableHead>
                      <TableHead className="text-right">BID Count</TableHead>
                      <TableHead className="text-right">BID Count Duration</TableHead>
                      <TableHead className="text-right">Total BIDs</TableHead>
                      <TableHead>DRI Team</TableHead>
                    </>
                  )}
                  {isNPDReason && (
                    <>
                      <TableHead className="text-right">Discrepancy USD</TableHead>
                      <TableHead>Fulfilment Method</TableHead>
                      <TableHead className="text-right">HO Take Rate</TableHead>
                      <TableHead className="text-right">Actual Rate</TableHead>
                      <TableHead>Start Date</TableHead>
                      <TableHead>End Date</TableHead>
                      <TableHead className="text-right">Discrepancy %</TableHead>
                      <TableHead className="text-right">BID Count with Discrepancy</TableHead>
                      <TableHead className="text-right">BID Count in Duration</TableHead>
                      <TableHead>Sold at Loss</TableHead>
                      <TableHead className="text-right">Loss USD</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDiscrepancyRows.map((row, index) => (
                  <TableRow key={`${row.tid}-${index}`} data-testid={`modal-row-${row.tid}`}>
                    <TableCell className="font-mono">{row.tid}</TableCell>
                    {isMTBReason && (
                      <>
                        <TableCell className="text-right font-mono">
                          {formatNumber(row.discrepancyUsd)}
                        </TableCell>
                        <TableCell>{row.fulfillmentMethod}</TableCell>
                        <TableCell>{row.timesCharged}</TableCell>
                        <TableCell>{formatDateDDMMYYYY(row.startDate) || "-"}</TableCell>
                        <TableCell>{formatDateDDMMYYYY(row.endDate) || "-"}</TableCell>
                        <TableCell className="text-right">{row.countBidWithDiscrepancy}</TableCell>
                        <TableCell className="text-right">{row.countBidsInDuration}</TableCell>
                        <TableCell className="text-right">{row.totalBidsInReport}</TableCell>
                        <TableCell>{row.driTeam}</TableCell>
                      </>
                    )}
                    {isNPDReason && (
                      <>
                        <TableCell className={`text-right font-mono ${(row.discrepancyUsd ?? 0) < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                          {formatNumber(row.discrepancyUsd)}
                        </TableCell>
                        <TableCell>{row.fulfillmentMethod}</TableCell>
                        <TableCell className="text-right font-mono">
                          {row.hoTakeRatePercent?.toFixed(2) ?? "-"}%
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {row.actualTakeRatePercent?.toFixed(2) ?? "-"}%
                        </TableCell>
                        <TableCell>{formatDateDDMMYYYY(row.startDate) || "-"}</TableCell>
                        <TableCell>{formatDateDDMMYYYY(row.endDate) || "-"}</TableCell>
                        <TableCell className={`text-right font-mono ${row.discrepancyPercentRange?.startsWith("-") ? "text-red-600 dark:text-red-400" : ""}`}>
                          {row.discrepancyPercentRange || "-"}
                        </TableCell>
                        <TableCell className="text-right">{row.countBidWithDiscrepancy}</TableCell>
                        <TableCell className="text-right">{row.countBidsInDuration}</TableCell>
                        <TableCell>
                          <Badge variant={row.soldAtLoss === "Yes" ? "destructive" : "secondary"}>
                            {row.soldAtLoss || "-"}
                          </Badge>
                        </TableCell>
                        <TableCell className={`text-right font-mono ${(row.lossUsd ?? 0) > 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                          {row.lossUsd != null ? formatNumber(row.lossUsd) : "-"}
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
                {isDiscrepancyLoading && (
                  <TableRow>
                    <TableCell 
                      colSpan={isMTBReason ? 10 : isNPDReason ? 12 : 6} 
                      className="text-center py-8 text-muted-foreground"
                    >
                      Loading discrepancy data...
                    </TableCell>
                  </TableRow>
                )}
                {!isDiscrepancyLoading && filteredDiscrepancyRows.length === 0 && (
                  <TableRow>
                    <TableCell 
                      colSpan={isMTBReason ? 10 : isNPDReason ? 12 : 6} 
                      className="text-center py-8 text-muted-foreground"
                    >
                      No discrepancy data available for this reason
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
