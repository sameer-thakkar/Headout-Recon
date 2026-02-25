import { useState, useRef } from "react";
import { Upload, Trash2, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, X, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { PortalReload } from "@shared/schema";

interface ParsedReload {
  beId: string;
  paidAmount: number;
  zendeskId?: string;
  dateOfPayment?: string;
  amountLoadedAtDate?: number;
  rawRow: Record<string, unknown>;
}

export function PortalReloadsSection() {
  const [parsedReloads, setParsedReloads] = useState<ParsedReload[]>([]);
  const [allHeaders, setAllHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [parseError, setParseError] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: reloadsData, isLoading: isLoadingReloads } = useQuery<{ reloads: PortalReload[] }>({
    queryKey: ["/api/portal-reloads"],
  });

  const reloads = reloadsData?.reloads || [];

  const saveMutation = useMutation({
    mutationFn: async (reloadsToSave: ParsedReload[]) => {
      await apiRequest("POST", "/api/portal-reloads/save", {
        reloads: reloadsToSave.map(r => ({
          beId: r.beId,
          paidAmount: r.paidAmount,
          zendeskId: r.zendeskId,
          dateOfPayment: r.dateOfPayment,
          amountLoadedAtDate: r.amountLoadedAtDate,
        })),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal-reloads"] });
      setParsedReloads([]);
      setAllHeaders([]);
      setFileName("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/portal-reloads");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal-reloads"] });
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParseError("");
    setFileName(file.name);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/portal-reloads/upload", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        setParseError(result.error || "Failed to parse file");
        setParsedReloads([]);
        setAllHeaders([]);
        return;
      }

      setParsedReloads(result.parsed);
      setAllHeaders(result.headers || []);
    } catch (err) {
      setParseError("Failed to upload file. Please ensure it's a valid Excel or CSV file.");
      setParsedReloads([]);
      setAllHeaders([]);
    } finally {
      setIsUploading(false);
    }
  };

  const handleClearPreview = () => {
    setParsedReloads([]);
    setAllHeaders([]);
    setFileName("");
    setParseError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSaveAll = () => {
    if (parsedReloads.length === 0) return;
    saveMutation.mutate(parsedReloads);
  };

  const handleDeleteAll = () => {
    if (confirm("Are you sure you want to delete all portal reload data?")) {
      deleteMutation.mutate();
    }
  };

  const formatNumber = (value: number): string => {
    return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatCellValue = (value: unknown): string => {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "number") return formatNumber(value);
    return String(value);
  };

  const aggregatedByBeId = reloads.reduce<Record<string, { total: number; count: number }>>((acc, r) => {
    if (!acc[r.beId]) acc[r.beId] = { total: 0, count: 0 };
    acc[r.beId].total += r.paidAmount;
    acc[r.beId].count += 1;
    return acc;
  }, {});

  return (
    <section className="py-8 px-8">
      <div className="max-w-7xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Portal Reloads
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Upload a file with <strong>"Finance Zendesk Tickets Portal Partner ID"</strong> and <strong>"Finance Zendesk Tickets Paid Amount"</strong> columns. 
              The total paid amount per BE ID will be used as the Reloads value in Purchase Reconciliation.
            </p>

            <div className="space-y-4">
              <div className="flex items-center gap-4 flex-wrap">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="reload-file-upload"
                  data-testid="input-reload-file"
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  data-testid="button-upload-reloads"
                >
                  {isUploading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  Upload Reloads File
                </Button>
                {fileName && (
                  <div className="flex items-center gap-2 text-sm">
                    <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{fileName}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={handleClearPreview}
                      data-testid="button-clear-reload-preview"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>

              {parseError && (
                <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md" data-testid="text-reload-parse-error">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}

              {parsedReloads.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" data-testid="badge-reload-count">
                        {parsedReloads.length} entries
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Showing all {allHeaders.length} columns from uploaded file
                      </span>
                    </div>
                    <Button
                      size="sm"
                      onClick={handleSaveAll}
                      disabled={saveMutation.isPending}
                      data-testid="button-save-reloads"
                    >
                      {saveMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Save All
                    </Button>
                  </div>

                  <div className="border rounded-md overflow-hidden max-h-96 overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky left-0 z-10 bg-muted/80 backdrop-blur-sm text-xs whitespace-nowrap">#</TableHead>
                          {allHeaders.map((header) => (
                            <TableHead key={header} className="text-xs whitespace-nowrap">
                              {header}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parsedReloads.map((entry, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="sticky left-0 z-10 bg-background text-xs text-muted-foreground font-mono">
                              {idx + 1}
                            </TableCell>
                            {allHeaders.map((header) => (
                              <TableCell
                                key={header}
                                className="text-xs whitespace-nowrap font-mono"
                                data-testid={`cell-reload-${idx}-${header.replace(/\s+/g, "-").toLowerCase()}`}
                              >
                                {formatCellValue(entry.rawRow[header])}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t pt-6">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold">Saved Reloads</h4>
                {reloads.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDeleteAll}
                    disabled={deleteMutation.isPending}
                    className="text-destructive hover:text-destructive"
                    data-testid="button-delete-all-reloads"
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    Clear All
                  </Button>
                )}
              </div>

              {isLoadingReloads ? (
                <div className="text-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </div>
              ) : Object.keys(aggregatedByBeId).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-reloads">
                  No reload data uploaded yet
                </p>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>BE ID</TableHead>
                        <TableHead className="text-right">Entries</TableHead>
                        <TableHead className="text-right">Total Reload Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(aggregatedByBeId).map(([beId, data]) => (
                        <TableRow key={beId}>
                          <TableCell className="font-mono text-sm" data-testid={`text-saved-reload-beid-${beId}`}>{beId}</TableCell>
                          <TableCell className="text-right text-sm">{data.count}</TableCell>
                          <TableCell className="text-right font-mono text-sm font-medium" data-testid={`text-saved-reload-amount-${beId}`}>
                            {formatNumber(data.total)}
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
