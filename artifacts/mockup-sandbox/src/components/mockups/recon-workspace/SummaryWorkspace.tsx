import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import {
  ChevronRight, ChevronDown, MoreHorizontal, FileDown, ExternalLink,
  AlertTriangle, XCircle, CheckCircle2, ArrowUpDown, Flag,
  DollarSign, Scale, Pencil, Check, X, Gavel, MessageSquare
} from "lucide-react";

const MOCK_SUMMARY = [
  { reason: "Already Reconciled", currency: "EUR", discLc: 0, discUsd: 0, count: 42, type: "special-ar" },
  { reason: "Cancellations", currency: "EUR", discLc: -3_240.50, discUsd: -3_510.20, count: 15, type: "special-cancel" },
  { reason: "Net Price Discrepancy", currency: "EUR", discLc: 12_450.75, discUsd: 13_488.31, count: 28, type: "regular" },
  { reason: "Multiple Tickets Booked", currency: "EUR", discLc: 4_320.00, discUsd: 4_682.64, count: 8, type: "regular" },
  { reason: "Negative SP - Partial Refund", currency: "EUR", discLc: -1_120.00, discUsd: -1_214.08, count: 5, type: "regular" },
  { reason: "Reconciled", currency: "EUR", discLc: 0, discUsd: 0, count: 312, type: "reconciled" },
];

const MOCK_TIDS: Record<string, Array<{
  tid: string; spNet: number; hoNet: number; discLc: number; discUsd: number; bidCount: number; fm: string;
}>> = {
  "Net Price Discrepancy": [
    { tid: "TID-90234", spNet: 5_200.00, hoNet: 4_850.00, discLc: 350.00, discUsd: 379.40, bidCount: 6, fm: "FMTC" },
    { tid: "TID-90456", spNet: 18_400.00, hoNet: 12_300.00, discLc: 6_100.00, discUsd: 6_612.40, bidCount: 12, fm: "FMTC" },
    { tid: "TID-90789", spNet: 8_900.00, hoNet: 3_900.00, discLc: 5_000.75, discUsd: 5_420.81, bidCount: 7, fm: "FMTB" },
    { tid: "TID-91012", spNet: 3_100.00, hoNet: 2_100.00, discLc: 1_000.00, discUsd: 1_084.00, bidCount: 3, fm: "FMTC" },
  ],
  "Multiple Tickets Booked": [
    { tid: "TID-80100", spNet: 2_400.00, hoNet: 1_200.00, discLc: 1_200.00, discUsd: 1_300.80, bidCount: 4, fm: "FMTC" },
    { tid: "TID-80201", spNet: 5_600.00, hoNet: 2_480.00, discLc: 3_120.00, discUsd: 3_382.08, bidCount: 4, fm: "FMTB" },
  ],
};

const MOCK_BOOKINGS: Record<string, Array<{
  bookingId: string; spNet: number; hoNet: number; selected: "SP" | "HO"; amountPayable: number; disputed: boolean; disputeAmt?: number;
}>> = {
  "TID-90234": [
    { bookingId: "BID-1001", spNet: 850.00, hoNet: 800.00, selected: "HO", amountPayable: 800.00, disputed: false },
    { bookingId: "BID-1002", spNet: 920.00, hoNet: 850.00, selected: "HO", amountPayable: 850.00, disputed: false },
    { bookingId: "BID-1003", spNet: 1_100.00, hoNet: 1_050.00, selected: "SP", amountPayable: 1_100.00, disputed: true, disputeAmt: 50.00 },
    { bookingId: "BID-1004", spNet: 780.00, hoNet: 780.00, selected: "HO", amountPayable: 780.00, disputed: false },
    { bookingId: "BID-1005", spNet: 850.00, hoNet: 670.00, selected: "HO", amountPayable: 670.00, disputed: false },
    { bookingId: "BID-1006", spNet: 700.00, hoNet: 700.00, selected: "HO", amountPayable: 700.00, disputed: false },
  ],
  "TID-90456": [
    { bookingId: "BID-2001", spNet: 1_500.00, hoNet: 1_020.00, selected: "SP", amountPayable: 1_500.00, disputed: true, disputeAmt: 480.00 },
    { bookingId: "BID-2002", spNet: 1_800.00, hoNet: 1_100.00, selected: "HO", amountPayable: 1_100.00, disputed: false },
    { bookingId: "BID-2003", spNet: 2_200.00, hoNet: 1_450.00, selected: "HO", amountPayable: 1_450.00, disputed: false },
  ],
};

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

