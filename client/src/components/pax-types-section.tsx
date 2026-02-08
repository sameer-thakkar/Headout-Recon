import { useState, useRef } from "react";
import { Upload, Trash2, FileSpreadsheet, AlertCircle, Loader2, X, Download, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { PaxType } from "@shared/schema";
import * as XLSX from "xlsx";

export function PaxTypesSection() {
  const [parsedNames, setParsedNames] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [parseError, setParseError] = useState<string>("");
  const [manualInput, setManualInput] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: paxTypesData, isLoading } = useQuery<{ paxTypes: PaxType[] }>({
    queryKey: ["/api/pax-types"],
  });

  const paxTypes = paxTypesData?.paxTypes || [];

  const bulkSaveMutation = useMutation({
    mutationFn: async (names: string[]) => {
      await apiRequest("POST", "/api/pax-types/bulk", { names });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pax-types"] });
      setParsedNames([]);
      setFileName("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
  });

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
    setFileName(file.name);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

      if (jsonData.length === 0) {
        setParseError("The file is empty or has no valid data rows");
        setParsedNames([]);
        return;
      }

      const headers = Object.keys(jsonData[0]);
      const guestTypeCol = headers.find(h => {
        const lower = h.toLowerCase().replace(/\s+/g, "");
        return lower === "guesttype" || lower === "paxtype" || lower === "name" || lower === "type";
      });

      if (!guestTypeCol) {
        setParseError("Could not find a column named 'Guest Type', 'Pax Type', 'Name', or 'Type'");
        setParsedNames([]);
        return;
      }

      const names = jsonData
        .map(row => String(row[guestTypeCol] || "").trim().toLowerCase())
        .filter(n => n.length > 0);

      const uniqueNames = Array.from(new Set(names));

      if (uniqueNames.length === 0) {
        setParseError("No valid pax type names found in the file");
        setParsedNames([]);
        return;
      }

      setParsedNames(uniqueNames);
    } catch (err) {
      console.error("File parse error:", err);
      setParseError("Failed to parse the file. Please ensure it is a valid Excel or CSV file.");
      setParsedNames([]);
    }
  };

  const handleSaveAll = () => {
    if (parsedNames.length === 0) return;
    bulkSaveMutation.mutate(parsedNames);
  };

  const handleAddManual = () => {
    const name = manualInput.trim().toLowerCase();
    if (name.length === 0) return;
    addSingleMutation.mutate(name);
  };

  const handleDeletePaxType = (id: number) => {
    deleteMutation.mutate(id);
  };

  const handleDeleteAll = () => {
    if (confirm("Are you sure you want to delete all pax types? This cannot be undone.")) {
      deleteAllMutation.mutate();
    }
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      { "Guest Type": "adult" },
      { "Guest Type": "child" },
      { "Guest Type": "infant" },
      { "Guest Type": "senior" },
      { "Guest Type": "family" },
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pax Types");
    XLSX.writeFile(wb, "pax_types_template.xlsx");
  };

  return (
    <section className="py-8 px-8">
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 flex-wrap">
              <Users className="h-5 w-5" />
              Pax Type Management
              {paxTypes.length > 0 && (
                <Badge variant="secondary">{paxTypes.length} types</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Upload a list of pax types (guest types) used in your HO data. During reconciliation, the system will detect pax type columns (e.g. adult_count, adult_unit_price, adult_price_net) and enable bulk price updates by pax type.
            </p>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  data-testid="input-pax-types-file"
                />
                <Button variant="outline" data-testid="button-upload-pax-types">
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Pax Types File
                </Button>
              </div>
              <Button variant="outline" onClick={handleDownloadTemplate} data-testid="button-download-pax-template">
                <Download className="h-4 w-4 mr-2" />
                Template
              </Button>
              {fileName && (
                <div className="flex items-center gap-1">
                  <FileSpreadsheet className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-muted-foreground">{fileName}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setParsedNames([]);
                      setFileName("");
                      setParseError("");
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    data-testid="button-clear-pax-file"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>

            {parseError && (
              <div className="flex items-center gap-2 text-destructive text-sm" data-testid="text-pax-parse-error">
                <AlertCircle className="h-4 w-4" />
                {parseError}
              </div>
            )}

            {parsedNames.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-sm font-medium">
                    {parsedNames.length} pax types parsed from file
                  </span>
                  <Button
                    onClick={handleSaveAll}
                    disabled={bulkSaveMutation.isPending}
                    data-testid="button-save-pax-types"
                  >
                    {bulkSaveMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : null}
                    Save All to Database
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-2 border rounded-md bg-muted/20">
                  {parsedNames.map((name, idx) => (
                    <Badge key={idx} variant="secondary" data-testid={`badge-parsed-pax-${idx}`}>
                      {name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <Input
                placeholder="Add pax type manually (e.g. adult)"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddManual(); }}
                className="max-w-xs"
                data-testid="input-manual-pax-type"
              />
              <Button
                variant="outline"
                onClick={handleAddManual}
                disabled={addSingleMutation.isPending || manualInput.trim().length === 0}
                data-testid="button-add-pax-type"
              >
                Add
              </Button>
            </div>

            {isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading pax types...
              </div>
            ) : paxTypes.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-sm font-medium">Saved Pax Types ({paxTypes.length})</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={handleDeleteAll}
                    disabled={deleteAllMutation.isPending}
                    data-testid="button-delete-all-pax-types"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Delete All
                  </Button>
                </div>
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>Pax Type Name</TableHead>
                        <TableHead className="w-20 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paxTypes.map((pt, idx) => (
                        <TableRow key={pt.id}>
                          <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                          <TableCell className="font-mono text-sm" data-testid={`text-pax-type-${pt.id}`}>{pt.name}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => handleDeletePaxType(pt.id)}
                              disabled={deleteMutation.isPending}
                              data-testid={`button-delete-pax-${pt.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-pax-types">
                No pax types saved yet. Upload a file or add them manually.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
