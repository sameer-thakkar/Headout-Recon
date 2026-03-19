import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  ChevronRight, ChevronDown, MoreHorizontal, FileDown, ArrowLeft,
  AlertTriangle, XCircle, CheckCircle2, Flag, Search,
  DollarSign, Pencil, Check, X, Gavel
} from "lucide-react";

const MOCK_SUMMARY = [
  { reason: "Already Reconciled", currency: "EUR", discLc: 0, discUsd: 0, count: 42, type: "special-ar" },
  { reason: "Cancellations", currency: "EUR", discLc: -3_240.50, discUsd: -3_510.20, count: 15, type: "special-cancel" },
  { reason: "Net Price Discrepancy", currency: "EUR", discLc: 12_450.75, discUsd: 13_488.31, count: 28, type: "regular" },
  { reason: "Multiple Tickets Booked", currency: "EUR", discLc: 4_320.00, discUsd: 4_682.64, count: 8, type: "regular" },
  { reason: "Negative SP - Partial Refund", currency: "EUR", discLc: -1_120.00, discUsd: -1_214.08, count: 5, type: "regular" },
  { reason: "Reconciled", currency: "EUR", discLc: 0, discUsd: 0, count: 312, type: "reconciled" },
];

const MOCK_TIDS = [
  { tid: "TID-90234", spNet: 5_200.00, hoNet: 4_850.00, discLc: 350.00, discUsd: 379.40, bidCount: 6, fm: "FMTC", startDate: "12/01/2026", endDate: "15/02/2026" },
  { tid: "TID-90456", spNet: 18_400.00, hoNet: 12_300.00, discLc: 6_100.00, discUsd: 6_612.40, bidCount: 12, fm: "FMTC", startDate: "01/01/2026", endDate: "28/02/2026" },
  { tid: "TID-90789", spNet: 8_900.00, hoNet: 3_900.00, discLc: 5_000.75, discUsd: 5_420.81, bidCount: 7, fm: "FMTB", startDate: "05/01/2026", endDate: "20/02/2026" },
  { tid: "TID-91012", spNet: 3_100.00, hoNet: 2_100.00, discLc: 1_000.00, discUsd: 1_084.00, bidCount: 3, fm: "FMTC", startDate: "18/01/2026", endDate: "10/02/2026" },
];

const MOCK_BOOKINGS = [
  { bookingId: "BID-1001", spNet: 850.00, hoNet: 800.00, selected: "HO" as const, amountPayable: 800.00, disputed: false, dateOfPayment: "12/01/2026", paxType: "Adult" },
  { bookingId: "BID-1002", spNet: 920.00, hoNet: 850.00, selected: "HO" as const, amountPayable: 850.00, disputed: false, dateOfPayment: "15/01/2026", paxType: "Adult" },
  { bookingId: "BID-1003", spNet: 1_100.00, hoNet: 1_050.00, selected: "SP" as const, amountPayable: 1_100.00, disputed: true, disputeAmt: 50.00, dateOfPayment: "20/01/2026", paxType: "Child" },
  { bookingId: "BID-1004", spNet: 780.00, hoNet: 780.00, selected: "HO" as const, amountPayable: 780.00, disputed: false, dateOfPayment: "25/01/2026", paxType: "Adult" },
  { bookingId: "BID-1005", spNet: 850.00, hoNet: 670.00, selected: "HO" as const, amountPayable: 670.00, disputed: false, dateOfPayment: "01/02/2026", paxType: "Adult" },
  { bookingId: "BID-1006", spNet: 700.00, hoNet: 700.00, selected: "HO" as const, amountPayable: 700.00, disputed: false, dateOfPayment: "10/02/2026", paxType: "Senior" },
];

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function SeverityBorder({ usd }: { usd: number }) {
  const abs = Math.abs(usd);
  if (abs > 5000) return <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500 rounded-l" />;
  if (abs > 1000) return <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500 rounded-l" />;
  if (abs > 0) return <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-400 rounded-l" />;
  return <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500 rounded-l" />;
}

type ModalView = { level: "closed" } | { level: "tids"; reason: string } | { level: "bookings"; reason: string; tid: string };

