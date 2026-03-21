import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronRight, ChevronDown, X as XIcon } from "lucide-react";

const formatNumber = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface AnalysisRow {
  type: "Same BE" | "Diff BE";
  discrepancyLc: number;
  discrepancyUsd: number;
  previousBe: string | null;
  bidCount: number;
  tids: string[];
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
    rows.push({
      type: "Same BE",
      discrepancyLc: sameBe.reduce((s, b) => s + (b.spNet - b.hoNet), 0),
      discrepancyUsd: sameBe.reduce((s, b) => s + (b.spNet - b.hoNet), 0) * 1.084,
      previousBe: null,
      bidCount: sameBe.length,
      tids,
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
      rows.push({
        type: "Diff BE",
        discrepancyLc: group.reduce((s, b) => s + (b.spNet - b.hoNet), 0),
        discrepancyUsd: group.reduce((s, b) => s + (b.spNet - b.hoNet), 0) * 1.084,
        previousBe: prevBe,
        bidCount: group.length,
        tids,
      });
    }
  }

  return rows;
}

export default function AnalysisWorkspace() {
  const [selectedRow, setSelectedRow] = useState<AnalysisRow | null>(null);
  const [decisions, setDecisions] = useState<Map<string, { decision: "pay" | "dont_pay"; reason: string; finalAmount: number }>>(new Map());
  const [activeDisputes, setActiveDisputes] = useState<Set<string>>(new Set());
  const [disputeAmounts, setDisputeAmounts] = useState<Map<string, number>>(new Map());

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
              </TableRow>
            </TableBody>
          </Table>
        </Card>

        {selectedRow && (
          <Card className="border-primary/20">
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
                    <TableHead className="w-[90px]">Decision</TableHead>
                    <TableHead className="w-[150px]">Reason</TableHead>
                    <TableHead className="w-[110px]">Dispute</TableHead>
                    <TableHead className="w-[100px] text-right">Final Amt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailBookings.map((booking, index) => {
                    const diff = booking.spNet - booking.hoNet;
                    const decision = decisions.get(booking.bookingId);
                    const isPay = !decision || decision.decision === "pay";
                    const isDontPay = decision?.decision === "dont_pay";
                    const isDisputeActive = activeDisputes.has(booking.bookingId);
                    const disputeAmount = disputeAmounts.get(booking.bookingId) || 0;
                    const currentFinalAmount = decision?.finalAmount ?? booking.spNet;
                    const reasonOptions = ["", "Cancellations", "Multiple tickets booked", "Manual Error", "Partial Fulfillment"];
                    const isCustomReason = decision?.reason && !reasonOptions.includes(decision.reason);

                    return (
                      <TableRow
                        key={booking.bookingId}
                        className={isDontPay ? "opacity-50" : ""}
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
                        <TableCell>
                          <Select
                            value={decision?.decision || "pay"}
                            onValueChange={(v: string) => {
                              const newDec = new Map(decisions);
                              newDec.set(booking.bookingId, {
                                decision: v as "pay" | "dont_pay",
                                reason: decision?.reason || "",
                                finalAmount: decision?.finalAmount ?? booking.spNet,
                              });
                              setDecisions(newDec);
                            }}
                          >
                            <SelectTrigger className="h-6 text-[11px] px-1.5" data-testid={`decision-${booking.bookingId}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pay">Pay</SelectItem>
                              <SelectItem value="dont_pay">Don't Pay</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={isCustomReason ? "" : (decision?.reason || "")}
                            onValueChange={(v: string) => {
                              const newDec = new Map(decisions);
                              newDec.set(booking.bookingId, {
                                decision: decision?.decision || "pay",
                                reason: v === "none" ? "" : v,
                                finalAmount: decision?.finalAmount ?? booking.spNet,
                              });
                              setDecisions(newDec);
                            }}
                          >
                            <SelectTrigger className="h-6 text-[11px] px-1" data-testid={`reason-${booking.bookingId}`}>
                              <SelectValue placeholder="-" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">-</SelectItem>
                              <SelectItem value="Cancellations">Cancellations</SelectItem>
                              <SelectItem value="Multiple tickets booked">Multiple tickets</SelectItem>
                              <SelectItem value="Manual Error">Manual Error</SelectItem>
                              <SelectItem value="Partial Fulfillment">Partial Fulfillment</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {isDisputeActive ? (
                            <div className="flex items-center gap-0.5">
                              <Input
                                type="number"
                                step="0.01"
                                className="h-6 text-[11px] px-1 w-14 text-right font-mono"
                                value={disputeAmount || ""}
                                onChange={(e) => {
                                  const val = Math.round((parseFloat(e.target.value) || 0) * 100) / 100;
                                  setDisputeAmounts(prev => { const m = new Map(prev); m.set(booking.bookingId, val); return m; });
                                }}
                                data-testid={`dispute-amount-${booking.bookingId}`}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                onClick={() => {
                                  setActiveDisputes(prev => { const s = new Set(prev); s.delete(booking.bookingId); return s; });
                                  setDisputeAmounts(prev => { const m = new Map(prev); m.delete(booking.bookingId); return m; });
                                }}
                              >
                                <XIcon className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-[10px] px-1.5"
                              onClick={() => {
                                setActiveDisputes(prev => new Set(prev).add(booking.bookingId));
                                setDisputeAmounts(prev => { const m = new Map(prev); m.set(booking.bookingId, Math.abs(diff)); return m; });
                              }}
                              data-testid={`dispute-btn-${booking.bookingId}`}
                            >
                              Dispute
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isPay ? (
                            <Input
                              type="number"
                              step="0.01"
                              className="h-6 text-[11px] px-1 text-right font-mono"
                              value={currentFinalAmount}
                              onChange={(e) => {
                                const newDec = new Map(decisions);
                                newDec.set(booking.bookingId, {
                                  decision: decision?.decision || "pay",
                                  reason: decision?.reason || "",
                                  finalAmount: Math.round((parseFloat(e.target.value) || 0) * 100) / 100,
                                });
                                setDecisions(newDec);
                              }}
                              data-testid={`final-amount-${booking.bookingId}`}
                            />
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
