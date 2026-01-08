import { useState } from "react";
import { Download, FileArchive, FileSpreadsheet, Clock, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";

interface ExportPageProps {
  hasResults: boolean;
  onExportZip: () => Promise<void>;
  onExportXlsx: () => Promise<void>;
  lastExportTimestamp: string | null;
}

export function ExportPage({
  hasResults,
  onExportZip,
  onExportXlsx,
  lastExportTimestamp,
}: ExportPageProps) {
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [isExportingXlsx, setIsExportingXlsx] = useState(false);
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
