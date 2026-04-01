import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Calculator, Check, Info } from "lucide-react";

const fmt = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(v);

const PAX_ROWS = [
  { rowKey: "adult||2025-03-01", paxType: "Adult", dateRange: "01 Mar – 31 Mar 2025", count: 4, spUnitPrice: 120, hoUnitPrice: 110 },
  { rowKey: "child||2025-03-01", paxType: "Child", dateRange: "01 Mar – 31 Mar 2025", count: 2, spUnitPrice: 60, hoUnitPrice: 55 },
  { rowKey: "infant||2025-03-01", paxType: "Infant", dateRange: "01 Mar – 31 Mar 2025", count: 1, spUnitPrice: 0, hoUnitPrice: 0 },
];

export default function PaxPricingModal() {
  const [paxPrices, setPaxPrices] = useState<Record<string, string>>({});
  const [paxDisputePrices, setPaxDisputePrices] = useState<Record<string, string>>({});
  const [paxIssuePrices, setPaxIssuePrices] = useState<Record<string, string>>({});

  const spTotal = 4 * 120 + 2 * 60 + 1 * 0;
  const hoTotal = 4 * 110 + 2 * 55 + 1 * 0;

  const grandTotal = PAX_ROWS.reduce((s, row) => {
    const priceStr = paxPrices[row.rowKey];
    const finalPrice = priceStr !== undefined && priceStr !== "" ? parseFloat(priceStr) || 0 : row.spUnitPrice;
    return s + finalPrice * row.count;
  }, 0);

  const disputeTotal = PAX_ROWS.reduce((s, row) => {
    const v = paxDisputePrices[row.rowKey];
    return s + (v !== undefined && v !== "" ? (parseFloat(v) || 0) * row.count : 0);
  }, 0);

  const issueTotal = PAX_ROWS.reduce((s, row) => {
    const v = paxIssuePrices[row.rowKey];
    return s + (v !== undefined && v !== "" ? (parseFloat(v) || 0) * row.count : 0);
  }, 0);

  const editedCount = PAX_ROWS.filter(row => {
    const val = paxPrices[row.rowKey];
    if (val === undefined || val === "") return false;
    return Math.abs(parseFloat(val) - row.spUnitPrice) > 0.001;
  }).length;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-8">
        <div className="w-full max-w-3xl bg-white rounded-lg shadow-xl border border-gray-200">
          <div className="px-6 py-4 border-b flex items-center gap-2">
            <Calculator className="h-4 w-4 text-violet-600" />
            <span className="font-semibold text-base">Pax Pricing — TID-90234</span>
          </div>

          <div className="px-6 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-md border p-2 bg-blue-50">
                <span className="text-gray-500">SP Net Total:</span>{" "}
                <span className="font-mono font-semibold text-blue-700">{fmt(spTotal)}</span>
              </div>
              <div className="rounded-md border p-2 bg-green-50">
                <span className="text-gray-500">HO Net Total:</span>{" "}
                <span className="font-mono font-semibold text-green-700">{fmt(hoTotal)}</span>
              </div>
            </div>

            <div className="text-xs text-gray-500">
              Grouped by: <span className="font-medium text-gray-800">Experience Date</span>
              <span className="ml-1">(Payment Basis: PER_EXPERIENCE)</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Quick fill all:</span>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs"
                onClick={() => {
                  const filled: Record<string, string> = {};
                  for (const row of PAX_ROWS) filled[row.rowKey] = String(row.spUnitPrice);
                  setPaxPrices(filled);
                }}
              >
                All SP
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs"
                onClick={() => {
                  const filled: Record<string, string> = {};
                  for (const row of PAX_ROWS) filled[row.rowKey] = String(row.hoUnitPrice);
                  setPaxPrices(filled);
                }}
              >
                All HO
              </Button>
            </div>

            <div className="rounded-md border overflow-hidden bg-white max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="text-xs">Pax Type</TableHead>
                    <TableHead className="text-xs">Date Range</TableHead>
                    <TableHead className="text-xs text-right">Count</TableHead>
                    <TableHead className="text-xs text-right">SP Unit</TableHead>
                    <TableHead className="text-xs text-right">HO Unit</TableHead>
                    <TableHead className="text-xs text-right">Final Price</TableHead>
                    <TableHead className="text-xs text-right">
                      <div className="flex items-center justify-end gap-1">
                        Dispute (per pax)
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3 w-3 text-gray-400 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[220px] text-xs">
                            Amount you are formally disputing with the vendor for this pax type (unit level). Aggregated into the TID-level dispute total.
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </TableHead>
                    <TableHead className="text-xs text-right">
                      <div className="flex items-center justify-end gap-1">
                        Issue (per pax)
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3 w-3 text-gray-400 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[220px] text-xs">
                            Amount being flagged as an internal issue (e.g., system error, data mismatch) for this pax type (unit level). Aggregated into the TID-level issue total.
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PAX_ROWS.map((row) => (
                    <TableRow key={row.rowKey}>
                      <TableCell className="text-xs font-medium">{row.paxType}</TableCell>
                      <TableCell className="text-xs font-mono text-gray-500">{row.dateRange}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{row.count}</TableCell>
                      <TableCell className="text-xs text-right font-mono text-blue-600">{fmt(row.spUnitPrice)}</TableCell>
                      <TableCell className="text-xs text-right font-mono text-green-600">{fmt(row.hoUnitPrice)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1.5 text-[10px] text-blue-600"
                            onClick={() => setPaxPrices(prev => ({ ...prev, [row.rowKey]: String(row.spUnitPrice) }))}
                          >
                            SP
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1.5 text-[10px] text-green-600"
                            onClick={() => setPaxPrices(prev => ({ ...prev, [row.rowKey]: String(row.hoUnitPrice) }))}
                          >
                            HO
                          </Button>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="Price"
                            value={paxPrices[row.rowKey] ?? ""}
                            onChange={(e) => setPaxPrices(prev => ({ ...prev, [row.rowKey]: e.target.value }))}
                            className="w-20 text-xs font-mono text-right"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1.5 text-[10px] text-blue-600"
                            onClick={() => setPaxDisputePrices(prev => ({ ...prev, [row.rowKey]: String(row.spUnitPrice) }))}
                          >
                            SP
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1.5 text-[10px] text-green-600"
                            onClick={() => setPaxDisputePrices(prev => ({ ...prev, [row.rowKey]: String(row.hoUnitPrice) }))}
                          >
                            HO
                          </Button>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="Dispute"
                            value={paxDisputePrices[row.rowKey] ?? ""}
                            onChange={(e) => setPaxDisputePrices(prev => ({ ...prev, [row.rowKey]: e.target.value }))}
                            className="w-20 text-xs font-mono text-right border-orange-200 focus:border-orange-400"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1.5 text-[10px] text-blue-600"
                            onClick={() => setPaxIssuePrices(prev => ({ ...prev, [row.rowKey]: String(row.spUnitPrice) }))}
                          >
                            SP
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1.5 text-[10px] text-green-600"
                            onClick={() => setPaxIssuePrices(prev => ({ ...prev, [row.rowKey]: String(row.hoUnitPrice) }))}
                          >
                            HO
                          </Button>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="Issue"
                            value={paxIssuePrices[row.rowKey] ?? ""}
                            onChange={(e) => setPaxIssuePrices(prev => ({ ...prev, [row.rowKey]: e.target.value }))}
                            className="w-20 text-xs font-mono text-right border-red-200 focus:border-red-400"
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between gap-3 bg-gray-50 rounded-md px-3 py-2 border">
              <div className="flex items-center gap-4 text-xs flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-gray-600">Recalculated Total:</span>
                  <span className="font-mono font-bold text-violet-700 text-sm">{fmt(grandTotal)}</span>
                </div>
                <div className="w-px h-4 bg-gray-300" />
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-orange-600">Dispute Total:</span>
                  <span className="font-mono font-bold text-orange-700 text-sm">{fmt(disputeTotal)}</span>
                </div>
                <div className="w-px h-4 bg-gray-300" />
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-red-600">Issue Total:</span>
                  <span className="font-mono font-bold text-red-700 text-sm">{fmt(issueTotal)}</span>
                </div>
              </div>
              <span className="text-[11px] text-gray-400">{editedCount} price{editedCount !== 1 ? "s" : ""} edited</span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button size="sm" variant="ghost" className="h-7 text-xs">Cancel</Button>
              <Button size="sm" className="h-7 text-xs gap-1">
                <Check className="h-3 w-3" />
                Apply Pax Pricing
              </Button>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