export function ModalWorkspace() {
  const [modalView, setModalView] = useState<ModalView>({ level: "closed" });
  const [editingBooking, setEditingBooking] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [tidSearch, setTidSearch] = useState("");

  const showFeedback = (msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(null), 2500);
  };

  const totalDiscUsd = MOCK_SUMMARY.reduce((s, r) => s + r.discUsd, 0);
  const totalCount = MOCK_SUMMARY.reduce((s, r) => s + r.count, 0);
  const isOpen = modalView.level !== "closed";
  const currentReason = modalView.level !== "closed" ? modalView.reason : "";
  const currentTid = modalView.level === "bookings" ? modalView.tid : "";

  const filteredTids = MOCK_TIDS.filter(t =>
    !tidSearch || t.tid.toLowerCase().includes(tidSearch.toLowerCase())
  );

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background font-sans">
        <div className="border-b bg-card px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tracking-tight">Reconciliation</span>
            <Badge variant="outline" className="text-xs font-mono">BE-4521 · Musement</Badge>
            <Badge variant="outline" className="text-xs font-mono">EUR</Badge>
            <Badge variant="outline" className="text-xs">Credit</Badge>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <FileDown className="h-3.5 w-3.5 mr-1.5" />
                  Export
                  <ChevronDown className="h-3.5 w-3.5 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Excel — Discrepancy Analysis</DropdownMenuItem>
                <DropdownMenuItem>Google Sheets — Discrepancy Analysis</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Excel — Financial Report</DropdownMenuItem>
                <DropdownMenuItem>Google Sheets — Financial Report</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white">
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Apply & Confirm
            </Button>
          </div>
        </div>

        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold">Overall Reconciliation Summary</h2>
              <Badge variant="secondary" className="text-xs">{totalCount} bookings</Badge>
            </div>
            <div className="text-right">
              <span className="text-xs text-muted-foreground">Total Discrepancy</span>
              <p className={`font-mono font-semibold ${totalDiscUsd > 0 ? "text-red-600" : "text-green-600"}`}>
                {fmt(totalDiscUsd)} USD
              </p>
            </div>
          </div>

          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="h-9 bg-muted/50">
                  <TableHead className="py-2 text-xs font-medium">Reason</TableHead>
                  <TableHead className="py-2 text-xs font-medium">Currency</TableHead>
                  <TableHead className="py-2 text-xs font-medium text-right">Disc. LC</TableHead>
                  <TableHead className="py-2 text-xs font-medium text-right">Disc. USD</TableHead>
                  <TableHead className="py-2 text-xs font-medium text-right">Count</TableHead>
                  <TableHead className="py-2 text-xs font-medium w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MOCK_SUMMARY.map((row) => {
                  const isExpandable = row.type !== "reconciled";
                  const rowBg = row.type === "special-ar"
                    ? "bg-amber-50/60 dark:bg-amber-950/20"
                    : row.type === "special-cancel"
                      ? "bg-red-50/60 dark:bg-red-950/20"
                      : row.type === "reconciled"
                        ? "bg-green-50/40 dark:bg-green-950/20"
                        : "";

                  return (
                    <TableRow
                      key={row.reason}
                      className={`h-10 relative transition-colors ${rowBg} ${isExpandable ? "cursor-pointer hover:bg-muted/40" : ""}`}
                      onClick={() => isExpandable && setModalView({ level: "tids", reason: row.reason })}
                    >
                      <TableCell className="py-2 pl-4">
                        <SeverityBorder usd={row.discUsd} />
                        <span className={`text-sm font-medium flex items-center gap-1.5 ${
                          row.type === "special-ar" ? "text-amber-700 dark:text-amber-400" :
                          row.type === "special-cancel" ? "text-red-600 dark:text-red-400" :
                          row.type === "reconciled" ? "text-green-600 dark:text-green-400" :
                          "text-foreground"
                        }`}>
                          {row.type === "special-ar" && <AlertTriangle className="h-3.5 w-3.5" />}
                          {row.type === "special-cancel" && <XCircle className="h-3.5 w-3.5" />}
                          {row.type === "reconciled" && <CheckCircle2 className="h-3.5 w-3.5" />}
                          {row.reason}
                          {isExpandable && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-1" />}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 text-sm">{row.currency}</TableCell>
                      <TableCell className={`py-2 text-right font-mono text-sm ${row.discLc > 0 ? "text-red-600" : row.discLc < 0 ? "text-red-500" : ""}`}>
                        {fmt(row.discLc)}
                      </TableCell>
                      <TableCell className={`py-2 text-right font-mono text-sm ${row.discUsd > 0 ? "text-red-600" : row.discUsd < 0 ? "text-red-500" : ""}`}>
                        {fmt(row.discUsd)}
                      </TableCell>
                      <TableCell className="py-2 text-right text-sm">{row.count}</TableCell>
                      <TableCell className="py-2 pr-3" onClick={(e) => e.stopPropagation()}>
                        {isExpandable && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuItem onClick={() => showFeedback(`All ${row.count} bookings set to SP Net`)}>
                                <DollarSign className="h-3.5 w-3.5 mr-2 text-blue-600" />
                                Set all to SP Net
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => showFeedback(`All ${row.count} bookings set to HO Net`)}>
                                <DollarSign className="h-3.5 w-3.5 mr-2 text-emerald-600" />
                                Set all to HO Net
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => showFeedback("Dispute raised for all bookings")}>
                                <Gavel className="h-3.5 w-3.5 mr-2 text-amber-600" />
                                Dispute all
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => showFeedback("Issue flagged")}>
                                <Flag className="h-3.5 w-3.5 mr-2 text-violet-600" />
                                Flag issue
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="border-t bg-muted/30 px-4 py-3">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-4">
                  <span className="text-muted-foreground">Grand Total</span>
                  <Badge variant="secondary" className="text-xs">{totalCount} bookings</Badge>
                </div>
                <div className="flex items-center gap-6">
                  <div>
                    <span className="text-xs text-muted-foreground mr-2">LC</span>
                    <span className="font-mono font-semibold text-red-600">{fmt(MOCK_SUMMARY.reduce((s, r) => s + r.discLc, 0))}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground mr-2">USD</span>
                    <span className="font-mono font-semibold text-red-600">{fmt(totalDiscUsd)}</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5"><div className="w-3 h-2 bg-red-500 rounded-sm" /> &gt; 5,000 USD</div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-2 bg-amber-500 rounded-sm" /> &gt; 1,000 USD</div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-2 bg-blue-400 rounded-sm" /> &lt; 1,000 USD</div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-2 bg-green-500 rounded-sm" /> Reconciled</div>
          </div>
        </div>

        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) setModalView({ level: "closed" }); }}>
          <DialogContent className="max-w-[92vw] max-h-[85vh] flex flex-col p-0 gap-0">
            {actionFeedback && (
              <div className="mx-4 mt-3 px-3 py-2 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded-md flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
                <CheckCircle2 className="h-4 w-4" />
                {actionFeedback}
              </div>
            )}

            <div className="px-6 pt-5 pb-3 border-b">
              <div className="flex items-center gap-2 mb-3">
                {modalView.level === "bookings" && (
                  <Button
                    variant="ghost" size="sm" className="h-7 w-7 p-0 -ml-1"
                    onClick={() => setModalView({ level: "tids", reason: currentReason })}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                )}
                <nav className="flex items-center gap-1.5 text-sm">
                  <button
                    className={`font-medium ${modalView.level === "bookings" ? "text-primary hover:underline cursor-pointer" : "text-foreground"}`}
                    onClick={() => modalView.level === "bookings" && setModalView({ level: "tids", reason: currentReason })}
                  >
                    {currentReason}
                  </button>
                  {modalView.level === "bookings" && (
                    <>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-mono font-medium">{currentTid}</span>
                    </>
                  )}
                </nav>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {modalView.level === "tids" && (
                    <Badge variant="secondary" className="text-xs">
                      {MOCK_TIDS.length} TIDs · {MOCK_SUMMARY.find(r => r.reason === currentReason)?.count} bookings
                    </Badge>
                  )}
                  {modalView.level === "bookings" && (
                    <>
                      <Badge variant="outline" className="text-xs font-mono">
                        {MOCK_TIDS.find(t => t.tid === currentTid)?.fm}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {MOCK_BOOKINGS.length} bookings
                      </Badge>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {modalView.level === "tids" && (
                    <div className="relative">
                      <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search TIDs..."
                        className="h-8 pl-8 w-48 text-xs"
                        value={tidSearch}
                        onChange={(e) => setTidSearch(e.target.value)}
                      />
                    </div>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8">
                        Bulk Actions
                        <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem onClick={() => showFeedback("All set to SP Net")}>
                        <DollarSign className="h-3.5 w-3.5 mr-2 text-blue-600" />
                        Set all to SP Net
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => showFeedback("All set to HO Net")}>
                        <DollarSign className="h-3.5 w-3.5 mr-2 text-emerald-600" />
                        Set all to HO Net
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => showFeedback("Dispute raised for all")}>
                        <Gavel className="h-3.5 w-3.5 mr-2 text-amber-600" />
                        Dispute all
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => showFeedback("Issue flagged")}>
                        <Flag className="h-3.5 w-3.5 mr-2 text-violet-600" />
                        Flag issue
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {modalView.level === "tids" && (
                <Table>
                  <TableHeader>
                    <TableRow className="h-9 bg-muted/30 sticky top-0">
                      <TableHead className="py-2 text-xs font-medium pl-6">TID</TableHead>
                      <TableHead className="py-2 text-xs font-medium">Fulfillment</TableHead>
                      <TableHead className="py-2 text-xs font-medium text-right">SP Net (LC)</TableHead>
                      <TableHead className="py-2 text-xs font-medium text-right">HO Net (LC)</TableHead>
                      <TableHead className="py-2 text-xs font-medium text-right">Disc. LC</TableHead>
                      <TableHead className="py-2 text-xs font-medium text-right">Disc. USD</TableHead>
                      <TableHead className="py-2 text-xs font-medium text-right">BIDs</TableHead>
                      <TableHead className="py-2 text-xs font-medium">Period</TableHead>
                      <TableHead className="py-2 text-xs font-medium w-48 text-right pr-6">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTids.map((tid) => {
                      const pctOfTotal = ((tid.discUsd / 13_488.31) * 100).toFixed(0);
                      return (
                        <TableRow
                          key={tid.tid}
                          className="h-11 cursor-pointer hover:bg-muted/40 transition-colors"
                          onClick={() => setModalView({ level: "bookings", reason: currentReason, tid: tid.tid })}
                        >
                          <TableCell className="py-2 pl-6">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-medium text-sm text-primary">{tid.tid}</span>
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                          </TableCell>
                          <TableCell className="py-2">
                            <Badge variant="outline" className="text-[10px]">{tid.fm}</Badge>
                          </TableCell>
                          <TableCell className="py-2 text-right font-mono text-sm">{fmt(tid.spNet)}</TableCell>
                          <TableCell className="py-2 text-right font-mono text-sm">{fmt(tid.hoNet)}</TableCell>
                          <TableCell className="py-2 text-right font-mono text-sm text-red-600">{fmt(tid.discLc)}</TableCell>
                          <TableCell className="py-2 text-right font-mono text-sm text-red-600">
                            <div className="flex items-center justify-end gap-2">
                              {fmt(tid.discUsd)}
                              <span className="text-[10px] text-muted-foreground font-sans">({pctOfTotal}%)</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2 text-right text-sm">{tid.bidCount}</TableCell>
                          <TableCell className="py-2 text-xs text-muted-foreground">
                            {tid.startDate} – {tid.endDate}
                          </TableCell>
                          <TableCell className="py-2 pr-6" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1 justify-end">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => showFeedback(`${tid.tid}: Set to SP Net`)}>
                                    <span className="font-semibold text-blue-600">SP</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Set all bookings to SP Net</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => showFeedback(`${tid.tid}: Set to HO Net`)}>
                                    <span className="font-semibold text-emerald-600">HO</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Set all bookings to HO Net</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => showFeedback(`Dispute raised for ${tid.tid}`)}>
                                    <Gavel className="h-3.5 w-3.5 text-amber-600" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Dispute all bookings</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => showFeedback(`Issue flagged for ${tid.tid}`)}>
                                    <Flag className="h-3.5 w-3.5 text-violet-600" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Flag issue</TooltipContent>
                              </Tooltip>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                    <MoreHorizontal className="h-3.5 w-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem>Manage Pax Pricing</DropdownMenuItem>
                                  <DropdownMenuItem>Correct Vendor ID</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}

              {modalView.level === "bookings" && (
                <Table>
                  <TableHeader>
                    <TableRow className="h-9 bg-muted/30 sticky top-0">
                      <TableHead className="py-2 text-xs font-medium pl-6">Booking ID</TableHead>
                      <TableHead className="py-2 text-xs font-medium">Pax Type</TableHead>
                      <TableHead className="py-2 text-xs font-medium">Date</TableHead>
                      <TableHead className="py-2 text-xs font-medium text-right">SP Net</TableHead>
                      <TableHead className="py-2 text-xs font-medium text-right">HO Net</TableHead>
                      <TableHead className="py-2 text-xs font-medium text-center w-24">Use Net</TableHead>
                      <TableHead className="py-2 text-xs font-medium text-right">Amount Payable</TableHead>
                      <TableHead className="py-2 text-xs font-medium text-center">Dispute</TableHead>
                      <TableHead className="py-2 text-xs font-medium text-right pr-6">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {MOCK_BOOKINGS.map((b) => {
                      const diff = b.spNet - b.hoNet;
                      return (
                        <TableRow key={b.bookingId} className="h-11 hover:bg-muted/30">
                          <TableCell className="py-2 pl-6 font-mono text-sm text-primary font-medium">{b.bookingId}</TableCell>
                          <TableCell className="py-2 text-sm">{b.paxType}</TableCell>
                          <TableCell className="py-2 text-sm text-muted-foreground">{b.dateOfPayment}</TableCell>
                          <TableCell className="py-2 text-right font-mono text-sm">{fmt(b.spNet)}</TableCell>
                          <TableCell className="py-2 text-right font-mono text-sm">{fmt(b.hoNet)}</TableCell>
                          <TableCell className="py-2 text-center">
                            <div className="flex items-center justify-center">
                              <div className="inline-flex rounded-md border overflow-hidden">
                                <button className={`px-3 py-1 text-xs font-medium transition-colors ${b.selected === "SP" ? "bg-blue-600 text-white" : "bg-background text-muted-foreground hover:bg-muted"}`}>
                                  SP
                                </button>
                                <button className={`px-3 py-1 text-xs font-medium transition-colors border-l ${b.selected === "HO" ? "bg-emerald-600 text-white" : "bg-background text-muted-foreground hover:bg-muted"}`}>
                                  HO
                                </button>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-2 text-right">
                            {editingBooking === b.bookingId ? (
                              <div className="flex items-center gap-1.5 justify-end">
                                <Input className="h-7 w-24 text-xs text-right font-mono" defaultValue={b.amountPayable} autoFocus />
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditingBooking(null); showFeedback("Price updated"); }}>
                                  <Check className="h-3.5 w-3.5 text-green-600" />
                                </Button>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditingBooking(null)}>
                                  <X className="h-3.5 w-3.5 text-red-500" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 justify-end group">
                                <span className={`font-mono text-sm ${diff !== 0 ? "text-blue-600 font-medium" : ""}`}>
                                  {fmt(b.amountPayable)}
                                </span>
                                <Button
                                  variant="ghost" size="sm"
                                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => setEditingBooking(b.bookingId)}
                                >
                                  <Pencil className="h-3 w-3 text-muted-foreground" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="py-2 text-center">
                            {b.disputed ? (
                              <div className="flex items-center justify-center gap-1.5">
                                <Badge variant="destructive" className="text-[11px] px-2 py-0.5">
                                  <Gavel className="h-3 w-3 mr-1" />
                                  {fmt(b.disputeAmt || 0)}
                                </Badge>
                              </div>
                            ) : (
                              <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs text-muted-foreground hover:text-amber-600 hover:border-amber-300">
                                <Gavel className="h-3 w-3 mr-1" />
                                Dispute
                              </Button>
                            )}
                          </TableCell>
                          <TableCell className="py-2 pr-6 text-right">
                            <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs text-muted-foreground hover:text-violet-600 hover:border-violet-300">
                              <Flag className="h-3 w-3 mr-1" />
                              Issue
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>

            <div className="border-t bg-muted/30 px-6 py-3 flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {modalView.level === "tids" && `${filteredTids.length} TIDs`}
                {modalView.level === "bookings" && `${MOCK_BOOKINGS.length} bookings in ${currentTid}`}
              </div>
              <div className="flex items-center gap-4 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground mr-2">Total SP Net</span>
                  <span className="font-mono font-medium">
                    {modalView.level === "tids"
                      ? fmt(MOCK_TIDS.reduce((s, t) => s + t.spNet, 0))
                      : fmt(MOCK_BOOKINGS.reduce((s, b) => s + b.spNet, 0))
                    }
                  </span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground mr-2">Total HO Net</span>
                  <span className="font-mono font-medium">
                    {modalView.level === "tids"
                      ? fmt(MOCK_TIDS.reduce((s, t) => s + t.hoNet, 0))
                      : fmt(MOCK_BOOKINGS.reduce((s, b) => s + b.hoNet, 0))
                    }
                  </span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground mr-2">Disc. USD</span>
                  <span className="font-mono font-semibold text-red-600">
                    {modalView.level === "tids"
                      ? fmt(MOCK_TIDS.reduce((s, t) => s + t.discUsd, 0))
                      : fmt(MOCK_BOOKINGS.reduce((s, b) => s + (b.spNet - b.hoNet), 0) * 1.084)
                    }
                  </span>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
