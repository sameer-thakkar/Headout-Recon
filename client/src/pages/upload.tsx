import { useState, useCallback, useMemo } from "react";
import { Upload, FileSpreadsheet, X, Play, Download, ChevronRight, DollarSign, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import type { UploadedFile, OverallSummaryRow, DiscrepancyAnalysisRow, PrimaryRow } from "@shared/schema";

interface UploadPageProps {
  onFilesUploaded: (files: File[]) => Promise<UploadedFile[]>;
  onLoadDemo: () => void;
  uploadedFiles: UploadedFile[];
  currentRunId: string | null;
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

export function UploadPage({ onFilesUploaded, onLoadDemo, uploadedFiles, currentRunId }: UploadPageProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>(uploadedFiles);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [amountPayable, setAmountPayable] = useState<Record<string, number>>({});
  const { toast } = useToast();

  const { data: runResult } = useQuery<{
    overallSummary: OverallSummaryRow[];
    primaryRows: PrimaryRow[];
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
    return discrepancyData.analysisRows.filter(row => row.reason === selectedReason);
  }, [discrepancyData?.analysisRows, selectedReason]);

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

  const handleExportExcel = useCallback(() => {
    if (primaryRows.length === 0) {
      toast({
        title: "No data to export",
        description: "Please run a reconciliation first",
        variant: "destructive",
      });
      return;
    }

    const exportData = primaryRows.map((row) => ({
      "Booking ID": row.bookingId,
      "Reason": row.reason,
      "Currency": row.hoCurrency,
      "HO Net": row.hoNet,
      "SP Net (Original)": row.spNetOriginal,
      "SP Currency": row.spCurrency,
      "SP Net (Converted)": row.spNetInHo,
      "Difference (LC)": row.differenceLc,
      "Difference (%)": row.differencePct != null ? `${row.differencePct.toFixed(2)}%` : "-",
      "Difference (USD)": row.differenceUsd,
      "FX Rate Used": row.fxRateUsed,
      "Booking Status": row.bookingStatus,
      "TID": row.tid || "-",
      "Fulfillment Method": row.fulfillmentMethod || "-",
      "DRI Team": row.driTeam || "-",
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Booking Summary");

    const colWidths = [
      { wch: 15 }, { wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 15 },
      { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 15 },
      { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 18 }, { wch: 15 },
    ];
    worksheet["!cols"] = colWidths;

    const timestamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `booking-summary-${timestamp}.xlsx`);

    toast({
      title: "Export complete",
      description: `Exported ${primaryRows.length} bookings to Excel`,
    });
  }, [primaryRows, toast]);

  const hasResults = currentRunId && overallSummary.length > 0;
  const isMTBReason = selectedReason === "Multiple Tickets Booked";
  const isNPDReason = selectedReason === "Net Price Discrepancy";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 border-b flex-shrink-0">
        <h1 className="text-2xl font-bold">Reconciliation</h1>
        <p className="text-sm text-muted-foreground">
          Upload files and view reconciliation results
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Upload Files</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 items-start">
                <div
                  className={`flex-1 border-2 border-dashed rounded-lg h-24 flex flex-col items-center justify-center cursor-pointer transition-colors ${
                    isDragging
                      ? "border-primary bg-primary/5"
                      : "border-muted-foreground/25 hover:border-primary/50"
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById("file-input")?.click()}
                  data-testid="dropzone"
                >
                  <input
                    id="file-input"
                    type="file"
                    accept=".xlsx,.csv"
                    multiple
                    className="hidden"
                    onChange={handleFileSelect}
                    data-testid="input-file"
                  />
                  <Upload className={`h-6 w-6 mb-1 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
                  <p className="text-xs text-center font-medium">
                    {isUploading ? "Uploading..." : "Drop files or click to upload"}
                  </p>
                  <p className="text-xs text-muted-foreground">.xlsx, .csv</p>
                </div>

                <div className="flex flex-col gap-2">
                  <a
                    href="/sample-reconciliation-template.xlsx"
                    download="sample-reconciliation-template.xlsx"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    data-testid="link-download-template"
                  >
                    <Download className="h-3 w-3" />
                    Download template
                  </a>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onLoadDemo}
                    data-testid="button-load-demo"
                  >
                    <Play className="h-3 w-3 mr-1" />
                    Load Demo
                  </Button>
                </div>

                {files.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {files.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted/50 text-xs"
                        data-testid={`file-item-${file.id}`}
                      >
                        <FileSpreadsheet className="h-4 w-4 text-chart-2" />
                        <span className="max-w-[120px] truncate">{file.name}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => removeFile(file.id)}
                          data-testid={`button-remove-${file.id}`}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-base">Overall Reconciliation Summary</CardTitle>
                {hasResults && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportExcel}
                    data-testid="button-export-excel"
                  >
                    <FileDown className="h-4 w-4 mr-1" />
                    Export Excel
                  </Button>
                )}
              </div>
              {!hasResults && (
                <CardDescription>
                  Upload a file to see reconciliation summary
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
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
          </Card>

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
                  <TableHead>Currency</TableHead>
                  <TableHead className="text-right">Discrepancy (LC)</TableHead>
                  <TableHead className="text-right">Discrepancy (USD)</TableHead>
                  <TableHead>Fulfillment Method</TableHead>
                  {isMTBReason && (
                    <>
                      <TableHead>Times Charged</TableHead>
                      <TableHead>Start Date</TableHead>
                      <TableHead>End Date</TableHead>
                      <TableHead className="text-right">BID Count</TableHead>
                      <TableHead className="text-right">Coverage %</TableHead>
                      <TableHead>Frequency</TableHead>
                    </>
                  )}
                  {isNPDReason && (
                    <>
                      <TableHead className="text-right">HO Take Rate %</TableHead>
                      <TableHead className="text-right">Actual Take Rate %</TableHead>
                      <TableHead>Discrepancy % Range</TableHead>
                      <TableHead>Pattern</TableHead>
                      <TableHead>Sold at Loss</TableHead>
                      <TableHead className="text-right">Loss (LC)</TableHead>
                      <TableHead className="text-right">Loss (USD)</TableHead>
                    </>
                  )}
                  <TableHead>DRI Team</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDiscrepancyRows.map((row, index) => (
                  <TableRow key={`${row.tid}-${index}`} data-testid={`modal-row-${row.tid}`}>
                    <TableCell className="font-mono">{row.tid}</TableCell>
                    <TableCell>{row.currency}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNumber(row.discrepancyLc)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNumber(row.discrepancyUsd)}
                    </TableCell>
                    <TableCell>{row.fulfillmentMethod}</TableCell>
                    {isMTBReason && (
                      <>
                        <TableCell>{row.timesCharged}</TableCell>
                        <TableCell>{formatDateDDMMYYYY(row.startDate) || "-"}</TableCell>
                        <TableCell>{formatDateDDMMYYYY(row.endDate) || "-"}</TableCell>
                        <TableCell className="text-right">{row.countBidWithDiscrepancy}</TableCell>
                        <TableCell className="text-right">
                          {row.discrepancyCoveragePercent.toFixed(1)}%
                        </TableCell>
                        <TableCell>
                          <Badge variant={row.frequency === "Recurring" ? "default" : "secondary"}>
                            {row.frequency}
                          </Badge>
                        </TableCell>
                      </>
                    )}
                    {isNPDReason && (
                      <>
                        <TableCell className="text-right font-mono">
                          {row.hoTakeRatePercent?.toFixed(2) ?? "-"}%
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {row.actualTakeRatePercent?.toFixed(2) ?? "-"}%
                        </TableCell>
                        <TableCell>{row.discrepancyPercentRange || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={row.pattern === "Consistent" ? "default" : "secondary"}>
                            {row.pattern || "-"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={row.soldAtLoss === "Yes" ? "destructive" : "secondary"}>
                            {row.soldAtLoss || "-"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {row.lossLc != null ? formatNumber(row.lossLc) : "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {row.lossUsd != null ? formatNumber(row.lossUsd) : "-"}
                        </TableCell>
                      </>
                    )}
                    <TableCell>{row.driTeam}</TableCell>
                  </TableRow>
                ))}
                {isDiscrepancyLoading && (
                  <TableRow>
                    <TableCell 
                      colSpan={isMTBReason ? 12 : isNPDReason ? 14 : 6} 
                      className="text-center py-8 text-muted-foreground"
                    >
                      Loading discrepancy data...
                    </TableCell>
                  </TableRow>
                )}
                {!isDiscrepancyLoading && filteredDiscrepancyRows.length === 0 && (
                  <TableRow>
                    <TableCell 
                      colSpan={isMTBReason ? 12 : isNPDReason ? 14 : 6} 
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
