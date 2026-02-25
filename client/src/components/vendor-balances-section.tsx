import { useState, useRef } from "react";
import { Upload, Trash2, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, Download, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { VendorBalance } from "@shared/schema";
import * as XLSX from "xlsx";

interface ParsedBalance {
  beId: string;
  openingBalance: number;
  closingBalance: number;
  currency: string;
  isValid: boolean;
  error?: string;
}

export function VendorBalancesSection() {
  const [collapsed, setCollapsed] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: balancesData, isLoading: isLoadingBalances } = useQuery<{ balances: VendorBalance[] }>({
    queryKey: ["/api/vendor-balances"],
  });

  const balances = balancesData?.balances || [];

  const deleteMutation = useMutation({
    mutationFn: async (beId: string) => {
      await apiRequest("DELETE", `/api/vendor-balances/${encodeURIComponent(beId)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendor-balances"] });
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

      if (jsonData.length === 0) {
        toast({ title: "Error", description: "The file is empty or has no valid data rows", variant: "destructive" });
        return;
      }

      const originalHeaders = Object.keys(jsonData[0]);
      
      const findColumn = (patterns: string[], exactMatches: string[]): string | undefined => {
        for (const header of originalHeaders) {
          const normalized = header.toLowerCase().trim();
          for (const exact of exactMatches) {
            if (normalized === exact) return header;
          }
        }
        for (const header of originalHeaders) {
          const normalized = header.toLowerCase().trim();
          for (const pattern of patterns) {
            if (normalized.includes(pattern)) return header;
          }
        }
        return undefined;
      };

      const findBeIdColumn = (): string | undefined => {
        for (const header of originalHeaders) {
          const normalized = header.toLowerCase().trim();
          if (normalized.includes("be") && normalized.includes("id")) return header;
          if (normalized === "beid" || normalized === "be_id" || normalized === "billing entity id") return header;
        }
        return undefined;
      };

      const beIdCol = findBeIdColumn();
      const openingCol = findColumn(["opening"], ["opening balance", "opening_balance", "openingbalance"]);
      const closingCol = findColumn(["closing"], ["closing balance", "closing_balance", "closingbalance"]);
      const currencyCol = findColumn(["currency"], ["ccy", "curr"]);

      if (!beIdCol) {
        toast({ title: "Error", description: "Could not find BE ID column", variant: "destructive" });
        return;
      }

      const missingCols: string[] = [];
      if (!openingCol) missingCols.push("Opening Balance");
      if (!closingCol) missingCols.push("Closing Balance");
      
      if (missingCols.length > 0) {
        toast({ title: "Error", description: `Missing columns: ${missingCols.join(", ")}`, variant: "destructive" });
        return;
      }

      const parsed: ParsedBalance[] = jsonData.map((row) => {
        const beId = String(row[beIdCol] || "").trim();
        const openingRaw = row[openingCol!];
        const closingRaw = row[closingCol!];
        const openingBalance = openingRaw !== undefined && openingRaw !== "" ? parseFloat(String(openingRaw)) : NaN;
        const closingBalance = closingRaw !== undefined && closingRaw !== "" ? parseFloat(String(closingRaw)) : NaN;
        const currency = currencyCol ? String(row[currencyCol] || "INR").trim().toUpperCase() : "INR";
        const isValid = !!beId && !isNaN(openingBalance) && !isNaN(closingBalance);
        return { beId, openingBalance: isNaN(openingBalance) ? 0 : openingBalance, closingBalance: isNaN(closingBalance) ? 0 : closingBalance, currency, isValid };
      });

      const validBalances = parsed.filter(b => b.isValid);
      if (validBalances.length === 0) {
        toast({ title: "Error", description: "No valid entries found in the file", variant: "destructive" });
        return;
      }

      for (const balance of validBalances) {
        await apiRequest("POST", "/api/vendor-balances", {
          beId: balance.beId,
          openingBalance: balance.openingBalance,
          closingBalance: balance.closingBalance,
          currency: balance.currency,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/vendor-balances"] });
      toast({ title: "Saved", description: `${validBalances.length} vendor balance(s) saved to database` });
    } catch (err) {
      toast({ title: "Error", description: "Failed to parse or save file", variant: "destructive" });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteBalance = (beId: string) => {
    if (confirm(`Delete balance for ${beId}?`)) {
      deleteMutation.mutate(beId);
    }
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      { "BE ID": "VENDOR-001", "Opening Balance": 50000, "Closing Balance": 35000, "Currency": "INR" },
      { "BE ID": "VENDOR-002", "Opening Balance": 100000, "Closing Balance": 75000, "Currency": "INR" },
    ];
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendor Balances");
    XLSX.writeFile(workbook, "vendor_balances_template.xlsx");
  };

  return (
    <section className="py-4 px-8">
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardHeader
            className="cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => setCollapsed(!collapsed)}
            data-testid="header-vendor-balances"
          >
            <CardTitle className="flex items-center gap-2">
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <FileSpreadsheet className="h-5 w-5" />
              Vendor Balances
              {balances.length > 0 && (
                <Badge variant="secondary" className="text-xs">{balances.length} saved</Badge>
              )}
            </CardTitle>
          </CardHeader>
          {!collapsed && (
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4 flex-wrap">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="balance-file-upload"
                  data-testid="input-balance-file"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadTemplate}
                  data-testid="button-download-template"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Template
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  data-testid="button-upload-balances"
                >
                  {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Upload & Save
                </Button>
                <p className="text-xs text-muted-foreground">
                  File uploads directly to database
                </p>
              </div>

              {isLoadingBalances ? (
                <div className="flex items-center gap-2 text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading...</span>
                </div>
              ) : balances.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2" data-testid="text-no-balances">No balances saved yet</p>
              ) : (
                <div className="space-y-1">
                  {balances.map((balance) => (
                    <div
                      key={balance.beId}
                      className="flex items-center justify-between px-3 py-1.5 rounded-md border text-sm"
                      data-testid={`row-balance-${balance.beId}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-medium">{balance.beId}</span>
                        <Badge variant="outline" className="text-[10px]">{balance.currency}</Badge>
                        <span className="text-xs text-muted-foreground">
                          Open: {balance.openingBalance.toLocaleString("en-IN")} | Close: {balance.closingBalance.toLocaleString("en-IN")}
                        </span>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => handleDeleteBalance(balance.beId)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-balance-${balance.beId}`}
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      </div>
    </section>
  );
}
