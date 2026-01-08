import { useState } from "react";
import { Users, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import type { ReconResult, DriFilter } from "@shared/schema";
import { driTeams, reasonCodes } from "@shared/schema";

interface DriPageProps {
  results: ReconResult[];
  hasResults: boolean;
  onExportFiltered: (results: ReconResult[]) => void;
}

const driColumns: Column<ReconResult>[] = [
  { key: "bid", header: "BID", sortable: true, className: "font-mono" },
  { key: "tid", header: "TID", sortable: true, className: "font-mono" },
  { key: "currency", header: "Currency", sortable: true },
  {
    key: "hoNet",
    header: "HO Net",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => (value as number).toLocaleString(undefined, { minimumFractionDigits: 2 }),
  },
  {
    key: "spNet",
    header: "SP Net",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => (value as number).toLocaleString(undefined, { minimumFractionDigits: 2 }),
  },
  {
    key: "difference",
    header: "Difference",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => (value as number).toLocaleString(undefined, { minimumFractionDigits: 2 }),
  },
  {
    key: "differenceUsd",
    header: "Diff (USD)",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => `$${(value as number).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
  },
  { key: "reason", header: "Reason", sortable: true },
  { key: "driTeam", header: "DRI Team", sortable: true },
  { key: "bookingStatus", header: "Status", sortable: true },
];

export function DriPage({ results, hasResults, onExportFiltered }: DriPageProps) {
  const [filters, setFilters] = useState<DriFilter>({
    driTeam: null,
    reason: null,
    currency: null,
    tid: null,
  });
  const { toast } = useToast();

  const uniqueCurrencies = [...new Set(results.map((r) => r.currency))].sort();
  const uniqueTids = [...new Set(results.map((r) => r.tid))].sort();

  const filteredResults = results.filter((r) => {
    if (filters.driTeam && r.driTeam !== filters.driTeam) return false;
    if (filters.reason && r.reason !== filters.reason) return false;
    if (filters.currency && r.currency !== filters.currency) return false;
    if (filters.tid && r.tid !== filters.tid) return false;
    return true;
  });

  const handleExport = () => {
    onExportFiltered(filteredResults);
    toast({ title: "Export started", description: `Exporting ${filteredResults.length} records` });
  };

  const clearFilters = () => {
    setFilters({ driTeam: null, reason: null, currency: null, tid: null });
  };

  const hasActiveFilters = Object.values(filters).some((v) => v !== null);

  if (!hasResults) {
    return (
      <div className="max-w-6xl mx-auto px-8 py-8">
        <EmptyState
          icon={Users}
          title="No DRI data"
          description="Run a reconciliation to see booking-level DRI views"
        />
      </div>
    );
  }

  return (
    <div className="max-w-full mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">DRI Views</h1>
        <p className="text-muted-foreground">
          Filter and export booking-level data by DRI team
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="text-lg">Filters</CardTitle>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-2" />
                Clear all
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">DRI Team</label>
              <Select
                value={filters.driTeam || "all"}
                onValueChange={(v) =>
                  setFilters((prev) => ({ ...prev, driTeam: v === "all" ? null : v }))
                }
              >
                <SelectTrigger data-testid="select-dri-team">
                  <SelectValue placeholder="All teams" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All teams</SelectItem>
                  {driTeams.map((team) => (
                    <SelectItem key={team} value={team}>
                      {team}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Reason</label>
              <Select
                value={filters.reason || "all"}
                onValueChange={(v) =>
                  setFilters((prev) => ({ ...prev, reason: v === "all" ? null : v }))
                }
              >
                <SelectTrigger data-testid="select-reason">
                  <SelectValue placeholder="All reasons" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All reasons</SelectItem>
                  {reasonCodes.map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {reason}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Currency</label>
              <Select
                value={filters.currency || "all"}
                onValueChange={(v) =>
                  setFilters((prev) => ({ ...prev, currency: v === "all" ? null : v }))
                }
              >
                <SelectTrigger data-testid="select-currency">
                  <SelectValue placeholder="All currencies" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All currencies</SelectItem>
                  {uniqueCurrencies.map((curr) => (
                    <SelectItem key={curr} value={curr}>
                      {curr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">TID</label>
              <Select
                value={filters.tid || "all"}
                onValueChange={(v) =>
                  setFilters((prev) => ({ ...prev, tid: v === "all" ? null : v }))
                }
              >
                <SelectTrigger data-testid="select-tid">
                  <SelectValue placeholder="All TIDs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All TIDs</SelectItem>
                  {uniqueTids.map((tid) => (
                    <SelectItem key={tid} value={tid}>
                      {tid}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CardTitle className="text-lg">Booking Data</CardTitle>
              <Badge variant="secondary">{filteredResults.length} records</Badge>
            </div>
            <Button onClick={handleExport} data-testid="button-export-filtered">
              <Download className="h-4 w-4 mr-2" />
              Export Filtered View
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={driColumns}
            data={filteredResults}
            defaultSortKey="differenceUsd"
            defaultSortDir="asc"
            testIdPrefix="dri-table"
            emptyMessage="No records match the current filters"
          />
        </CardContent>
      </Card>
    </div>
  );
}
