import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, RefreshCw, Calendar, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import type { RunResult, OverallSummaryRow, PrimaryRow } from "@shared/schema";

interface ResultsPageProps {
  runId: string | null;
}

const summaryColumns: Column<OverallSummaryRow>[] = [
  { key: "reason", header: "Reason", sortable: true },
  { key: "currency", header: "Currency", sortable: true },
  {
    key: "discrepancyLc",
    header: "Discrepancy LC",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => {
      const num = value as number;
      return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
      return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },
  },
  {
    key: "countBid",
    header: "Count of BID",
    sortable: true,
    align: "right",
    className: "font-mono",
  },
];

const bookingColumns: Column<PrimaryRow>[] = [
  { key: "bookingId", header: "Booking ID", sortable: true },
  { key: "fulfillmentIdentifier", header: "Type", sortable: true },
  { 
    key: "bookingCreationDate", 
    header: "Creation Date", 
    sortable: true,
    render: (value) => {
      if (!value) return <span className="text-muted-foreground">N/A</span>;
      return String(value);
    },
  },
  { key: "hoCurrency", header: "Currency", sortable: true },
  {
    key: "hoNet",
    header: "HO Net",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => {
      const num = value as number;
      return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
  },
  {
    key: "spNetOriginal",
    header: "SP Net Original",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => {
      const num = value as number;
      return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
  },
  {
    key: "spNetInHo",
    header: "SP Net (HO Ccy)",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => {
      const num = value as number;
      return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
  },
  {
    key: "differenceLc",
    header: "Difference LC",
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
    key: "differenceUsd",
    header: "Difference USD",
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
  { key: "reason", header: "Reason", sortable: true },
];

function LoadingSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-8 py-8 space-y-6">
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

export function ResultsPage({ runId }: ResultsPageProps) {
  const { data, isLoading, isError, error } = useQuery<RunResult>({
    queryKey: [`/api/runs/${runId}/results`],
    enabled: !!runId,
  });

  if (!runId) {
    return (
      <div className="max-w-6xl mx-auto px-8 py-8">
        <EmptyState
          icon={LayoutDashboard}
          title="No results yet"
          description="Run a reconciliation to see your results dashboard"
        />
      </div>
    );
  }

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (isError) {
    return (
      <div className="max-w-6xl mx-auto px-8 py-8">
        <EmptyState
          icon={LayoutDashboard}
          title="Error loading results"
          description={error instanceof Error ? error.message : "Something went wrong"}
        />
      </div>
    );
  }

  if (!data || data.primaryRows.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-8 py-8">
        <EmptyState
          icon={LayoutDashboard}
          title="No data found"
          description="The reconciliation completed but no matching records were found"
        />
      </div>
    );
  }

  const totalDiscrepancyUsd = data.overallSummary.reduce((sum, row) => sum + row.discrepancyUsd, 0);
  const totalBookings = data.overallSummary.reduce((sum, row) => sum + row.countBid, 0);

  const handleExport = () => {
    window.open(`/api/runs/${runId}/export`, "_blank");
  };

  return (
    <div className="max-w-6xl mx-auto px-8 py-8 space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Results Dashboard</h1>
          <p className="text-muted-foreground">
            Reconciliation summary and booking details
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <Button onClick={handleExport} data-testid="button-export">
            <Download className="h-4 w-4 mr-2" />
            Export to Excel
          </Button>
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              <span>Run ID: <code className="font-mono text-foreground">{runId}</code></span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>FX Refreshed: <code className="font-mono text-foreground">{data.fx.refreshedAt}</code></span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Total Bookings</p>
            <p className="text-3xl font-bold font-mono" data-testid="text-total-bookings">
              {totalBookings.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Total Discrepancy (USD)</p>
            <p className="text-3xl font-bold font-mono" data-testid="text-total-discrepancy">
              ${totalDiscrepancyUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Overall Reconciliation Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={summaryColumns}
            data={data.overallSummary}
            defaultSortKey="discrepancyUsd"
            defaultSortDir="asc"
            testIdPrefix="table-summary"
            emptyMessage="No summary data available"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Booking-Level Details (All Rows)</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={bookingColumns}
            data={data.allRows}
            defaultSortKey="bookingId"
            defaultSortDir="asc"
            testIdPrefix="table-bookings"
            emptyMessage="No booking data available"
          />
        </CardContent>
      </Card>
    </div>
  );
}
