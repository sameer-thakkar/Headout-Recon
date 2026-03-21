import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";

import { ChevronRight, ChevronDown, X as XIcon, Info as InfoIcon } from "lucide-react";

const formatNumber = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface AnalysisRow {
  type: "Same BE" | "Diff BE";
  discrepancyLc: number;
  discrepancyUsd: number;
  previousBe: string | null;
  bidCount: number;
  tids: string[];
  paymentMethods: string[];
}

interface BookingRow {
  bookingId: string;
  tid: string;
  hoNet: number;
  spNet: number;
  paymentMethod: string;
  dateOfPayment: string;
  hoBeId: string;
  spBeId: string;
  type: "Same BE" | "Diff BE";
}

const MOCK_BOOKINGS: BookingRow[] = [
  { bookingId: "BID-100201", tid: "TID-50001", hoNet: 245.00, spNet: 245.00, paymentMethod: "Freesale", dateOfPayment: "15/01/2026", hoBeId: "BE-101", spBeId: "BE-101", type: "Same BE" },
  { bookingId: "BID-100202", tid: "TID-50001", hoNet: 180.00, spNet: 180.00, paymentMethod: "Freesale", dateOfPayment: "15/01/2026", hoBeId: "BE-101", spBeId: "BE-101", type: "Same BE" },
  { bookingId: "BID-100203", tid: "TID-50002", hoNet: 320.00, spNet: 325.50, paymentMethod: "Freesale", dateOfPayment: "16/01/2026", hoBeId: "BE-101", spBeId: "BE-101", type: "Same BE" },
  { bookingId: "BID-100204", tid: "TID-50002", hoNet: 150.00, spNet: 152.00, paymentMethod: "Manual", dateOfPayment: "16/01/2026", hoBeId: "BE-101", spBeId: "BE-101", type: "Same BE" },
  { bookingId: "BID-100205", tid: "TID-50003", hoNet: 410.00, spNet: 410.00, paymentMethod: "Freesale", dateOfPayment: "17/01/2026", hoBeId: "BE-101", spBeId: "BE-101", type: "Same BE" },
  { bookingId: "BID-100301", tid: "TID-60001", hoNet: 520.00, spNet: 545.00, paymentMethod: "Freesale", dateOfPayment: "18/01/2026", hoBeId: "BE-102", spBeId: "BE-101", type: "Diff BE" },
  { bookingId: "BID-100302", tid: "TID-60001", hoNet: 380.00, spNet: 395.00, paymentMethod: "Freesale", dateOfPayment: "18/01/2026", hoBeId: "BE-102", spBeId: "BE-101", type: "Diff BE" },
  { bookingId: "BID-100303", tid: "TID-60002", hoNet: 290.00, spNet: 310.00, paymentMethod: "Manual", dateOfPayment: "19/01/2026", hoBeId: "BE-103", spBeId: "BE-101", type: "Diff BE" },
  { bookingId: "BID-100304", tid: "TID-60003", hoNet: 175.00, spNet: 180.00, paymentMethod: "Freesale", dateOfPayment: "20/01/2026", hoBeId: "BE-104", spBeId: "BE-101", type: "Diff BE" },
];

function buildAnalysisRows(bookings: BookingRow[]): AnalysisRow[] {
  const sameBe = bookings.filter(b => b.type === "Same BE");
  const diffBe = bookings.filter(b => b.type === "Diff BE");

  const rows: AnalysisRow[] = [];

  if (sameBe.length > 0) {
    const tids = [...new Set(sameBe.map(b => b.tid))];
    const paymentMethods = [...new Set(sameBe.map(b => b.paymentMethod).filter(Boolean))];
    rows.push({
      type: "Same BE",
      discrepancyLc: sameBe.reduce((s, b) => s + (b.spNet - b.hoNet), 0),
      discrepancyUsd: sameBe.reduce((s, b) => s + (b.spNet - b.hoNet), 0) * 1.084,
      previousBe: null,
      bidCount: sameBe.length,
      tids,
      paymentMethods,
    });
  }

  if (diffBe.length > 0) {
    const byPrevBe = new Map<string, BookingRow[]>();
    for (const b of diffBe) {
      const key = b.hoBeId;
      if (!byPrevBe.has(key)) byPrevBe.set(key, []);
      byPrevBe.get(key)!.push(b);
    }
    for (const [prevBe, group] of byPrevBe) {
      const tids = [...new Set(group.map(b => b.tid))];
      const paymentMethods = [...new Set(group.map(b => b.paymentMethod).filter(Boolean))];
      rows.push({
        type: "Diff BE",
        discrepancyLc: group.reduce((s, b) => s + (b.spNet - b.hoNet), 0),
        discrepancyUsd: group.reduce((s, b) => s + (b.spNet - b.hoNet), 0) * 1.084,
        previousBe: prevBe,
        bidCount: group.length,
        tids,
        paymentMethods,
      });
    }
  }

  return rows;
}

