import { useState } from "react";
import { Download, FileSpreadsheet, Clock, ExternalLink, ChevronDown } from "lucide-react";
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
  onExportXlsx: () => Promise<void>;
  onExportGSheet: () => Promise<{ spreadsheetUrl?: string }>;
  lastExportTimestamp: string | null;
}

export function ExportPage({
  hasResults,
  onExportZip,
  onExportXlsx,
  onExportGSheet,
  lastExportTimestamp,
}: ExportPageProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [gSheetUrl, setGSheetUrl] = useState<string | null>(null);
  const { toast } = useToast();

  const handleExportXlsx = async () => {
    setIsExporting(true);
    try {
      await onExportXlsx();
      toast({ title: "Export complete", description: "Excel file downloaded successfully" });
    } catch (error) {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportGSheet = async () => {
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
        <h1 className="text-3xl font-bold mb-2">Export</h1>
        <p className="text-muted-foreground">
          Download your reconciliation results
        </p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-chart-2/10 flex items-center justify-center">
                <FileSpreadsheet className="h-6 w-6 text-chart-2" />
              </div>
              <div>
                <CardTitle className="text-lg">Export Reconciliation Data</CardTitle>
                <CardDescription>Choose your preferred export format</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                <p>Export includes:</p>
                <ul className="list-disc list-inside mt-1">
                  <li>Payable Summary - Currency totals</li>
                  <li>Discrepancy Analysis - By reason</li>
                  <li>SP Invoice Report - Supplier data</li>
                  <li>HO Report Updated - Full details</li>
                  <li>Draft Messages - Communication templates</li>
                  <li>DRI Views - Team-specific data</li>
                </ul>
              </div>
              <div className="flex flex-col items-end gap-3 ml-4">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button disabled={isExporting} data-testid="button-export-dropdown">
                      {isExporting ? (
                        "Exporting..."
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
                      onClick={handleExportXlsx}
                      data-testid="menu-export-excel"
                    >
                      <FileSpreadsheet className="h-4 w-4 mr-2" />
                      Excel (.xlsx)
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={handleExportGSheet}
                      data-testid="menu-export-gsheet"
                    >
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
                    Open Google Sheet
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
                <span>Last export: {new Date(lastExportTimestamp).toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
