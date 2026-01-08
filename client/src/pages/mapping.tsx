import { useState } from "react";
import { useLocation } from "wouter";
import { Check, AlertTriangle, Columns } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import type { ColumnMapping } from "@shared/schema";

interface MappingPageProps {
  mappings: ColumnMapping[];
  availableHeaders: string[];
  onSaveMappings: (mappings: ColumnMapping[]) => void;
  hasFiles: boolean;
}

export function MappingPage({
  mappings: initialMappings,
  availableHeaders,
  onSaveMappings,
  hasFiles,
}: MappingPageProps) {
  const [, setLocation] = useLocation();
  const [mappings, setMappings] = useState<ColumnMapping[]>(initialMappings);

  const handleOverrideChange = (fieldName: string, value: string) => {
    setMappings((prev) =>
      prev.map((m) =>
        m.fieldName === fieldName
          ? {
              ...m,
              overrideColumn: value === "none" ? null : value,
              isMatched: value !== "none" || m.detectedColumn !== null,
            }
          : m
      )
    );
  };

  const handleSave = () => {
    onSaveMappings(mappings);
    setLocation("/run");
  };

  const requiredMissing = mappings.filter((m) => m.isRequired && !m.isMatched);
  const allRequiredMapped = requiredMissing.length === 0;

  if (!hasFiles) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-8">
        <EmptyState
          icon={Columns}
          title="No files uploaded"
          description="Please upload files first to configure column mapping"
          action={{
            label: "Go to Upload",
            onClick: () => setLocation("/upload"),
          }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Column Detection & Mapping</h1>
        <p className="text-muted-foreground">
          Review auto-detected columns and override as needed
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Field Mappings</CardTitle>
              <CardDescription>
                {mappings.filter((m) => m.isMatched).length} of {mappings.length} fields mapped
              </CardDescription>
            </div>
            {!allRequiredMapped && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                {requiredMissing.length} required fields missing
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[200px]">Field Name</TableHead>
                  <TableHead className="w-[200px]">Detected Column</TableHead>
                  <TableHead>Override</TableHead>
                  <TableHead className="w-[100px] text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappings.map((mapping) => (
                  <TableRow key={mapping.fieldName} data-testid={`mapping-row-${mapping.fieldName}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{mapping.fieldName}</span>
                        {mapping.isRequired && (
                          <Badge variant="outline" className="text-xs">
                            Required
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {mapping.detectedColumn ? (
                        <Badge variant="secondary">{mapping.detectedColumn}</Badge>
                      ) : (
                        <span className="text-muted-foreground">Not detected</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={mapping.overrideColumn || "none"}
                        onValueChange={(value) => handleOverrideChange(mapping.fieldName, value)}
                      >
                        <SelectTrigger
                          className="w-full"
                          data-testid={`select-override-${mapping.fieldName}`}
                        >
                          <SelectValue placeholder="Select column..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Use detected / None</SelectItem>
                          {availableHeaders.map((header) => (
                            <SelectItem key={header} value={header}>
                              {header}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-center">
                      {mapping.isMatched ? (
                        <Check className="h-5 w-5 text-chart-2 mx-auto" />
                      ) : mapping.isRequired ? (
                        <AlertTriangle className="h-5 w-5 text-destructive mx-auto" />
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between mt-6">
        <Button variant="outline" onClick={() => setLocation("/upload")} data-testid="button-back">
          Back to Upload
        </Button>
        <Button
          onClick={handleSave}
          disabled={!allRequiredMapped}
          data-testid="button-save-mapping"
        >
          Save Mapping & Continue
        </Button>
      </div>
    </div>
  );
}
