import { useState } from "react";
import { Download, FileArchive, FileSpreadsheet, Clock, Check, ExternalLink } from "lucide-react";
import { SiGooglesheets } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [isExportingXlsx, setIsExportingXlsx] = useState(false);
  const [isExportingGSheet, setIsExportingGSheet] = useState(false);
  const [gSheetUrl, setGSheetUrl] = useState<string | null>(null);
  const { toast } = useToast();

  const handleExportZip = async () => {
    setIsExportingZip(true);
    try {
      await onExportZip();
      toast({ title: "Export complete", description: "ZIP file downloaded successfully" });
    } catch (error) {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setIsExportingZip(false);
    }
  };

  const handleExportXlsx = async () => {
    setIsExportingXlsx(true);
    try {
      await onExportXlsx();
      toast({ title: "Export complete", description: "XLSX file downloaded successfully" });
    } catch (error) {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setIsExportingXlsx(false);
    }
  };

  const handleExportGSheet = async () => {
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
          Download your reconciliation results in various formats
        </p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-chart-1/10 flex items-center justify-center">
                <FileArchive className="h-6 w-6 text-chart-1" />
              </div>
              <div>
                <CardTitle className="text-lg">Download ZIP</CardTitle>
                <CardDescription>CSV bundle with all reconciliation data</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                <p>Includes:</p>
                <ul className="list-disc list-inside mt-1">
                  <li>Summary.csv - Overall reconciliation summary</li>
                  <li>MTB.csv - Missing to bill details</li>
                  <li>NPD.csv - Non-price discrepancies</li>
                  <li>ChargeLoss.csv - Charge loss records</li>
                  <li>DRI_Views.csv - Booking-level data</li>
                </ul>
              </div>
              <Button
                onClick={handleExportZip}
                disabled={isExportingZip}
                className="ml-4"
                data-testid="button-export-zip"
              >
                {isExportingZip ? (
                  "Exporting..."
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Download ZIP
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-chart-2/10 flex items-center justify-center">
                <FileSpreadsheet className="h-6 w-6 text-chart-2" />
              </div>
              <div>
                <CardTitle className="text-lg">Download XLSX</CardTitle>
                <CardDescription>Excel workbook with multiple sheets</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                <p>Includes tabs:</p>
                <ul className="list-disc list-inside mt-1">
                  <li>Summary - Overall reconciliation summary</li>
                  <li>Draft Messages - All generated messages</li>
                  <li>FX_Rates - Currency exchange rates used</li>
                  <li>DRI Views - Booking-level data by team</li>
                </ul>
              </div>
              <Button
                onClick={handleExportXlsx}
                disabled={isExportingXlsx}
                className="ml-4"
                data-testid="button-export-xlsx"
              >
                {isExportingXlsx ? (
                  "Exporting..."
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Download XLSX
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-green-500/10 flex items-center justify-center">
                <SiGooglesheets className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <CardTitle className="text-lg">Export to Google Sheets</CardTitle>
                <CardDescription>Create a new Google Sheet with your data</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                <p>Creates a new spreadsheet with tabs:</p>
                <ul className="list-disc list-inside mt-1">
                  <li>Payable Summary - Currency totals</li>
                  <li>Discrepancy Analysis - By reason</li>
                  <li>SP Invoice Report - Supplier data</li>
                  <li>HO Report Updated - Full details</li>
                </ul>
              </div>
              <div className="flex flex-col items-end gap-2 ml-4">
                <Button
                  onClick={handleExportGSheet}
                  disabled={isExportingGSheet}
                  data-testid="button-export-gsheet"
                >
                  {isExportingGSheet ? (
                    "Creating..."
                  ) : (
                    <>
                      <SiGooglesheets className="h-4 w-4 mr-2" />
                      Export to Sheets
                    </>
                  )}
                </Button>
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
