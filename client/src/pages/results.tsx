import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, RefreshCw, Calendar, Download, Upload, FileSpreadsheet, X, Calculator } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { DataTable, Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { AmountPayablePanel } from "@/components/amount-payable-panel";
import { Adjustment, BookingForPayable, FinalNetSelection } from "@/components/amount-payable-modal";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { RunResult, OverallSummaryRow, PrimaryRow, UploadedFile } from "@shared/schema";

interface ResultsPageProps {
  runId: string | null;
  uploadedFiles: UploadedFile[];
  onFilesUploaded: (files: File[]) => Promise<UploadedFile[]>;
  onLoadDemo: () => void;
}

const summaryColumns: Column<OverallSummaryRow>[] = [
  { key: "reason", header: "Reason", sortable: true },
  { key: "currency", header: "Currency", sortable: true },
  {
    key: "discrepancyLc",
    header: "Discrepancy LC",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => {
      const num = value as number;
      return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
  },
  {
    key: "discrepancyUsd",
    header: "Discrepancy USD",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => {
      const num = value as number;
      return `$${num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },
  },
  {
    key: "countBid",
    header: "Count of BID",
    sortable: true,
    align: "right",
    className: "font-mono",
  },
];

const bookingColumns: Column<PrimaryRow>[] = [
  { key: "bookingId", header: "Booking ID", sortable: true },
  { key: "fulfillmentIdentifier", header: "Type", sortable: true },
  { 
    key: "bookingCreationDate", 
    header: "Creation Date", 
    sortable: true,
    render: (value) => {
      if (!value) return <span className="text-muted-foreground">N/A</span>;
      return String(value);
    },
  },
  { key: "hoCurrency", header: "Currency", sortable: true },
  {
    key: "hoNet",
    header: "HO Net",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => {
      const num = value as number;
      return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
  },
  {
    key: "spNetOriginal",
    header: "SP Net Original",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => {
      const num = value as number;
      return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
  },
  {
    key: "spNetInHo",
    header: "SP Net (HO Ccy)",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => {
      const num = value as number;
      return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
  },
  {
    key: "differenceLc",
    header: "Difference LC",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => {
      const num = value as number;
      const formatted = num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const color = num > 0 ? "text-red-600 dark:text-red-400" : num < 0 ? "text-green-600 dark:text-green-400" : "";
      return <span className={color}>{formatted}</span>;
    },
  },
  {
    key: "differenceUsd",
    header: "Difference USD",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => {
      const num = value as number;
      const formatted = `$${num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const color = num > 0 ? "text-red-600 dark:text-red-400" : num < 0 ? "text-green-600 dark:text-green-400" : "";
      return <span className={color}>{formatted}</span>;
    },
  },
  { key: "reason", header: "Reason", sortable: true },
];

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

function FileUploadSection({ 
  uploadedFiles, 
  onFilesUploaded, 
  onLoadDemo,
  isUploading,
  setIsUploading 
}: { 
  uploadedFiles: UploadedFile[];
  onFilesUploaded: (files: File[]) => Promise<UploadedFile[]>;
  onLoadDemo: () => void;
  isUploading: boolean;
  setIsUploading: (v: boolean) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      f => f.name.endsWith('.xlsx') || f.name.endsWith('.csv')
    );
    
    if (droppedFiles.length > 0) {
      setIsUploading(true);
      try {
        await onFilesUploaded(droppedFiles);
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      setIsUploading(true);
      try {
        await onFilesUploaded(selectedFiles);
      } finally {
        setIsUploading(false);
      }
    }
  };

  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          <div 
            className={`flex-1 border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
              isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            data-testid="dropzone-upload"
          >
            <div className="flex items-center justify-center gap-3">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <div className="text-sm">
                <label className="text-primary cursor-pointer hover:underline" data-testid="label-browse-files">
                  <input 
                    type="file" 
                    className="hidden" 
                    accept=".xlsx,.csv"
                    multiple
                    onChange={handleFileSelect}
                    disabled={isUploading}
                    data-testid="input-file-upload"
                  />
                  Browse files
                </label>
                <span className="text-muted-foreground"> or drag & drop</span>
              </div>
              {uploadedFiles.length > 0 && (
                <Badge variant="secondary" className="ml-2" data-testid="badge-files-uploaded">
                  <FileSpreadsheet className="h-3 w-3 mr-1" />
                  {uploadedFiles.length} file{uploadedFiles.length > 1 ? 's' : ''} uploaded
                </Badge>
              )}
            </div>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onLoadDemo}
            disabled={isUploading}
            data-testid="button-load-demo"
          >
            Load Demo
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ResultsPage({ runId, uploadedFiles, onFilesUploaded, onLoadDemo }: ResultsPageProps) {
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [finalNetSelections, setFinalNetSelections] = useState<FinalNetSelection>({});
  const [showCalculator, setShowCalculator] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

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
    }));
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

  const handleExport = () => {
    window.open(`/api/runs/${runId}/export`, "_blank");
  };

  // Empty state - no run yet
  if (!runId) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-6">
          <FileUploadSection 
            uploadedFiles={uploadedFiles}
            onFilesUploaded={onFilesUploaded}
            onLoadDemo={onLoadDemo}
            isUploading={isUploading}
            setIsUploading={setIsUploading}
          />
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
          <FileUploadSection 
            uploadedFiles={uploadedFiles}
            onFilesUploaded={onFilesUploaded}
            onLoadDemo={onLoadDemo}
            isUploading={isUploading}
            setIsUploading={setIsUploading}
          />
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

  const totalDiscrepancyUsd = data.overallSummary.reduce((sum, row) => sum + row.discrepancyUsd, 0);
  const totalBookings = data.overallSummary.reduce((sum, row) => sum + row.countBid, 0);
  const reconciledCount = data.overallSummary.find(r => r.reason === "Reconciled")?.countBid || 0;
  const discrepancyCount = totalBookings - reconciledCount;

  return (
    <div className="h-full">
      <PanelGroup direction="horizontal" className="h-full">
        {/* Left Panel - Summary & Data */}
        <Panel defaultSize={showCalculator ? 50 : 100} minSize={35}>
          <ScrollArea className="h-full">
            <div className="p-6 space-y-6">
              {/* File Upload Section */}
              <FileUploadSection 
                uploadedFiles={uploadedFiles}
                onFilesUploaded={onFilesUploaded}
                onLoadDemo={onLoadDemo}
                isUploading={isUploading}
                setIsUploading={setIsUploading}
              />

              {/* Header with actions */}
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
                <Button onClick={handleExport} size="sm" data-testid="button-export">
                  <Download className="h-4 w-4 mr-2" />
                  Export Excel
                </Button>
              </div>

              {/* Stats Cards */}
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

              {/* Summary Table */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Overall Reconciliation Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <DataTable
                    columns={summaryColumns}
                    data={data.overallSummary}
                    defaultSortKey="discrepancyUsd"
                    defaultSortDir="asc"
                    testIdPrefix="table-summary"
                    emptyMessage="No summary data available"
                  />
                </CardContent>
              </Card>

              {/* Booking Details Table */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Booking-Level Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <DataTable
                    columns={bookingColumns}
                    data={data.allRows}
                    defaultSortKey="bookingId"
                    defaultSortDir="asc"
                    testIdPrefix="table-bookings"
                    emptyMessage="No booking data available"
                  />
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </Panel>

        {/* Resize Handle */}
        {showCalculator && (
          <>
            <PanelResizeHandle className="w-1.5 bg-border hover:bg-primary/50 transition-colors" />
            
            {/* Right Panel - Amount Payable Calculator */}
            <Panel defaultSize={50} minSize={30}>
              <AmountPayablePanel
                bookings={bookingsForPayable}
                currency="USD"
                adjustments={adjustments}
                finalNetSelections={finalNetSelections}
                onApply={handlePayableModalApply}
                onClose={() => setShowCalculator(false)}
                runId={runId}
              />
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
}
