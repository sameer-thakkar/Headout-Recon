import { useState, useRef } from "react";
import { Upload, Trash2, AlertCircle, Loader2, RefreshCw, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PortalReload } from "@shared/schema";

export function PortalReloadsSection() {
  const [collapsed, setCollapsed] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [parseError, setParseError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: reloadsData, isLoading: isLoadingReloads } = useQuery<{ reloads: PortalReload[] }>({
    queryKey: ["/api/portal-reloads"],
  });

  const reloads = reloadsData?.reloads || [];

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
        return;
      }

      const parsed = result.parsed || [];
      if (parsed.length === 0) {
        setParseError("No valid entries found");
        return;
      }

      await apiRequest("POST", "/api/portal-reloads/save", {
        reloads: parsed.map((r: any) => ({
          beId: r.beId,
          paidAmount: r.paidAmount,
          zendeskId: r.zendeskId,
          dateOfPayment: r.dateOfPayment,
          amountLoadedAtDate: r.amountLoadedAtDate,
        })),
      });

      queryClient.invalidateQueries({ queryKey: ["/api/portal-reloads"] });
      toast({ title: "Saved", description: `${parsed.length} reload entries saved to database` });
    } catch (err) {
      setParseError("Failed to upload or save file");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteAll = () => {
    if (confirm("Delete all portal reload data?")) {
      deleteMutation.mutate();
    }
  };

  const aggregatedByBeId = reloads.reduce<Record<string, { total: number; count: number }>>((acc, r) => {
    if (!acc[r.beId]) acc[r.beId] = { total: 0, count: 0 };
    acc[r.beId].total += r.paidAmount;
    acc[r.beId].count += 1;
    return acc;
  }, {});

  return (
    <section className="py-4 px-8">
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardHeader
            className="cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => setCollapsed(!collapsed)}
            data-testid="header-portal-reloads"
          >
            <CardTitle className="flex items-center gap-2">
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <RefreshCw className="h-5 w-5" />
              Portal Reloads
              {reloads.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {Object.keys(aggregatedByBeId).length} BE{Object.keys(aggregatedByBeId).length !== 1 ? "s" : ""} | {reloads.length} entries
                </Badge>
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
                  id="reload-file-upload"
                  data-testid="input-reload-file"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  data-testid="button-upload-reloads"
                >
                  {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Upload & Save
                </Button>
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
                <p className="text-xs text-muted-foreground">
                  File uploads directly to database
                </p>
              </div>

              {parseError && (
                <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md" data-testid="text-reload-parse-error">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}

              {isLoadingReloads ? (
                <div className="flex items-center gap-2 text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading...</span>
                </div>
              ) : Object.keys(aggregatedByBeId).length === 0 ? (
                <p className="text-sm text-muted-foreground py-2" data-testid="text-no-reloads">No reload data uploaded yet</p>
              ) : (
                <div className="space-y-1">
                  {Object.entries(aggregatedByBeId).map(([beId, data]) => (
                    <div
                      key={beId}
                      className="flex items-center justify-between px-3 py-1.5 rounded-md border text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-medium" data-testid={`text-saved-reload-beid-${beId}`}>{beId}</span>
                        <Badge variant="outline" className="text-[10px]">{data.count} entries</Badge>
                        <span className="font-mono text-xs" data-testid={`text-saved-reload-amount-${beId}`}>
                          {data.total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
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
