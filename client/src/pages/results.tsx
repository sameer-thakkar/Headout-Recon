import { LayoutDashboard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import type { SummaryRow } from "@shared/schema";

interface ResultsPageProps {
  overallSummary: SummaryRow[];
  mtbSummary: SummaryRow[];
  npdSummary: SummaryRow[];
  chargeLossSummary: SummaryRow[];
  hasResults: boolean;
}

const summaryColumns: Column<SummaryRow>[] = [
  { key: "category", header: "Category", sortable: true },
  { key: "count", header: "Count", sortable: true, align: "right", className: "font-mono" },
  {
    key: "totalDiscrepancyUsd",
    header: "Discrepancy (USD)",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => `$${(value as number).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  },
  {
    key: "percentage",
    header: "%",
    sortable: true,
    align: "right",
    className: "font-mono",
    render: (value) => `${(value as number).toFixed(1)}%`,
  },
];

function SummaryCard({ title, data }: { title: string; data: SummaryRow[] }) {
  const totalDiscrepancy = data.reduce((sum, row) => sum + row.totalDiscrepancyUsd, 0);
  const totalCount = data.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Total Bookings</p>
            <p className="text-3xl font-bold font-mono">{totalCount.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Total Discrepancy</p>
            <p className="text-3xl font-bold font-mono">
              ${totalDiscrepancy.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
      </div>
      <DataTable
        columns={summaryColumns}
        data={data}
        defaultSortKey="totalDiscrepancyUsd"
        defaultSortDir="asc"
        testIdPrefix={`table-${title.toLowerCase().replace(/\s+/g, "-")}`}
      />
    </div>
  );
}

export function ResultsPage({
  overallSummary,
  mtbSummary,
  npdSummary,
  chargeLossSummary,
  hasResults,
}: ResultsPageProps) {
  if (!hasResults) {
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

  return (
    <div className="max-w-6xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Results Dashboard</h1>
        <p className="text-muted-foreground">
          View reconciliation summaries by category
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Reconciliation Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="overall">
            <TabsList className="mb-6">
              <TabsTrigger value="overall" data-testid="tab-overall">
                Overall
              </TabsTrigger>
              <TabsTrigger value="mtb" data-testid="tab-mtb">
                MTB
              </TabsTrigger>
              <TabsTrigger value="npd" data-testid="tab-npd">
                NPD
              </TabsTrigger>
              <TabsTrigger value="chargeloss" data-testid="tab-chargeloss">
                Charge Loss
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overall">
              <SummaryCard title="Overall" data={overallSummary} />
            </TabsContent>

            <TabsContent value="mtb">
              <SummaryCard title="MTB" data={mtbSummary} />
            </TabsContent>

            <TabsContent value="npd">
              <SummaryCard title="NPD" data={npdSummary} />
            </TabsContent>

            <TabsContent value="chargeloss">
              <SummaryCard title="Charge Loss" data={chargeLossSummary} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
