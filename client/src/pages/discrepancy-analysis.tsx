import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo } from "react";
import type { DiscrepancyAnalysisRow } from "@shared/schema";

function formatDateDDMMYYYY(value: unknown): string | null {
  if (!value) return null;
  const dateStr = String(value).split("T")[0];
  const [year, month, day] = dateStr.split("-");
  if (year && month && day) {
    return `${day}/${month}/${year}`;
  }
  return dateStr;
}

interface DiscrepancyAnalysisPageProps {
  runId: string | null;
}

interface DiscrepancyAnalysisResponse {
  analysisRows: DiscrepancyAnalysisRow[];
  reasons: string[];
}

const baseColumns: Column<DiscrepancyAnalysisRow>[] = [
  { key: "tid", header: "TID", sortable: true },
  { key: "currency", header: "Currency", sortable: true },
  {
    key: "discrepancyLc",
    header: "Discrepancy LC",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => {
      const num = value as number;
      const formatted = num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const color = num > 0 ? "text-red-600 dark:text-red-400" : num < 0 ? "text-green-600 dark:text-green-400" : "";
      return <span className={color}>{formatted}</span>;
    },
  },
  {
    key: "discrepancyUsd",
    header: "Discrepancy USD",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => {
      const num = value as number;
      const formatted = `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const color = num > 0 ? "text-red-600 dark:text-red-400" : num < 0 ? "text-green-600 dark:text-green-400" : "";
      return <span className={color}>{formatted}</span>;
    },
  },
];

const mtbColumns: Column<DiscrepancyAnalysisRow>[] = [
  ...baseColumns,
  { key: "fulfillmentMethod", header: "Fulfillment Method", sortable: true },
  { key: "timesCharged", header: "Times Charged", sortable: true, align: "right", className: "font-mono" },
  { 
    key: "startDate", 
    header: "Start Date", 
    sortable: true,
    render: (value) => {
      const formatted = formatDateDDMMYYYY(value);
      return formatted ? formatted : <span className="text-muted-foreground">N/A</span>;
    },
  },
  { 
    key: "endDate", 
    header: "End Date", 
    sortable: true,
    render: (value) => {
      const formatted = formatDateDDMMYYYY(value);
      return formatted ? formatted : <span className="text-muted-foreground">N/A</span>;
    },
  },
  { 
    key: "countBidWithDiscrepancy", 
    header: "BIDs w/ Discrepancy", 
    sortable: true, 
    align: "right", 
    className: "font-mono" 
  },
  { 
    key: "countBidsInDuration", 
    header: "BIDs in Duration", 
    sortable: true, 
    align: "right", 
    className: "font-mono" 
  },
  {
    key: "discrepancyCoveragePercent",
    header: "Coverage %",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => `${(value as number).toFixed(1)}%`,
  },
  {
    key: "frequency",
    header: "Frequency",
    sortable: true,
    render: (value) => {
      const freq = value as string;
      return (
        <Badge variant={freq === "Recurring" ? "destructive" : "secondary"}>
          {freq}
        </Badge>
      );
    },
  },
  { key: "driTeam", header: "DRI Team", sortable: true },
];

const npdColumns: Column<DiscrepancyAnalysisRow>[] = [
  ...baseColumns,
  {
    key: "hoTakeRatePercent",
    header: "HO Take Rate",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => value != null ? `${(value as number).toFixed(2)}%` : <span className="text-muted-foreground">N/A</span>,
  },
  {
    key: "actualTakeRatePercent",
    header: "Actual Take Rate",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => value != null ? `${(value as number).toFixed(2)}%` : <span className="text-muted-foreground">N/A</span>,
  },
  { 
    key: "startDate", 
    header: "Start Date", 
    sortable: true,
    render: (value) => {
      const formatted = formatDateDDMMYYYY(value);
      return formatted ? formatted : <span className="text-muted-foreground">N/A</span>;
    },
  },
  { 
    key: "endDate", 
    header: "End Date", 
    sortable: true,
    render: (value) => {
      const formatted = formatDateDDMMYYYY(value);
      return formatted ? formatted : <span className="text-muted-foreground">N/A</span>;
    },
  },
  { 
    key: "countBidWithDiscrepancy", 
    header: "BIDs w/ Discrepancy", 
    sortable: true, 
    align: "right", 
    className: "font-mono" 
  },
  { 
    key: "countBidsInDuration", 
    header: "BIDs in Duration", 
    sortable: true, 
    align: "right", 
    className: "font-mono" 
  },
  {
    key: "discrepancyCoveragePercent",
    header: "Coverage %",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => `${(value as number).toFixed(1)}%`,
  },
  {
    key: "discrepancyPercentRange",
    header: "Discrepancy %",
    sortable: true,
    render: (value) => value || <span className="text-muted-foreground">N/A</span>,
  },
  {
    key: "pattern",
    header: "Pattern",
    sortable: true,
    render: (value) => {
      if (!value) return <span className="text-muted-foreground">N/A</span>;
      const pat = value as string;
      return (
        <Badge variant={pat === "Consistent" ? "outline" : "secondary"}>
          {pat}
        </Badge>
      );
    },
  },
  {
    key: "frequency",
    header: "Frequency",
    sortable: true,
    render: (value) => {
      const freq = value as string;
      return (
        <Badge variant={freq === "Recurring" ? "destructive" : "secondary"}>
          {freq}
        </Badge>
      );
    },
  },
  { key: "fulfillmentMethod", header: "Fulfillment Method", sortable: true },
  { key: "driTeam", header: "DRI Team", sortable: true },
  {
    key: "soldAtLoss",
    header: "Sold at Loss?",
    sortable: true,
    render: (value) => {
      if (!value) return <span className="text-muted-foreground">N/A</span>;
      const isLoss = value === "Yes";
      return (
        <Badge variant={isLoss ? "destructive" : "outline"}>
          {value as string}
        </Badge>
      );
    },
  },
  {
    key: "lossLc",
    header: "Loss LC",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => {
      if (value == null) return <span className="text-muted-foreground">-</span>;
      const num = value as number;
      return <span className="text-red-600 dark:text-red-400">{num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
    },
  },
  {
    key: "lossUsd",
    header: "Loss USD",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => {
      if (value == null) return <span className="text-muted-foreground">-</span>;
      const num = value as number;
      return <span className="text-red-600 dark:text-red-400">${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
    },
  },
];

function LoadingSkeleton() {
  return (
    <div className="max-w-7xl mx-auto px-8 py-8 space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function DiscrepancyAnalysisPage({ runId }: DiscrepancyAnalysisPageProps) {
  const [selectedReason, setSelectedReason] = useState<string>("Multiple Tickets Booked");

  const { data, isLoading, isError, error } = useQuery<DiscrepancyAnalysisResponse>({
    queryKey: [`/api/runs/${runId}/discrepancy-analysis`, selectedReason],
    queryFn: async () => {
      const url = selectedReason 
        ? `/api/runs/${runId}/discrepancy-analysis?reason=${encodeURIComponent(selectedReason)}`
        : `/api/runs/${runId}/discrepancy-analysis`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch discrepancy analysis");
      return response.json();
    },
    enabled: !!runId,
  });

  const columns = useMemo(() => {
    if (selectedReason === "Net Price Discrepancy") {
      return npdColumns;
    }
    return mtbColumns;
  }, [selectedReason]);

  if (!runId) {
    return (
      <div className="max-w-7xl mx-auto px-8 py-8">
        <EmptyState
          icon={Search}
          title="No results yet"
          description="Run a reconciliation to see discrepancy analysis"
        />
      </div>
    );
  }

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (isError) {
    return (
      <div className="max-w-7xl mx-auto px-8 py-8">
        <EmptyState
          icon={Search}
          title="Error loading analysis"
          description={error instanceof Error ? error.message : "Something went wrong"}
        />
      </div>
    );
  }

  const rows = data?.analysisRows || [];
  const reasons = data?.reasons || [];

  return (
    <div className="max-w-[95vw] mx-auto px-8 py-8 space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Discrepancy Analysis</h1>
          <p className="text-muted-foreground">
            Detailed analysis of discrepancies by reason and TID
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Filter by reason:</span>
          <Select value={selectedReason} onValueChange={setSelectedReason}>
            <SelectTrigger className="w-[220px]" data-testid="select-reason-filter">
              <SelectValue placeholder="Select reason" />
            </SelectTrigger>
            <SelectContent>
              {reasons.map((reason) => (
                <SelectItem key={reason} value={reason}>
                  {reason}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            {selectedReason} Analysis
            <Badge variant="outline" className="ml-2">
              {rows.length} TIDs
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={Search}
              title={`No ${selectedReason} discrepancies found`}
              description="Try selecting a different reason or running a new reconciliation"
            />
          ) : (
            <div className="overflow-x-auto">
              <DataTable
                columns={columns}
                data={rows}
                defaultSortKey="discrepancyUsd"
                defaultSortDir="desc"
                testIdPrefix="table-analysis"
                emptyMessage="No discrepancy data available"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
