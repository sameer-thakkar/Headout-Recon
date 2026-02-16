import { useState } from "react";
import { Download, FileSpreadsheet, Clock, ExternalLink, ChevronDown, BarChart3, DollarSign } from "lucide-react";
import { SiGooglesheets } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";

interface ExportPageProps {
  hasResults: boolean;
  onExportZip: () => Promise<void>;
  onExportAnalysisXlsx: () => Promise<void>;
  onExportFinancialXlsx: () => Promise<void>;
  onExportAnalysisGSheet: () => Promise<{ spreadsheetUrl?: string }>;
  onExportFinancialGSheet: () => Promise<{ spreadsheetUrl?: string }>;
  lastExportTimestamp: string | null;
}

export function ExportPage({
  hasResults,
  onExportZip,
  onExportAnalysisXlsx,
  onExportFinancialXlsx,
  onExportAnalysisGSheet,
  onExportFinancialGSheet,
  lastExportTimestamp,
}: ExportPageProps) {
  const [isExportingAnalysis, setIsExportingAnalysis] = useState(false);
  const [isExportingFinancial, setIsExportingFinancial] = useState(false);
  const [analysisGSheetUrl, setAnalysisGSheetUrl] = useState<string | null>(null);
  const [financialGSheetUrl, setFinancialGSheetUrl] = useState<string | null>(null);
  const { toast } = useToast();

  const handleExportAnalysisXlsx = async () => {
    setIsExportingAnalysis(true);
    try {
      await onExportAnalysisXlsx();
      toast({ title: "Export complete", description: "Reconciliation Analysis downloaded" });
    } catch (error) {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setIsExportingAnalysis(false);
    }
  };

  const handleExportAnalysisGSheet = async () => {
    setIsExportingAnalysis(true);
    setAnalysisGSheetUrl(null);
    try {
      const result = await onExportAnalysisGSheet();
      if (result.spreadsheetUrl) {
        setAnalysisGSheetUrl(result.spreadsheetUrl);
        toast({ title: "Export complete", description: "Analysis Google Sheet created" });
      }
    } catch (error) {
      toast({ title: "Export failed", description: "Could not create Google Sheet", variant: "destructive" });
    } finally {
      setIsExportingAnalysis(false);
    }
  };

  const handleExportFinancialXlsx = async () => {
    setIsExportingFinancial(true);
    try {
      await onExportFinancialXlsx();
      toast({ title: "Export complete", description: "Financial Report downloaded" });
    } catch (error) {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setIsExportingFinancial(false);
    }
  };

  const handleExportFinancialGSheet = async () => {
    setIsExportingFinancial(true);
    setFinancialGSheetUrl(null);
    try {
      const result = await onExportFinancialGSheet();
      if (result.spreadsheetUrl) {
        setFinancialGSheetUrl(result.spreadsheetUrl);
        toast({ title: "Export complete", description: "Financial Google Sheet created" });
      }
    } catch (error) {
      toast({ title: "Export failed", description: "Could not create Google Sheet", variant: "destructive" });
    } finally {
      setIsExportingFinancial(false);
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

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-export-title">Export</h1>
        <p className="text-muted-foreground">
          Download your reconciliation results as two separate reports
        </p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-chart-2/10 flex items-center justify-center">
                <BarChart3 className="h-6 w-6 text-chart-2" />
              </div>
              <div>
                <CardTitle className="text-lg" data-testid="text-analysis-card-title">Reconciliation Analysis</CardTitle>
                <CardDescription>Discrepancy analysis, draft messages, and DRI views</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm text-muted-foreground">
                <p>Includes:</p>
                <ul className="list-disc list-inside mt-1">
                  <li>Discrepancy Analysis - By reason with TID breakdown</li>
                  <li>Draft Messages - Communication templates</li>
                  <li>DRI Views - Team-specific sheets</li>
                </ul>
              </div>
              <div className="flex flex-col items-end gap-3 ml-4">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button disabled={isExportingAnalysis} data-testid="button-export-analysis-dropdown">
                      {isExportingAnalysis ? (
                        "Exporting..."
                      ) : (
                        <>
                          <Download className="h-4 w-4 mr-2" />
                          Export Analysis
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

                {analysisGSheetUrl && (
                  <a
                    href={analysisGSheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm text-green-600 hover:underline"
                    data-testid="link-analysis-gsheet"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open Analysis Sheet
                  </a>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-chart-4/10 flex items-center justify-center">
                <DollarSign className="h-6 w-6 text-chart-4" />
              </div>
              <div>
                <CardTitle className="text-lg" data-testid="text-financial-card-title">Financial Report</CardTitle>
                <CardDescription>Amount payable, supplier invoice, and HO report</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm text-muted-foreground">
                <p>Includes:</p>
                <ul className="list-disc list-inside mt-1">
                  <li>Payable Summary - Currency totals</li>
                  <li>SP Invoice Report - Supplier data with FX</li>
                  <li>HO Report Updated - Full booking details</li>
                </ul>
              </div>
              <div className="flex flex-col items-end gap-3 ml-4">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button disabled={isExportingFinancial} data-testid="button-export-financial-dropdown">
                      {isExportingFinancial ? (
                        "Exporting..."
                      ) : (
                        <>
                          <Download className="h-4 w-4 mr-2" />
                          Export Financial
                          <ChevronDown className="h-4 w-4 ml-2" />
                        </>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={handleExportFinancialXlsx}
                      data-testid="menu-export-financial-excel"
                    >
                      <FileSpreadsheet className="h-4 w-4 mr-2" />
                      Excel (.xlsx)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleExportFinancialGSheet}
                      data-testid="menu-export-financial-gsheet"
                    >
                      <SiGooglesheets className="h-4 w-4 mr-2" />
                      Google Sheets
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {financialGSheetUrl && (
                  <a
                    href={financialGSheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm text-green-600 hover:underline"
                    data-testid="link-financial-gsheet"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open Financial Sheet
                  </a>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {lastExportTimestamp && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 text-muted-foreground">
                <Clock className="h-5 w-5" />
                <span data-testid="text-last-export">Last export: {new Date(lastExportTimestamp).toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