export default function AnalysisWorkspace() {
  const [selectedRow, setSelectedRow] = useState<AnalysisRow | null>(null);
  const [finalAmounts, setFinalAmounts] = useState<Map<string, number>>(new Map());

  const analysisRows = buildAnalysisRows(MOCK_BOOKINGS);

  const totalDiscLc = analysisRows.reduce((s, r) => s + r.discrepancyLc, 0);
  const totalDiscUsd = analysisRows.reduce((s, r) => s + r.discrepancyUsd, 0);
  const totalBids = analysisRows.reduce((s, r) => s + r.bidCount, 0);

  const detailBookings = selectedRow
    ? MOCK_BOOKINGS.filter(b => {
        if (selectedRow.type === "Same BE") return b.type === "Same BE";
        return b.type === "Diff BE" && b.hoBeId === selectedRow.previousBe;
      })
    : [];

  const getFinalAmount = (bookingId: string, spNet: number) => {
    if (finalAmounts.has(bookingId)) return finalAmounts.get(bookingId)!;
    return 0;
  };

  const setFinalAmount = (bookingId: string, val: number) => {
    setFinalAmounts(prev => { const m = new Map(prev); m.set(bookingId, val); return m; });
  };

  const zeroedOut = detailBookings.filter(b => getFinalAmount(b.bookingId, b.spNet) === 0);
  const keptPayable = detailBookings.filter(b => getFinalAmount(b.bookingId, b.spNet) !== 0);
  const zeroedLc = zeroedOut.reduce((s, b) => s + b.spNet, 0);
  const keptLc = keptPayable.reduce((s, b) => s + getFinalAmount(b.bookingId, b.spNet), 0);
  const netTapImpact = keptLc - detailBookings.reduce((s, b) => s + b.spNet, 0);

  return (
    <div style={{ fontFamily: "Inter, sans-serif", background: "#fff", minHeight: "100vh", padding: "24px" }}>
      <div className="max-w-[1200px] mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Already Reconciled</h2>
            <Badge variant="secondary" className="text-xs">{totalBids} bookings</Badge>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">Total Discrepancy:</span>
            <span className="font-mono font-semibold">{formatNumber(totalDiscLc)} LC</span>
            <span className="font-mono text-muted-foreground">({formatNumber(totalDiscUsd)} USD)</span>
          </div>
        </div>

        <Card className="mb-6">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-10"></TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Discrepancy LC</TableHead>
                <TableHead className="text-right">Discrepancy USD</TableHead>
                <TableHead>Previous BE</TableHead>
                <TableHead className="text-right">BID Count</TableHead>
                <TableHead>Payment Method</TableHead>
                <TableHead>Ticket IDs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysisRows.map((row, i) => {
                const isSelected = selectedRow === row;
                return (
                  <TableRow
                    key={i}
                    className={`cursor-pointer transition-colors ${isSelected ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/20"}`}
                    onClick={() => setSelectedRow(isSelected ? null : row)}
                    data-testid={`analysis-row-${row.type}-${i}`}
                  >
                    <TableCell className="w-10 px-3">
                      {isSelected ? (
                        <ChevronDown className="h-4 w-4 text-primary" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={row.type === "Same BE"
                          ? "bg-green-100 text-green-700"
                          : "bg-orange-100 text-orange-700"
                        }
                      >
                        {row.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      <span className={row.discrepancyLc !== 0 ? (row.discrepancyLc > 0 ? "text-red-600" : "text-green-600") : ""}>
                        {row.discrepancyLc > 0 ? "+" : ""}{formatNumber(row.discrepancyLc)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {row.discrepancyUsd > 0 ? "+" : ""}{formatNumber(row.discrepancyUsd)}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {row.previousBe || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{row.bidCount}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.paymentMethods.map(pm => (
                          <Badge key={pm} variant="secondary" className="text-[10px]">{pm}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.tids.map(tid => (
                          <Badge key={tid} variant="outline" className="text-[10px] font-mono">{tid}</Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/20 font-semibold border-t-2">
                <TableCell></TableCell>
                <TableCell className="text-sm">Total</TableCell>
                <TableCell className="text-right font-mono text-sm">
                  <span className={totalDiscLc > 0 ? "text-red-600" : "text-green-600"}>
                    {totalDiscLc > 0 ? "+" : ""}{formatNumber(totalDiscLc)}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-muted-foreground">
                  {totalDiscUsd > 0 ? "+" : ""}{formatNumber(totalDiscUsd)}
                </TableCell>
                <TableCell></TableCell>
                <TableCell className="text-right font-mono text-sm">{totalBids}</TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>

        {selectedRow && (
          <Card className="border-primary/20">
            {/* Card header */}
            <div className="px-4 py-3 border-b bg-muted/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="secondary"
                    className={selectedRow.type === "Same BE"
                      ? "bg-green-100 text-green-700"
                      : "bg-orange-100 text-orange-700"
                    }
                  >
                    {selectedRow.type}
                  </Badge>
                  {selectedRow.previousBe && (
                    <span className="text-sm text-muted-foreground">
                      Previous BE: <span className="font-mono font-medium">{selectedRow.previousBe}</span>
                    </span>
                  )}
                  <Badge variant="outline" className="text-xs">{detailBookings.length} bookings</Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setSelectedRow(null)}
                >
                  <XIcon className="h-3.5 w-3.5 mr-1" /> Close
                </Button>
              </div>
            </div>

            {/* Info banner */}
            <div className="mx-4 mt-3 mb-1 flex items-start gap-2.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-800">
              <InfoIcon className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
              <span>
                {selectedRow.type === "Same BE"
                  ? <>These bookings have already been paid under billing entity <span className="font-mono font-semibold">{detailBookings[0]?.hoBeId || "—"}</span>. Total Amount Payable has been set to <span className="font-semibold">0</span> for all. You can override individual amounts below if needed.</>
                  : <>These bookings were previously reconciled under billing entity <span className="font-mono font-semibold">{selectedRow.previousBe}</span>. Total Amount Payable has been set to <span className="font-semibold">0</span> for all. You can override individual amounts below if needed.</>
                }
              </span>
            </div>

            {/* Booking table */}
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>TID</TableHead>
                    <TableHead>Booking ID</TableHead>
                    <TableHead className="text-right">Recon Net</TableHead>
                    <TableHead className="text-right">SP Net</TableHead>
                    <TableHead className="text-right">Diff</TableHead>
                    <TableHead>Payment Method</TableHead>
                    <TableHead>Date</TableHead>
                    {selectedRow.type === "Diff BE" && (
                      <>
                        <TableHead>HO BE</TableHead>
                        <TableHead>SP BE</TableHead>
                      </>
                    )}
                    <TableHead className="w-[110px] text-right">Final Amt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailBookings.map((booking) => {
                    const diff = booking.spNet - booking.hoNet;
                    const currentFinalAmount = getFinalAmount(booking.bookingId, booking.spNet);
                    const isOverridden = currentFinalAmount !== 0;

                    return (
                      <TableRow
                        key={booking.bookingId}
                        data-testid={`booking-row-${booking.bookingId}`}
                      >
                        <TableCell className="font-mono text-xs">{booking.tid}</TableCell>
                        <TableCell className="font-mono text-xs">{booking.bookingId}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatNumber(booking.hoNet)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatNumber(booking.spNet)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {Math.abs(diff) > 0.01 ? (
                            <span className={diff > 0 ? "text-red-600" : "text-green-600"}>
                              {diff > 0 ? "+" : ""}{formatNumber(diff)}
                            </span>
                          ) : (
                            <span className="text-green-600">0.00</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{booking.paymentMethod}</TableCell>
                        <TableCell className="text-xs">{booking.dateOfPayment}</TableCell>
                        {selectedRow.type === "Diff BE" && (
                          <>
                            <TableCell className="font-mono text-xs">{booking.hoBeId}</TableCell>
                            <TableCell className="font-mono text-xs">{booking.spBeId}</TableCell>
                          </>
                        )}
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {isOverridden && (
                              <Badge className="h-4 text-[9px] px-1 bg-amber-100 text-amber-700 border-amber-200">
                                Override
                              </Badge>
                            )}
                            <Input
                              type="number"
                              step="0.01"
                              className={`h-6 text-[11px] px-1 w-20 text-right font-mono ${isOverridden ? "border-amber-400 bg-amber-50" : ""}`}
                              value={currentFinalAmount}
                              onChange={(e) => {
                                const val = Math.round((parseFloat(e.target.value) || 0) * 100) / 100;
                                setFinalAmount(booking.bookingId, val);
                              }}
                              data-testid={`final-amount-${booking.bookingId}`}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Summary strip */}
            <div className="mx-4 my-3 flex items-center gap-6 rounded-md border bg-muted/30 px-4 py-2.5 text-sm">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500 shrink-0"></span>
                <span className="text-muted-foreground">Zeroed out:</span>
                <span className="font-semibold">{zeroedOut.length} bookings</span>
                <span className="font-mono text-muted-foreground text-xs">({formatNumber(zeroedLc)} LC)</span>
              </div>
              <div className="h-4 w-px bg-border"></div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0"></span>
                <span className="text-muted-foreground">Kept payable:</span>
                <span className="font-semibold">{keptPayable.length} bookings</span>
                <span className="font-mono text-muted-foreground text-xs">({formatNumber(keptLc)} LC)</span>
              </div>
              <div className="h-4 w-px bg-border"></div>
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-muted-foreground">Net TAP impact:</span>
                <span className={`font-mono font-semibold ${netTapImpact <= 0 ? "text-green-600" : "text-red-600"}`}>
                  {netTapImpact > 0 ? "+" : ""}{formatNumber(netTapImpact)} LC
                </span>
              </div>
            </div>

            {/* Apply action */}
            <div className="px-4 pb-4 flex justify-end">
              <Button size="sm" className="text-xs">
                Apply &amp; Confirm
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
