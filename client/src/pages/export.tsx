import { useState } from "react";
import { Link } from "wouter";
import { Download, FileSpreadsheet, Clock, ExternalLink, ChevronDown, BarChart3, DollarSign, Lock, ArrowRight, FileText, Loader2, History } from "lucide-react";
import { SiGooglesheets } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { ValidationModal } from "@/components/validation-modal";

interface ExportHistoryEntry {
  reportType: string;
  format: string;
  timestamp: string;
}

interface ExportPageProps {
  hasResults: boolean;
  onExportZip: () => Promise<void>;
  onExportAnalysisXlsx: () => Promise<void>;
  onExportFinancialXlsx: () => Promise<void>;
  onExportAnalysisGSheet: () => Promise<{ spreadsheetUrl?: string }>;
  onExportFinancialGSheet: () => Promise<{ spreadsheetUrl?: string }>;
  isReconciliationFinalized: boolean;
  lastExportTimestamp: string | null;
  analysisGSheetUrl: string | null;
  financialGSheetUrl: string | null;
  exportHistory: ExportHistoryEntry[];
  currentRunId: string | null;
}

function getExpectedFilename(reportType: "analysis" | "financial") {
  const date = new Date().toISOString().slice(0, 10);
  if (reportType === "analysis") {
    return `discrepancy_analysis_${date}.xlsx`;
  }
  return `reconciliation_report_${date}.xlsx`;
}

function formatTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function ExportPage({
  hasResults,
  onExportZip,
  onExportAnalysisXlsx,
  onExportFinancialXlsx,
  onExportAnalysisGSheet,
  onExportFinancialGSheet,
  isReconciliationFinalized,
  lastExportTimestamp,
  analysisGSheetUrl,
  financialGSheetUrl,
  exportHistory,
  currentRunId,
}: ExportPageProps) {
  const [isExportingAnalysis, setIsExportingAnalysis] = useState(false);
  const [isExportingFinancial, setIsExportingFinancial] = useState(false);
  const [analysisExportStep, setAnalysisExportStep] = useState<string | null>(null);
  const [financialExportStep, setFinancialExportStep] = useState<string | null>(null);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [pendingExportFormat, setPendingExportFormat] = useState<"excel" | "gsheet">("excel");
  const { toast } = useToast();

  const handleExportAnalysisXlsx = async () => {
    setIsExportingAnalysis(true);
    setAnalysisExportStep("Preparing Excel file...");
    try {
      await onExportAnalysisXlsx();
      setAnalysisExportStep(null);
      toast({ title: "Export complete", description: "Discrepancy Analysis downloaded" });
    } catch (error) {
      setAnalysisExportStep(null);
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setIsExportingAnalysis(false);
    }
  };

  const handleExportAnalysisGSheet = async () => {
    setIsExportingAnalysis(true);
    setAnalysisExportStep("Creating Google Sheet...");
    try {
      setAnalysisExportStep("Uploading data & formatting...");
      const result = await onExportAnalysisGSheet();
      if (result.spreadsheetUrl) {
        setAnalysisExportStep(null);
        toast({ title: "Export complete", description: "Discrepancy Analysis Google Sheet created" });
      }
    } catch (error) {
      setAnalysisExportStep(null);
      toast({ title: "Export failed", description: "Could not create Google Sheet", variant: "destructive" });
    } finally {
      setIsExportingAnalysis(false);
    }
  };

  const handleRequestFinancialExport = (format: "excel" | "gsheet") => {
    setPendingExportFormat(format);
    setShowValidationModal(true);
  };

  const handleValidationProceed = async () => {
    setShowValidationModal(false);
    
    if (pendingExportFormat === "excel") {
      setIsExportingFinancial(true);
      setFinancialExportStep("Preparing Excel file...");
      try {
        await onExportFinancialXlsx();
        setFinancialExportStep(null);
        toast({ title: "Export complete", description: "Reconciliation Report downloaded" });
      } catch (error) {
        setFinancialExportStep(null);
        toast({ title: "Export failed", variant: "destructive" });
      } finally {
        setIsExportingFinancial(false);
      }
    } else {
      setIsExportingFinancial(true);
      setFinancialExportStep("Creating Google Sheet...");
      try {
        setFinancialExportStep("Uploading data & formatting...");
        const result = await onExportFinancialGSheet();
        if (result.spreadsheetUrl) {
          setFinancialExportStep(null);
          toast({ title: "Export complete", description: "Reconciliation Report Google Sheet created" });
        }
      } catch (error) {
        setFinancialExportStep(null);
        toast({ title: "Export failed", description: "Could not create Google Sheet", variant: "destructive" });
      } finally {
        setIsExportingFinancial(false);
      }
    }
  };

  if (!hasResults) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-8">
        <EmptyState
          icon={Download}
          title="Nothing to export"
          description="Run a reconciliation first to export results"
        />
      </div>
    );
  }

  const analysisSheets = [
    { name: "Discrepancy Analysis", desc: "Grouped by reason code with TID-level breakdown" },
    { name: "Draft Messages", desc: "Pre-formatted communication templates for DRI teams" },
    { name: "DRI - [Team Name]", desc: "One sheet per DRI team with their assigned bookings" },
  ];

  const financialSheets = [
    { name: "Payable Summary", desc: "Net payable amounts by currency with adjustments" },
    { name: "SP_INVOICE_REPORT", desc: "Supplier invoice data with FX conversion applied" },
    { name: "HO Report Updated", desc: "Full booking details with total amount payable and reasons" },
  ];

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-export-title">Export</h1>
        <p className="text-muted-foreground">
          Download your reconciliation results as two separate reports
        </p>
      </div>

      <div className="grid gap-6">
        {/* Discrepancy Analysis Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-chart-2/10 flex items-center justify-center">
                <BarChart3 className="h-6 w-6 text-chart-2" />
              </div>
              <div>
                <CardTitle className="text-lg" data-testid="text-analysis-card-title">Discrepancy Analysis</CardTitle>
                <CardDescription>Analysis results, communication templates, and team views</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Sheets included:</p>
              <div className="space-y-1.5">
                {analysisSheets.map((sheet, i) => (
                  <div key={sheet.name} className="flex items-start gap-2 text-sm" data-testid={`text-analysis-sheet-${i}`}>
                    <FileText className="h-3.5 w-3.5 mt-0.5 text-chart-2 shrink-0" />
                    <div>
                      <span className="font-medium">{sheet.name}</span>
                      <span className="text-muted-foreground"> — {sheet.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-start justify-between gap-4 pt-2 border-t">
              <div className="text-xs text-muted-foreground space-y-1">
                <div className="flex items-center gap-1.5">
                  <FileSpreadsheet className="h-3 w-3" />
                  <span data-testid="text-analysis-filename">File: <span className="font-mono">{getExpectedFilename("analysis")}</span></span>
                </div>
                {analysisGSheetUrl && (
                  <a
                    href={analysisGSheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-green-600 hover:underline"
                    data-testid="link-analysis-gsheet"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open Discrepancy Analysis Sheet
                  </a>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button disabled={isExportingAnalysis} data-testid="button-export-analysis-dropdown">
                      {isExportingAnalysis ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {analysisExportStep || "Exporting..."}
                        </span>
                      ) : (
                        <>
                          <Download className="h-4 w-4 mr-2" />
                          Export
                          <ChevronDown className="h-4 w-4 ml-2" />
                        </>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={handleExportAnalysisXlsx}
                      data-testid="menu-export-analysis-excel"
                    >
                      <FileSpreadsheet className="h-4 w-4 mr-2" />
                      Excel (.xlsx)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleExportAnalysisGSheet}
                      data-testid="menu-export-analysis-gsheet"
                    >
                      <SiGooglesheets className="h-4 w-4 mr-2" />
                      Google Sheets
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Reconciliation Report Card */}
        <Card className={!isReconciliationFinalized ? "opacity-60" : ""}>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${isReconciliationFinalized ? "bg-chart-4/10" : "bg-muted"}`}>
                {isReconciliationFinalized ? (
                  <DollarSign className="h-6 w-6 text-chart-4" />
                ) : (
                  <Lock className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div>
                <CardTitle className="text-lg" data-testid="text-financial-card-title">Reconciliation Report</CardTitle>
                <CardDescription>
                  {isReconciliationFinalized
                    ? "Finalized payable amounts, supplier invoice, and updated HO report"
                    : "Locked until reconciliation is finalized"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Sheets included:</p>
              <div className="space-y-1.5">
                {financialSheets.map((sheet, i) => (
                  <div key={sheet.name} className="flex items-start gap-2 text-sm" data-testid={`text-financial-sheet-${i}`}>
                    <FileText className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${isReconciliationFinalized ? "text-chart-4" : "text-muted-foreground"}`} />
                    <div>
                      <span className="font-medium">{sheet.name}</span>
                      <span className="text-muted-foreground"> — {sheet.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-start justify-between gap-4 pt-2 border-t">
              {isReconciliationFinalized ? (
                <>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div className="flex items-center gap-1.5">
                      <FileSpreadsheet className="h-3 w-3" />
                      <span data-testid="text-financial-filename">File: <span className="font-mono">{getExpectedFilename("financial")}</span></span>
                    </div>
                    {financialGSheetUrl && (
                      <a
                        href={financialGSheetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-green-600 hover:underline"
                        data-testid="link-financial-gsheet"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open Reconciliation Report Sheet
                      </a>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button disabled={isExportingFinancial} data-testid="button-export-financial-dropdown">
                          {isExportingFinancial ? (
                            <span className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              {financialExportStep || "Exporting..."}
                            </span>
                          ) : (
                            <>
                              <Download className="h-4 w-4 mr-2" />
                              Export
                              <ChevronDown className="h-4 w-4 ml-2" />
                            </>
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleRequestFinancialExport("excel")}
                          data-testid="menu-export-financial-excel"
                        >
                          <FileSpreadsheet className="h-4 w-4 mr-2" />
                          Excel (.xlsx)
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleRequestFinancialExport("gsheet")}
                          data-testid="menu-export-financial-gsheet"
                        >
                          <SiGooglesheets className="h-4 w-4 mr-2" />
                          Google Sheets
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </>
              ) : (
                <div className="w-full flex items-center justify-between gap-4">
                  <div className="text-sm text-muted-foreground">
                    <p>To unlock, go to the Reconciliation page and click <span className="font-medium">Apply & confirm</span> in the Amount Payable section.</p>
                  </div>
                  <Link href="/upload">
                    <Button variant="outline" data-testid="button-goto-reconciliation">
                      Go to Reconciliation
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Export History */}
        {exportHistory.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium" data-testid="text-export-history-title">Export History</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {exportHistory.map((entry, index) => (
                  <div
                    key={`${entry.timestamp}-${index}`}
                    className="flex items-center justify-between gap-3 text-sm"
                    data-testid={`export-history-entry-${index}`}
                  >
                    <div className="flex items-center gap-2">
                      {entry.format === "Excel" ? (
                        <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <SiGooglesheets className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span data-testid={`text-export-history-type-${index}`}>{entry.reportType}</span>
                      <Badge variant="secondary" data-testid={`badge-export-history-format-${index}`}>{entry.format}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground" data-testid={`text-export-history-time-${index}`}>
                      {formatTimeAgo(entry.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {lastExportTimestamp && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
            <Clock className="h-3.5 w-3.5" />
            <span data-testid="text-last-export">Last export: {new Date(lastExportTimestamp).toLocaleString()}</span>
          </div>
        )}
      </div>

      {currentRunId && (
        <ValidationModal
          open={showValidationModal}
          onClose={() => setShowValidationModal(false)}
          onProceed={handleValidationProceed}
          runId={currentRunId}
          exportFormat={pendingExportFormat}
        />
      )}
    </div>
  );
}
