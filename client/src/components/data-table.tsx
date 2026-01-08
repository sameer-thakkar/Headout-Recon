import { useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface Column<T> {
  key: keyof T | string;
  header: string;
  sortable?: boolean;
  align?: "left" | "center" | "right";
  render?: (value: T[keyof T], row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  defaultSortKey?: keyof T | string;
  defaultSortDir?: "asc" | "desc";
  emptyMessage?: string;
  testIdPrefix?: string;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  defaultSortKey,
  defaultSortDir = "asc",
  emptyMessage = "No data available",
  testIdPrefix = "table",
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<keyof T | string | null>(defaultSortKey || null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);

  const handleSort = (key: keyof T | string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortedData = [...data].sort((a, b) => {
    if (!sortKey) return 0;
    const aVal = a[sortKey as keyof T];
    const bVal = b[sortKey as keyof T];
    
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    }
    
    const aStr = String(aVal ?? "");
    const bStr = String(bVal ?? "");
    return sortDir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
  });

  const getAlignClass = (align?: "left" | "center" | "right") => {
    switch (align) {
      case "center": return "text-center";
      case "right": return "text-right";
      default: return "text-left";
    }
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            {columns.map((col) => (
              <TableHead
                key={String(col.key)}
                className={`${getAlignClass(col.align)} ${col.className || ""}`}
              >
                {col.sortable ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 -ml-3 font-medium"
                    onClick={() => handleSort(col.key)}
                    data-testid={`${testIdPrefix}-sort-${String(col.key)}`}
                  >
                    {col.header}
                    {sortKey === col.key ? (
                      sortDir === "asc" ? (
                        <ArrowUp className="ml-2 h-4 w-4" />
                      ) : (
                        <ArrowDown className="ml-2 h-4 w-4" />
                      )
                    ) : (
                      <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />
                    )}
                  </Button>
                ) : (
                  col.header
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedData.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="text-center py-8 text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            sortedData.map((row, idx) => (
              <TableRow
                key={idx}
                className="hover-elevate"
                data-testid={`${testIdPrefix}-row-${idx}`}
              >
                {columns.map((col) => {
                  const value = row[col.key as keyof T];
                  return (
                    <TableCell
                      key={String(col.key)}
                      className={`${getAlignClass(col.align)} ${col.className || ""}`}
                    >
                      {col.render ? col.render(value, row) : String(value ?? "")}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
