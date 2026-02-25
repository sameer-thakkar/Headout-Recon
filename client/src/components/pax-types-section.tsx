import { useState, useRef } from "react";
import { Upload, Trash2, AlertCircle, Loader2, Download, Users, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PaxType } from "@shared/schema";
import * as XLSX from "xlsx";

export function PaxTypesSection() {
  const [collapsed, setCollapsed] = useState(true);
  const [parseError, setParseError] = useState("");
  const [manualInput, setManualInput] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: paxTypesData, isLoading } = useQuery<{ paxTypes: PaxType[] }>({
    queryKey: ["/api/pax-types"],
  });

  const paxTypes = paxTypesData?.paxTypes || [];

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/pax-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pax-types"] });
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/pax-types");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pax-types"] });
    },
  });

  const addSingleMutation = useMutation({
    mutationFn: async (name: string) => {
      await apiRequest("POST", "/api/pax-types", { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pax-types"] });
      setManualInput("");
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParseError("");
    setIsUploading(true);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

      if (jsonData.length === 0) {
        setParseError("The file is empty");
        return;
      }

      const headers = Object.keys(jsonData[0]);
      const guestTypeCol = headers.find(h => {
        const lower = h.toLowerCase().replace(/\s+/g, "");
        return lower === "guesttype" || lower === "paxtype" || lower === "name" || lower === "type";
      });

      if (!guestTypeCol) {
        setParseError("Could not find a column named 'Guest Type', 'Pax Type', 'Name', or 'Type'");
        return;
      }

      const names = jsonData
        .map(row => String(row[guestTypeCol] || "").trim().toLowerCase())
        .filter(n => n.length > 0);

      const uniqueNames = Array.from(new Set(names));

      if (uniqueNames.length === 0) {
        setParseError("No valid pax type names found");
        return;
      }

      await apiRequest("POST", "/api/pax-types/bulk", { names: uniqueNames });
      queryClient.invalidateQueries({ queryKey: ["/api/pax-types"] });
      toast({ title: "Saved", description: `${uniqueNames.length} pax type(s) saved to database` });
    } catch (err) {
      setParseError("Failed to parse or save file");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAddManual = () => {
    const name = manualInput.trim().toLowerCase();
    if (name.length === 0) return;
    addSingleMutation.mutate(name);
  };

  const handleDeleteAll = () => {
    if (confirm("Delete all pax types?")) {
      deleteAllMutation.mutate();
    }
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      { "Guest Type": "adult" },
      { "Guest Type": "child" },
      { "Guest Type": "infant" },
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pax Types");
    XLSX.writeFile(wb, "pax_types_template.xlsx");
  };

  return (
    <section className="py-4 px-8">
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardHeader
            className="cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => setCollapsed(!collapsed)}
            data-testid="header-pax-types"
          >
            <CardTitle className="flex items-center gap-2">
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <Users className="h-5 w-5" />
              Pax Type Management
              {paxTypes.length > 0 && (
                <Badge variant="secondary" className="text-xs">{paxTypes.length} types</Badge>
              )}
            </CardTitle>
          </CardHeader>
          {!collapsed && (
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                  data-testid="input-pax-types-file"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  data-testid="button-upload-pax-types"
                >
                  {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                  Upload & Save
                </Button>
                <Button variant="outline" size="sm" onClick={handleDownloadTemplate} data-testid="button-download-pax-template">
                  <Download className="h-4 w-4 mr-2" />
                  Template
                </Button>
                {paxTypes.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={handleDeleteAll}
                    disabled={deleteAllMutation.isPending}
                    data-testid="button-delete-all-pax-types"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Clear All
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Input
                  placeholder="Add pax type manually (e.g. adult)"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddManual(); }}
                  className="max-w-xs h-8 text-sm"
                  data-testid="input-manual-pax-type"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddManual}
                  disabled={addSingleMutation.isPending || manualInput.trim().length === 0}
                  data-testid="button-add-pax-type"
                >
                  Add
                </Button>
              </div>

              {parseError && (
                <div className="flex items-center gap-2 text-destructive text-sm" data-testid="text-pax-parse-error">
                  <AlertCircle className="h-4 w-4" />
                  {parseError}
                </div>
              )}

              {isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading...</span>
                </div>
              ) : paxTypes.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {paxTypes.map((pt) => (
                    <Badge key={pt.id} variant="secondary" className="gap-1" data-testid={`text-pax-type-${pt.id}`}>
                      {pt.name}
                      <button
                        className="ml-1 hover:text-destructive"
                        onClick={() => deleteMutation.mutate(pt.id)}
                        data-testid={`button-delete-pax-${pt.id}`}
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-2" data-testid="text-no-pax-types">
                  No pax types saved yet
                </p>
              )}
            </CardContent>
          )}
        </Card>
      </div>
    </section>
  );
}
