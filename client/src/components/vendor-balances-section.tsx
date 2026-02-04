import { useState, useRef } from "react";
import { Upload, Trash2, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { VendorBalance } from "@shared/schema";
import * as XLSX from "xlsx";

interface ParsedBalance {
  beId: string;
  openingBalance: number;
  reloads: number;
  closingBalance: number;
  currency: string;
  isValid: boolean;
  error?: string;
}

export function VendorBalancesSection() {
  const [parsedBalances, setParsedBalances] = useState<ParsedBalance[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [parseError, setParseError] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: balancesData, isLoading: isLoadingBalances } = useQuery<{ balances: VendorBalance[] }>({
    queryKey: ["/api/vendor-balances"],
  });

  const balances = balancesData?.balances || [];

  const saveMutation = useMutation({
    mutationFn: async (balancesToSave: ParsedBalance[]) => {
      const validBalances = balancesToSave.filter(b => b.isValid);
      for (const balance of validBalances) {
        await apiRequest("POST", "/api/vendor-balances", {
          beId: balance.beId,
          openingBalance: balance.openingBalance,
          reloads: balance.reloads,
          closingBalance: balance.closingBalance,
          currency: balance.currency,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendor-balances"] });
      setParsedBalances([]);
      setFileName("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
  });

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

    setParseError("");
    setFileName(file.name);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

      if (jsonData.length === 0) {
        setParseError("The file is empty or has no valid data rows");
        setParsedBalances([]);
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
      const reloadsCol = findColumn(["reload"], ["reloads"]);
      const closingCol = findColumn(["closing"], ["closing balance", "closing_balance", "closingbalance"]);
      const currencyCol = findColumn(["currency"], ["ccy", "curr"]);

      if (!beIdCol) {
        setParseError("Could not find BE ID column. Expected column names: 'BE ID', 'beId', 'Billing Entity ID'");
        setParsedBalances([]);
        return;
      }

      const missingCols: string[] = [];
      if (!openingCol) missingCols.push("Opening Balance");
      if (!reloadsCol) missingCols.push("Reloads");
      if (!closingCol) missingCols.push("Closing Balance");
      
      if (missingCols.length > 0) {
        setParseError(`Missing required columns: ${missingCols.join(", ")}. Please ensure your file has columns for Opening Balance, Reloads, and Closing Balance.`);
        setParsedBalances([]);
        return;
      }

      const parsed: ParsedBalance[] = jsonData.map((row) => {
        const beId = String(row[beIdCol] || "").trim();
        const openingRaw = row[openingCol!];
        const reloadsRaw = row[reloadsCol!];
        const closingRaw = row[closingCol!];
        
        const openingBalance = openingRaw !== undefined && openingRaw !== "" ? parseFloat(String(openingRaw)) : NaN;
        const reloads = reloadsRaw !== undefined && reloadsRaw !== "" ? parseFloat(String(reloadsRaw)) : NaN;
        const closingBalance = closingRaw !== undefined && closingRaw !== "" ? parseFloat(String(closingRaw)) : NaN;
        const currency = currencyCol ? String(row[currencyCol] || "INR").trim().toUpperCase() : "INR";

        let isValid = true;
        let error = "";

        if (!beId) {
          isValid = false;
          error = "Missing BE ID";
        } else if (isNaN(openingBalance)) {
          isValid = false;
          error = "Invalid/missing Opening Balance";
        } else if (isNaN(reloads)) {
          isValid = false;
          error = "Invalid/missing Reloads";
        } else if (isNaN(closingBalance)) {
          isValid = false;
          error = "Invalid/missing Closing Balance";
        }

        return { 
          beId, 
          openingBalance: isNaN(openingBalance) ? 0 : openingBalance, 
          reloads: isNaN(reloads) ? 0 : reloads, 
          closingBalance: isNaN(closingBalance) ? 0 : closingBalance, 
          currency, 
          isValid, 
          error 
        };
      });

      setParsedBalances(parsed);
    } catch (err) {
      setParseError("Failed to parse file. Please ensure it's a valid Excel or CSV file.");
      setParsedBalances([]);
    }
  };

  const handleClearPreview = () => {
    setParsedBalances([]);
    setFileName("");
    setParseError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSaveAll = () => {
    const validCount = parsedBalances.filter(b => b.isValid).length;
    if (validCount === 0) return;
    saveMutation.mutate(parsedBalances);
  };

  const handleDeleteBalance = (beId: string) => {
    if (confirm(`Are you sure you want to delete the balance for ${beId}?`)) {
      deleteMutation.mutate(beId);
    }
  };

  const formatNumber = (value: number): string => {
    return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      { "BE ID": "VENDOR-001", "Opening Balance": 50000, "Reloads": 25000, "Closing Balance": 35000, "Currency": "INR" },
      { "BE ID": "VENDOR-002", "Opening Balance": 100000, "Reloads": 0, "Closing Balance": 75000, "Currency": "INR" },
    ];
    
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendor Balances");
    
    XLSX.writeFile(workbook, "vendor_balances_template.xlsx");
  };

  const validCount = parsedBalances.filter(b => b.isValid).length;
  const invalidCount = parsedBalances.filter(b => !b.isValid).length;

  return (
    <section className="py-16 px-8">
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Vendor Balances
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
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
                  onClick={handleDownloadTemplate}
                  data-testid="button-download-template"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Template
                </Button>
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-upload-balances"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Balance File
                </Button>
                {fileName && (
                  <span className="text-sm text-muted-foreground">{fileName}</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Download the template, fill in your vendor balances, then upload the file
              </p>
            </div>

            {parseError && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">{parseError}</span>
              </div>
            )}

            {parsedBalances.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h4 className="font-medium">Preview</h4>
                    {validCount > 0 && (
                      <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        {validCount} valid
                      </Badge>
                    )}
                    {invalidCount > 0 && (
                      <Badge variant="destructive">
                        <AlertCircle className="mr-1 h-3 w-3" />
                        {invalidCount} invalid
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearPreview}
                      data-testid="button-clear-preview"
                    >
                      <X className="mr-1 h-4 w-4" />
                      Clear
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveAll}
                      disabled={validCount === 0 || saveMutation.isPending}
                      data-testid="button-save-balances"
                    >
                      {saveMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Save {validCount} Balance{validCount !== 1 ? "s" : ""}
                    </Button>
                  </div>
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>BE ID</TableHead>
                        <TableHead className="text-right">Opening Balance</TableHead>
                        <TableHead className="text-right">Reloads</TableHead>
                        <TableHead className="text-right">Closing Balance</TableHead>
                        <TableHead>Currency</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedBalances.map((balance, idx) => (
                        <TableRow 
                          key={idx} 
                          className={!balance.isValid ? "bg-destructive/5" : ""}
                          data-testid={`row-preview-${idx}`}
                        >
                          <TableCell className="font-mono">{balance.beId || "-"}</TableCell>
                          <TableCell className="text-right font-mono">{formatNumber(balance.openingBalance)}</TableCell>
                          <TableCell className="text-right font-mono">{formatNumber(balance.reloads)}</TableCell>
                          <TableCell className="text-right font-mono">{formatNumber(balance.closingBalance)}</TableCell>
                          <TableCell>{balance.currency}</TableCell>
                          <TableCell>
                            {balance.isValid ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            ) : (
                              <span className="text-xs text-destructive">{balance.error}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <div className="border-t pt-6">
              <h4 className="font-medium mb-4">Saved Balances</h4>
              {isLoadingBalances ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-muted-foreground">Loading...</span>
                </div>
              ) : balances.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                    <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-muted-foreground text-sm">No balances saved yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Upload a file above to add vendor balances
                  </p>
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>BE ID</TableHead>
                        <TableHead className="text-right">Opening Balance</TableHead>
                        <TableHead className="text-right">Reloads</TableHead>
                        <TableHead className="text-right">Closing Balance</TableHead>
                        <TableHead>Currency</TableHead>
                        <TableHead className="text-right">Updated</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {balances.map((balance) => (
                        <TableRow key={balance.beId} data-testid={`row-balance-${balance.beId}`}>
                          <TableCell className="font-mono">{balance.beId}</TableCell>
                          <TableCell className="text-right font-mono">{formatNumber(balance.openingBalance)}</TableCell>
                          <TableCell className="text-right font-mono">{formatNumber(balance.reloads)}</TableCell>
                          <TableCell className="text-right font-mono">{formatNumber(balance.closingBalance)}</TableCell>
                          <TableCell>{balance.currency}</TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {new Date(balance.updatedAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleDeleteBalance(balance.beId)}
                              disabled={deleteMutation.isPending}
                              data-testid={`button-delete-balance-${balance.beId}`}
                            >
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