export function SummaryWorkspace() {
  const [expandedReason, setExpandedReason] = useState<string | null>("Net Price Discrepancy");
  const [expandedTid, setExpandedTid] = useState<string | null>("TID-90234");
  const [editingBooking, setEditingBooking] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const toggleReason = (reason: string) => {
    setExpandedReason(prev => prev === reason ? null : reason);
    setExpandedTid(null);
  };

  const toggleTid = (tid: string) => {
    setExpandedTid(prev => prev === tid ? null : tid);
  };

  const showFeedback = (msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(null), 2000);
  };

  const totalDiscUsd = MOCK_SUMMARY.reduce((s, r) => s + r.discUsd, 0);
  const totalCount = MOCK_SUMMARY.reduce((s, r) => s + r.count, 0);

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
                <DropdownMenuItem>Excel (.xlsx) — Discrepancy Analysis</DropdownMenuItem>
                <DropdownMenuItem>Google Sheets — Discrepancy Analysis</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Excel (.xlsx) — Financial Report</DropdownMenuItem>
                <DropdownMenuItem>Google Sheets — Financial Report</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white">
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Apply & Confirm
            </Button>
          </div>
        </div>

        {actionFeedback && (
          <div className="mx-6 mt-3 px-3 py-2 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded-md flex items-center gap-2 text-sm text-green-700 dark:text-green-300 animate-in fade-in slide-in-from-top-1 duration-200">
            <CheckCircle2 className="h-4 w-4" />
            {actionFeedback}
          </div>
        )}

        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold">Overall Reconciliation Summary</h2>
              <Badge variant="secondary" className="text-xs">{totalCount} bookings</Badge>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="text-right">
                <span className="text-xs text-muted-foreground">Total Discrepancy</span>
                <p className={`font-mono font-semibold ${totalDiscUsd > 0 ? "text-red-600" : "text-green-600"}`}>
                  {fmt(totalDiscUsd)} USD
                </p>
              </div>
            </div>
          </div>

          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="h-9 bg-muted/50">
                  <TableHead className="w-8 py-2"></TableHead>
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
                  const isExpanded = expandedReason === row.reason;
                  const isExpandable = row.type !== "reconciled";
                  const tids = MOCK_TIDS[row.reason];
                  const rowBg = row.type === "special-ar"
                    ? "bg-amber-50/60 dark:bg-amber-950/20"
                    : row.type === "special-cancel"
                      ? "bg-red-50/60 dark:bg-red-950/20"
                      : row.type === "reconciled"
                        ? "bg-green-50/40 dark:bg-green-950/20"
                        : "";

                  return (
                    <Collapsible key={row.reason} open={isExpanded} asChild>
                      <>
                        <CollapsibleTrigger asChild disabled={!isExpandable}>
                          <TableRow
                            className={`h-10 relative cursor-pointer transition-colors hover:bg-muted/40 ${rowBg} ${isExpanded ? "border-b-0" : ""}`}
                            onClick={() => isExpandable && toggleReason(row.reason)}
                          >
                            <TableCell className="py-2 pl-3 w-8">
                              <SeverityBorder usd={row.discUsd} />
                              {isExpandable && (
                                isExpanded
                                  ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                  : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </TableCell>
                            <TableCell className="py-2">
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
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem>
                                      <ExternalLink className="h-3.5 w-3.5 mr-2" />
                                      View analysis
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </TableCell>
                          </TableRow>
                        </CollapsibleTrigger>

                        <CollapsibleContent asChild>
                          <>
                            {tids && tids.map((tid) => {
                              const isTidExpanded = expandedTid === tid.tid;
                              const bookings = MOCK_BOOKINGS[tid.tid];

                              return (
                                <Collapsible key={tid.tid} open={isTidExpanded} asChild>
                                  <>
                                    <CollapsibleTrigger asChild>
                                      <TableRow
                                        className="h-9 bg-muted/20 hover:bg-muted/40 cursor-pointer border-b border-dashed"
                                        onClick={() => toggleTid(tid.tid)}
                                      >
                                        <TableCell className="py-1.5 pl-8">
                                          {isTidExpanded
                                            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                          }
                                        </TableCell>
                                        <TableCell className="py-1.5" colSpan={1}>
                                          <div className="flex items-center gap-2">
                                            <span className="text-xs font-mono font-medium text-primary">{tid.tid}</span>
                                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{tid.fm}</Badge>
                                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{tid.bidCount} BIDs</Badge>
                                          </div>
                                        </TableCell>
                                        <TableCell className="py-1.5 text-xs text-muted-foreground">
                                          SP: <span className="font-mono">{fmt(tid.spNet)}</span>
                                        </TableCell>
                                        <TableCell className="py-1.5 text-right font-mono text-xs text-red-600">
                                          {fmt(tid.discLc)}
                                        </TableCell>
                                        <TableCell className="py-1.5 text-right font-mono text-xs text-red-600">
                                          {fmt(tid.discUsd)}
                                        </TableCell>
                                        <TableCell className="py-1.5 text-right text-xs">{tid.bidCount}</TableCell>
                                        <TableCell className="py-1.5 pr-3" onClick={(e) => e.stopPropagation()}>
                                          <div className="flex items-center gap-0.5 justify-end">
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => showFeedback(`${tid.tid}: Set to SP Net`)}>
                                                  <span className="text-[10px] font-bold text-blue-600">SP</span>
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>Set all to SP Net</TooltipContent>
                                            </Tooltip>
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => showFeedback(`${tid.tid}: Set to HO Net`)}>
                                                  <span className="text-[10px] font-bold text-emerald-600">HO</span>
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>Set all to HO Net</TooltipContent>
                                            </Tooltip>
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => showFeedback(`Dispute raised for ${tid.tid}`)}>
                                                  <Gavel className="h-3 w-3 text-amber-600" />
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>Dispute</TooltipContent>
                                            </Tooltip>
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => showFeedback(`Issue flagged for ${tid.tid}`)}>
                                                  <Flag className="h-3 w-3 text-violet-600" />
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>Flag issue</TooltipContent>
                                            </Tooltip>
                                            <DropdownMenu>
                                              <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                                </Button>
                                              </DropdownMenuTrigger>
                                              <DropdownMenuContent align="end" className="w-48">
                                                <DropdownMenuItem>Manage Pax Pricing</DropdownMenuItem>
                                                <DropdownMenuItem>Correct Vendor ID</DropdownMenuItem>
                                                <DropdownMenuItem>View Analysis</DropdownMenuItem>
                                              </DropdownMenuContent>
                                            </DropdownMenu>
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                    </CollapsibleTrigger>

                                    <CollapsibleContent asChild>
                                      <>
                                        <TableRow className="h-7 bg-muted/10">
                                          <TableCell className="py-0"></TableCell>
                                          <TableCell colSpan={6} className="py-0 px-0">
                                            <div className="ml-12 mr-3 border-l-2 border-primary/20 pl-3">
                                              <Table>
                                                <TableHeader>
                                                  <TableRow className="h-7">
                                                    <TableHead className="py-1 text-[10px] font-medium w-24">Booking ID</TableHead>
                                                    <TableHead className="py-1 text-[10px] font-medium text-right w-24">SP Net</TableHead>
                                                    <TableHead className="py-1 text-[10px] font-medium text-right w-24">HO Net</TableHead>
                                                    <TableHead className="py-1 text-[10px] font-medium text-center w-16">Selected</TableHead>
                                                    <TableHead className="py-1 text-[10px] font-medium text-right w-28">Amount Payable</TableHead>
                                                    <TableHead className="py-1 text-[10px] font-medium text-center w-20">Dispute</TableHead>
                                                    <TableHead className="py-1 text-[10px] font-medium w-24"></TableHead>
                                                  </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                  {bookings && bookings.map((b) => (
                                                    <TableRow key={b.bookingId} className="h-8 hover:bg-muted/30">
                                                      <TableCell className="py-1 font-mono text-xs text-primary">{b.bookingId}</TableCell>
                                                      <TableCell className="py-1 text-right font-mono text-xs">{fmt(b.spNet)}</TableCell>
                                                      <TableCell className="py-1 text-right font-mono text-xs">{fmt(b.hoNet)}</TableCell>
                                                      <TableCell className="py-1 text-center">
                                                        <div className="flex items-center justify-center gap-0.5">
                                                          <Button
                                                            variant={b.selected === "SP" ? "default" : "outline"}
                                                            size="sm"
                                                            className="h-5 px-1.5 text-[10px] rounded-r-none"
                                                          >
                                                            SP
                                                          </Button>
                                                          <Button
                                                            variant={b.selected === "HO" ? "default" : "outline"}
                                                            size="sm"
                                                            className="h-5 px-1.5 text-[10px] rounded-l-none"
                                                          >
                                                            HO
                                                          </Button>
                                                        </div>
                                                      </TableCell>
                                                      <TableCell className="py-1 text-right">
                                                        {editingBooking === b.bookingId ? (
                                                          <div className="flex items-center gap-1 justify-end">
                                                            <Input
                                                              className="h-6 w-20 text-xs text-right font-mono"
                                                              defaultValue={b.amountPayable}
                                                            />
                                                            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => { setEditingBooking(null); showFeedback("Price updated"); }}>
                                                              <Check className="h-3 w-3 text-green-600" />
                                                            </Button>
                                                            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setEditingBooking(null)}>
                                                              <X className="h-3 w-3 text-red-500" />
                                                            </Button>
                                                          </div>
                                                        ) : (
                                                          <div className="flex items-center gap-1 justify-end group">
                                                            <span className="font-mono text-xs">{fmt(b.amountPayable)}</span>
                                                            <Button
                                                              variant="ghost" size="sm"
                                                              className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                                              onClick={() => setEditingBooking(b.bookingId)}
                                                            >
                                                              <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
                                                            </Button>
                                                          </div>
                                                        )}
                                                      </TableCell>
                                                      <TableCell className="py-1 text-center">
                                                        {b.disputed ? (
                                                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                                            {fmt(b.disputeAmt || 0)}
                                                          </Badge>
                                                        ) : (
                                                          <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-amber-600">
                                                            <Gavel className="h-2.5 w-2.5" />
                                                          </Button>
                                                        )}
                                                      </TableCell>
                                                      <TableCell className="py-1">
                                                        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-violet-600">
                                                          <Flag className="h-2.5 w-2.5 mr-0.5" />
                                                          Issue
                                                        </Button>
                                                      </TableCell>
                                                    </TableRow>
                                                  ))}
                                                  {!bookings && (
                                                    <TableRow>
                                                      <TableCell colSpan={7} className="text-center py-4 text-xs text-muted-foreground">
                                                        Click to load booking details
                                                      </TableCell>
                                                    </TableRow>
                                                  )}
                                                </TableBody>
                                              </Table>
                                            </div>
                                          </TableCell>
                                        </TableRow>
                                      </>
                                    </CollapsibleContent>
                                  </>
                                </Collapsible>
                              );
                            })}

                            {!tids && (
                              <TableRow>
                                <TableCell></TableCell>
                                <TableCell colSpan={6} className="py-4">
                                  <div className="ml-6 text-xs text-muted-foreground italic">
                                    Loading TID breakdown...
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </>
                        </CollapsibleContent>
                      </>
                    </Collapsible>
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
                  <div className="text-right">
                    <span className="text-xs text-muted-foreground mr-2">LC</span>
                    <span className="font-mono font-semibold text-red-600">{fmt(MOCK_SUMMARY.reduce((s, r) => s + r.discLc, 0))}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-muted-foreground mr-2">USD</span>
                    <span className="font-mono font-semibold text-red-600">{fmt(totalDiscUsd)}</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-2 bg-red-500 rounded-sm" /> &gt; 5,000 USD
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-2 bg-amber-500 rounded-sm" /> &gt; 1,000 USD
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-2 bg-blue-400 rounded-sm" /> &lt; 1,000 USD
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-2 bg-green-500 rounded-sm" /> Reconciled
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
