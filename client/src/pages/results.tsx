import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, RefreshCw, Calendar, Download, FileSpreadsheet, Calculator, ChevronDown, ExternalLink, File } from "lucide-react";
import { SiGooglesheets } from "react-icons/si";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { AmountPayablePanel } from "@/components/amount-payable-panel";
import { Adjustment, BookingForPayable, FinalNetSelection } from "@/components/amount-payable-modal";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import type { RunResult, UploadedFile } from "@shared/schema";

interface ResultsPageProps {
  runId: string | null;
  uploadedFiles: UploadedFile[];
  onFilesUploaded: (files: File[]) => Promise<UploadedFile[]>;
  onLoadDemo: () => void;
  onExportGSheet: () => Promise<{ spreadsheetUrl?: string }>;
}

function LoadingSkeleton() {
  return (
    <div className="h-full p-6 space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UploadedFilesSection({ uploadedFiles }: { uploadedFiles: UploadedFile[] }) {
  if (uploadedFiles.length === 0) {
    return null;
  }

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Uploaded Files
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {uploadedFiles.map((file, index) => (
            <Badge 
              key={index} 
              variant="secondary" 
              className="flex items-center gap-1.5 py-1.5 px-3"
              data-testid={`badge-uploaded-file-${index}`}
            >
              <File className="h-3 w-3" />
              <span className="font-medium">{file.name}</span>
              <span className="text-muted-foreground text-xs">
                ({(file.size / 1024).toFixed(1)} KB)
              </span>
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SPDetailsSection({ 
  beId, 
  billingEntityName, 
  ticketId, 
  paymentBasis 
}: { 
  beId: string; 
  billingEntityName: string; 
  ticketId: string; 
  paymentBasis: string;
}) {
  if (!beId && !billingEntityName && !ticketId && !paymentBasis) {
    return null;
  }

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">SP Details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Billing Entity ID</p>
            <p className="font-mono font-semibold" data-testid="text-sp-be-id">
              {beId || "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Billing Entity Name</p>
            <p className="font-semibold" data-testid="text-sp-be-name">
              {billingEntityName || "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Ticket ID</p>
            <p className="font-mono font-semibold" data-testid="text-sp-ticket-id">
              {ticketId || "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Payment Basis</p>
            <p className="font-semibold" data-testid="text-sp-payment-basis">
              {paymentBasis || "—"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ResultsPage({ runId, uploadedFiles, onFilesUploaded, onLoadDemo, onExportGSheet }: ResultsPageProps) {
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [finalNetSelections, setFinalNetSelections] = useState<FinalNetSelection>({});
  const [showCalculator, setShowCalculator] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [gSheetUrl, setGSheetUrl] = useState<string | null>(null);
  const { toast } = useToast();

  const { data, isLoading, isError, error } = useQuery<RunResult>({
    queryKey: [`/api/runs/${runId}/results`],
    enabled: !!runId,
  });

  const bookingsForPayable = useMemo((): BookingForPayable[] => {
    if (!data) return [];
    const allRows = [...data.primaryRows, ...(data.unmappedRows || [])];
    return allRows.map(row => ({
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
  }, [data]);

  const spDetails = useMemo(() => {
    if (!data || data.primaryRows.length === 0) {
      return { beId: "", billingEntityName: "", ticketId: "", paymentBasis: "" };
    }
    const firstRow = data.primaryRows[0];
    return {
      beId: firstRow.beId || "",
      billingEntityName: firstRow.billingEntityName || "",
      ticketId: firstRow.ticketId || "",
      paymentBasis: firstRow.paymentBasis || "",
    };
  }, [data]);

  const finalAmountPayable = useMemo(() => {
    const baseAmount = bookingsForPayable.reduce((sum, b) => {
      if (b.reason === "Reconciled") {
        return sum + b.spNet;
      }
      const selection = finalNetSelections[b.bookingId] || "sp";
      return sum + (selection === "ho" ? b.hoNet : b.spNet);
    }, 0);
    
    return adjustments.reduce((total, adj) => {
      if (adj.type === "add") {
        return total + adj.amount;
      } else {
        return total - adj.amount;
      }
    }, baseAmount);
  }, [bookingsForPayable, finalNetSelections, adjustments]);

  const handlePayableModalApply = useCallback((
    newAdjustments: Adjustment[], 
    newSelections: FinalNetSelection, 
    _finalAmount: number
  ) => {
    setAdjustments(newAdjustments);
    setFinalNetSelections(newSelections);
  }, []);

  const handleExportExcel = () => {
    if (!runId || !data) {
      toast({ title: "No data to export", description: "Please run a reconciliation first", variant: "destructive" });
      return;
    }
    window.open(`/api/runs/${runId}/export`, "_blank");
    toast({ title: "Export started", description: "Excel file download will begin shortly" });
  };

  const handleExportGSheet = async () => {
    if (!runId || !data) {
      toast({ title: "No data to export", description: "Please run a reconciliation first", variant: "destructive" });
      return;
    }
    setIsExporting(true);
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
      setIsExporting(false);
    }
  };

  if (!runId) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-6">
          <UploadedFilesSection uploadedFiles={uploadedFiles} />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={LayoutDashboard}
            title="No results yet"
            description="Upload files and run a reconciliation to see your results dashboard"
          />
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (isError) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <EmptyState
          icon={LayoutDashboard}
          title="Error loading results"
          description={error instanceof Error ? error.message : "Something went wrong"}
        />
      </div>
    );
  }

  if (!data || data.primaryRows.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-6">
          <UploadedFilesSection uploadedFiles={uploadedFiles} />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={LayoutDashboard}
            title="No data found"
            description="The reconciliation completed but no matching records were found"
          />
        </div>
      </div>
    );
  }

  const totalBookings = data.overallSummary.reduce((sum, row) => sum + row.countBid, 0);
  const reconciledCount = data.overallSummary.find(r => r.reason === "Reconciled")?.countBid || 0;
  const discrepancyCount = totalBookings - reconciledCount;

  return (
    <div className="h-full">
      <PanelGroup direction="horizontal" className="h-full">
        <Panel defaultSize={showCalculator ? 50 : 100} minSize={35}>
          <ScrollArea className="h-full">
            <div className="p-6 space-y-6">
              <UploadedFilesSection uploadedFiles={uploadedFiles} />
              
              <SPDetailsSection 
                beId={spDetails.beId}
                billingEntityName={spDetails.billingEntityName}
                ticketId={spDetails.ticketId}
                paymentBasis={spDetails.paymentBasis}
              />

              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h1 className="text-2xl font-bold mb-1">Reconciliation Results</h1>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Run: <code className="font-mono text-foreground">{runId}</code></span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>FX: <code className="font-mono text-foreground">{data.fx.refreshedAt}</code></span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" disabled={isExporting} data-testid="button-export-dropdown">
                        {isExporting ? "Exporting..." : (
                          <>
                            <Download className="h-4 w-4 mr-2" />
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
              </div>

              <div className="grid grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Total Bookings</p>
                    <p className="text-2xl font-bold font-mono" data-testid="text-total-bookings">
                      {totalBookings.toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Reconciled</p>
                    <p className="text-2xl font-bold font-mono text-green-600 dark:text-green-400">
                      {reconciledCount.toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Discrepancies</p>
                    <p className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
                      {discrepancyCount.toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
                <Card
                  className={`cursor-pointer transition-all ${showCalculator ? 'ring-2 ring-primary' : 'hover-elevate'}`}
                  onClick={() => setShowCalculator(true)}
                  data-testid="card-amount-payable"
                >
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">
                      Amount Payable
                      {!showCalculator && <span className="ml-1 text-primary">(Click)</span>}
                    </p>
                    <p className="text-2xl font-bold font-mono text-primary" data-testid="text-amount-payable">
                      ${finalAmountPayable.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </ScrollArea>
        </Panel>

        {showCalculator && (
          <>
            <PanelResizeHandle className="w-1.5 bg-border hover:bg-primary/50 transition-colors" />
            
            <Panel defaultSize={50} minSize={30}>
              <AmountPayablePanel
                bookings={bookingsForPayable}
                currency="USD"
                adjustments={adjustments}
                finalNetSelections={finalNetSelections}
                onApply={handlePayableModalApply}
                onClose={() => setShowCalculator(false)}
                runId={runId}
                allRows={data.allRows}
              />
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
}
