import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronRight, ChevronDown, FileDown, ArrowLeft, ArrowRight,
  AlertTriangle, XCircle, CheckCircle2, Flag, Search, TrendingUp, TrendingDown,
  Calculator, Check, Gavel, FileWarning, Sparkles, Eye, X as XIcon
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
  { tid: "TID-90234", spNet: 5_200.00, hoNet: 4_850.00, discLc: 350.00, discUsd: 379.40, bidCount: 6, fm: "FMTC", experience: "Sagrada Familia Guided Tour" },
  { tid: "TID-90456", spNet: 18_400.00, hoNet: 12_300.00, discLc: 6_100.00, discUsd: 6_612.40, bidCount: 12, fm: "FMTC", experience: "Park Güell Skip-the-Line" },
  { tid: "TID-90789", spNet: 8_900.00, hoNet: 3_900.00, discLc: 5_000.75, discUsd: 5_420.81, bidCount: 7, fm: "FMTB", experience: "Casa Batlló Night Experience" },
  { tid: "TID-91012", spNet: 3_100.00, hoNet: 2_100.00, discLc: 1_000.00, discUsd: 1_084.00, bidCount: 3, fm: "FMTC", experience: "Montserrat Day Trip" },
];

const MOCK_PAX_ROWS = [
  { paxType: "Adult", dateRange: "12/01 - 28/01", count: 8, spUnit: 650.00, hoUnit: 600.00 },
  { paxType: "Adult", dateRange: "01/02 - 15/02", count: 4, spUnit: 680.00, hoUnit: 620.00 },
  { paxType: "Child", dateRange: "12/01 - 15/02", count: 3, spUnit: 420.00, hoUnit: 400.00 },
];

const MOCK_BOOKINGS = [
  { bookingId: "BID-1001", spNet: 850.00, hoNet: 800.00, selected: "sp" as const, amountPayable: 850.00, disputed: false, date: "12/01/2026", pax: "1 Adult" },
  { bookingId: "BID-1002", spNet: 920.00, hoNet: 850.00, selected: "ho" as const, amountPayable: 850.00, disputed: false, date: "15/01/2026", pax: "1 Adult" },
  { bookingId: "BID-1003", spNet: 1_100.00, hoNet: 1_050.00, selected: "sp" as const, amountPayable: 1_100.00, disputed: true, disputeAmt: 50.00, date: "20/01/2026", pax: "1 Adult, 1 Child" },
  { bookingId: "BID-1004", spNet: 780.00, hoNet: 780.00, selected: "ho" as const, amountPayable: 780.00, disputed: false, date: "25/01/2026", pax: "1 Adult" },
  { bookingId: "BID-1005", spNet: 850.00, hoNet: 670.00, selected: "ho" as const, amountPayable: 670.00, disputed: false, date: "01/02/2026", pax: "2 Adults" },
  { bookingId: "BID-1006", spNet: 700.00, hoNet: 700.00, selected: "ho" as const, amountPayable: 700.00, disputed: false, date: "10/02/2026", pax: "1 Adult" },
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

type ModalView =
  | { level: "closed" }
  | { level: "reason"; reason: string }
  | { level: "reason-spnet"; reason: string }
  | { level: "tid"; reason: string; tid: string; experience: string }
  | { level: "tid-spnet"; reason: string; tid: string; experience: string }
  | { level: "tid-pax"; reason: string; tid: string; experience: string }
  | { level: "bookings"; reason: string; tid: string; experience: string };

export function ActionModalWorkspace() {
  const [modalView, setModalView] = useState<ModalView>({ level: "closed" });
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [tidSearch, setTidSearch] = useState("");
  const [disputeChecked, setDisputeChecked] = useState(false);
  const [issueChecked, setIssueChecked] = useState(false);
  const [paxPrices, setPaxPrices] = useState<Record<string, string>>({
    "Adult__12/01 - 28/01": "650.00",
    "Adult__01/02 - 15/02": "680.00",
    "Child__12/01 - 15/02": "420.00",
  });

  const showFeedback = (msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(null), 2500);
  };

  const totalDiscUsd = MOCK_SUMMARY.reduce((s, r) => s + r.discUsd, 0);
  const totalCount = MOCK_SUMMARY.reduce((s, r) => s + r.count, 0);
  const isOpen = modalView.level !== "closed";

  const currentReason = modalView.level !== "closed" ? (modalView as any).reason : "";
  const currentTid = "tid" in (modalView as any) ? (modalView as any).tid : "";
  const currentExperience = "experience" in (modalView as any) ? (modalView as any).experience : "";

  const reasonData = MOCK_SUMMARY.find(r => r.reason === currentReason);
  const tidData = MOCK_TIDS.find(t => t.tid === currentTid);

  const filteredTids = MOCK_TIDS.filter(t =>
    !tidSearch || t.tid.toLowerCase().includes(tidSearch.toLowerCase()) || t.experience.toLowerCase().includes(tidSearch.toLowerCase())
  );

  const openReason = (reason: string) => {
    setDisputeChecked(false);
    setIssueChecked(false);
    setModalView({ level: "reason", reason });
  };

  const openTid = (tid: typeof MOCK_TIDS[0]) => {
    setDisputeChecked(false);
    setIssueChecked(false);
    setModalView({ level: "tid", reason: currentReason, tid: tid.tid, experience: tid.experience });
  };

  const goBack = () => {
    setDisputeChecked(false);
    setIssueChecked(false);
    if (modalView.level === "reason-spnet") setModalView({ level: "reason", reason: currentReason });
    else if (modalView.level === "tid-spnet" || modalView.level === "tid-pax" || modalView.level === "bookings")
      setModalView({ level: "tid", reason: currentReason, tid: currentTid, experience: currentExperience });
    else if (modalView.level === "tid")
      setModalView({ level: "reason", reason: currentReason });
    else setModalView({ level: "closed" });
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background font-sans relative">
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
                  <FileDown className="h-3.5 w-3.5 mr-1.5" />Export<ChevronDown className="h-3.5 w-3.5 ml-1" />
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
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Apply & Confirm
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
              <p className="font-mono font-semibold text-red-600">{fmt(totalDiscUsd)} USD</p>
            </div>
          </div>

          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="h-9 bg-muted/50">
                  <TableHead className="py-2 text-xs font-medium pl-4">Reason</TableHead>
                  <TableHead className="py-2 text-xs font-medium">Currency</TableHead>
                  <TableHead className="py-2 text-xs font-medium text-right">Disc. LC</TableHead>
                  <TableHead className="py-2 text-xs font-medium text-right">Disc. USD</TableHead>
                  <TableHead className="py-2 text-xs font-medium text-right">Count</TableHead>
                  <TableHead className="py-2 text-xs font-medium w-24 text-right pr-4">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MOCK_SUMMARY.map((row) => {
                  const isExpandable = row.type !== "reconciled";
                  const rowBg = row.type === "special-ar" ? "bg-amber-50/60" : row.type === "special-cancel" ? "bg-red-50/60" : row.type === "reconciled" ? "bg-green-50/40" : "";
                  return (
                    <TableRow key={row.reason} className={`h-10 relative transition-colors ${rowBg} ${isExpandable ? "cursor-pointer hover:bg-muted/40" : ""}`} onClick={() => isExpandable && openReason(row.reason)}>
                      <TableCell className="py-2 pl-4">
                        <SeverityBorder usd={row.discUsd} />
                        <span className={`text-sm font-medium flex items-center gap-1.5 ${row.type === "special-ar" ? "text-amber-700" : row.type === "special-cancel" ? "text-red-600" : row.type === "reconciled" ? "text-green-600" : "text-foreground"}`}>
                          {row.type === "special-ar" && <AlertTriangle className="h-3.5 w-3.5" />}
                          {row.type === "special-cancel" && <XCircle className="h-3.5 w-3.5" />}
                          {row.type === "reconciled" && <CheckCircle2 className="h-3.5 w-3.5" />}
                          {row.reason}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 text-sm">{row.currency}</TableCell>
                      <TableCell className={`py-2 text-right font-mono text-sm ${row.discLc > 0 ? "text-red-600" : row.discLc < 0 ? "text-red-500" : ""}`}>{fmt(row.discLc)}</TableCell>
                      <TableCell className={`py-2 text-right font-mono text-sm ${row.discUsd > 0 ? "text-red-600" : row.discUsd < 0 ? "text-red-500" : ""}`}>{fmt(row.discUsd)}</TableCell>
                      <TableCell className="py-2 text-right text-sm">{row.count}</TableCell>
                      <TableCell className="py-2 pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                        {isExpandable && (
                          <Button variant="outline" size="sm" className="h-7 px-3 text-xs" onClick={() => openReason(row.reason)}>
                            Manage <ChevronRight className="h-3.5 w-3.5 ml-1" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="border-t bg-muted/30 px-4 py-3 flex items-center justify-between text-sm">
              <div className="flex items-center gap-4"><span className="text-muted-foreground">Grand Total</span><Badge variant="secondary" className="text-xs">{totalCount} bookings</Badge></div>
              <div className="flex items-center gap-6">
                <div><span className="text-xs text-muted-foreground mr-2">LC</span><span className="font-mono font-semibold text-red-600">{fmt(MOCK_SUMMARY.reduce((s, r) => s + r.discLc, 0))}</span></div>
                <div><span className="text-xs text-muted-foreground mr-2">USD</span><span className="font-mono font-semibold text-red-600">{fmt(totalDiscUsd)}</span></div>
              </div>
            </div>
          </Card>
          <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5"><div className="w-3 h-2 bg-red-500 rounded-sm" /> &gt; 5,000</div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-2 bg-amber-500 rounded-sm" /> &gt; 1,000</div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-2 bg-blue-400 rounded-sm" /> &lt; 1,000</div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-2 bg-green-500 rounded-sm" /> Reconciled</div>
          </div>
        </div>

        {/* ══════ INLINE OVERLAY PANEL (replaces Dialog) ══════ */}
        {isOpen && (
          <div className="absolute inset-0 z-50 flex flex-col bg-background">
            {actionFeedback && (
              <div className="mx-4 mt-3 px-3 py-2 bg-green-50 border border-green-200 rounded-md flex items-center gap-2 text-sm text-green-700">
                <CheckCircle2 className="h-4 w-4" />{actionFeedback}
              </div>
            )}

            <div className="px-6 pt-5 pb-4 border-b flex-shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {modalView.level !== "reason" && (
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 -ml-1" onClick={goBack}>
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  )}
                  <nav className="flex items-center gap-1.5 text-sm flex-wrap">
                    <button className={`font-medium ${modalView.level !== "reason" && modalView.level !== "reason-spnet" ? "text-primary hover:underline cursor-pointer" : "text-foreground"}`}
                      onClick={() => { setDisputeChecked(false); setIssueChecked(false); setModalView({ level: "reason", reason: currentReason }); }}>
                      {currentReason}
                    </button>
                    {currentTid && (
                      <>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        <button className={`font-mono font-medium ${modalView.level === "bookings" || modalView.level === "tid-spnet" || modalView.level === "tid-pax" ? "text-primary hover:underline cursor-pointer" : "text-foreground"}`}
                          onClick={() => setModalView({ level: "tid", reason: currentReason, tid: currentTid, experience: currentExperience })}>
                          {currentTid}
                        </button>
                        {modalView.level === "tid-spnet" && <><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-foreground font-medium">Confirm SP Net</span></>}
                        {modalView.level === "tid-pax" && <><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-foreground font-medium">Pax Pricing</span></>}
                        {modalView.level === "bookings" && <><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-foreground font-medium">Bookings</span></>}
                      </>
                    )}
                    {modalView.level === "reason-spnet" && <><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-foreground font-medium">Confirm SP Net</span></>}
                  </nav>
                </div>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setModalView({ level: "closed" })}>
                  <XIcon className="h-4 w-4" />
                </Button>
              </div>

              {currentExperience && (modalView.level === "tid" || modalView.level === "tid-spnet" || modalView.level === "tid-pax" || modalView.level === "bookings") && (
                <p className="text-xs text-muted-foreground mt-1 ml-7">{currentExperience}</p>
              )}

              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  {reasonData && (modalView.level === "reason" || modalView.level === "reason-spnet") && (
                    <><Badge variant="secondary" className="text-xs">{reasonData.count} bookings</Badge><Badge variant="outline" className="text-xs font-mono">{reasonData.currency}</Badge></>
                  )}
                  {tidData && currentTid && (
                    <><Badge variant="outline" className="text-xs font-mono">{tidData.fm}</Badge><Badge variant="secondary" className="text-xs">{tidData.bidCount} bookings</Badge></>
                  )}
                </div>
                {modalView.level === "reason" && (
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input placeholder="Search TIDs or experiences..." className="h-8 pl-8 w-56 text-xs" value={tidSearch} onChange={(e) => setTidSearch(e.target.value)} />
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-auto">

              {/* ──── REASON LEVEL ──── */}
              {modalView.level === "reason" && (
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-2 px-1">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    <span className="text-xs text-muted-foreground">
                      Consistent margin gap: HO expected 18.2% take rate but actual is 12.8% — a 5.4pp shortfall across 4 TIDs.
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border p-3 cursor-pointer hover:bg-blue-50/80 transition-colors" onClick={() => setModalView({ level: "reason-spnet", reason: currentReason })}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="h-7 w-7 rounded-md bg-blue-100 flex items-center justify-center"><TrendingUp className="h-3.5 w-3.5 text-blue-600" /></div>
                        <span className="text-sm font-medium">Set all to SP Net</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Pay {fmt(MOCK_TIDS.reduce((s, t) => s + t.spNet, 0))} EUR</p>
                    </div>
                    <div className="rounded-md border p-3 cursor-pointer hover:bg-green-50/80 transition-colors" onClick={() => showFeedback(`All ${reasonData?.count} bookings set to HO Net`)}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="h-7 w-7 rounded-md bg-green-100 flex items-center justify-center"><TrendingDown className="h-3.5 w-3.5 text-green-600" /></div>
                        <span className="text-sm font-medium">Set all to HO Net</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Pay {fmt(MOCK_TIDS.reduce((s, t) => s + t.hoNet, 0))} EUR</p>
                    </div>
                    <div className="rounded-md border p-3 cursor-pointer hover:bg-amber-50/80 transition-colors" onClick={() => showFeedback("Dispute raised for all TIDs")}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="h-7 w-7 rounded-md bg-amber-100 flex items-center justify-center"><Gavel className="h-3.5 w-3.5 text-amber-600" /></div>
                        <span className="text-sm font-medium">Dispute All</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Disc: {fmt(Math.abs(reasonData?.discLc || 0))} EUR</p>
                    </div>
                  </div>

                  <div className="rounded-md border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="h-8 bg-muted/30">
                          <TableHead className="py-1.5 text-xs pl-4">TID</TableHead>
                          <TableHead className="py-1.5 text-xs">Experience</TableHead>
                          <TableHead className="py-1.5 text-xs text-right">SP Net</TableHead>
                          <TableHead className="py-1.5 text-xs text-right">HO Net</TableHead>
                          <TableHead className="py-1.5 text-xs text-right">Disc. LC</TableHead>
                          <TableHead className="py-1.5 text-xs text-right">BIDs</TableHead>
                          <TableHead className="py-1.5 text-xs w-20 text-right pr-4"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTids.map((tid) => {
                          const pct = ((tid.discUsd / (reasonData?.discUsd || 1)) * 100).toFixed(0);
                          return (
                            <TableRow key={tid.tid} className="h-10 cursor-pointer hover:bg-muted/40" onClick={() => openTid(tid)}>
                              <TableCell className="py-2 pl-4">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-sm font-medium text-primary">{tid.tid}</span>
                                  <Badge variant="outline" className="text-[10px] px-1 py-0">{tid.fm}</Badge>
                                </div>
                              </TableCell>
                              <TableCell className="py-2 text-xs text-muted-foreground truncate max-w-[200px]">{tid.experience}</TableCell>
                              <TableCell className="py-2 text-right font-mono text-sm">{fmt(tid.spNet)}</TableCell>
                              <TableCell className="py-2 text-right font-mono text-sm">{fmt(tid.hoNet)}</TableCell>
                              <TableCell className="py-2 text-right font-mono text-sm text-red-600">{fmt(tid.discLc)} <span className="text-[10px] text-muted-foreground font-sans">({pct}%)</span></TableCell>
                              <TableCell className="py-2 text-right text-sm">{tid.bidCount}</TableCell>
                              <TableCell className="py-2 pr-4 text-right">
                                <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]">Manage <ChevronRight className="h-3 w-3 ml-0.5" /></Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* ──── REASON SP NET CONFIRM ──── */}
              {modalView.level === "reason-spnet" && (
                <div className="p-4 space-y-3">
                  <div className="rounded-md border overflow-hidden">
                    <div className="px-4 py-3 border-b bg-blue-50">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-md bg-blue-100 flex items-center justify-center"><TrendingUp className="h-4 w-4 text-blue-600" /></div>
                        <div><div className="text-sm font-medium">Confirm: Set all {reasonData?.count} bookings to SP Net</div><div className="text-xs text-muted-foreground">Across {MOCK_TIDS.length} TIDs</div></div>
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-md border p-3 bg-blue-50/50"><div className="text-xs text-muted-foreground mb-1">SP Net Total (Paying)</div><div className="text-lg font-mono font-semibold text-blue-700">{fmt(MOCK_TIDS.reduce((s, t) => s + t.spNet, 0))} EUR</div></div>
                        <div className="rounded-md border p-3 bg-green-50/50"><div className="text-xs text-muted-foreground mb-1">HO Net Total</div><div className="text-lg font-mono font-semibold text-green-700">{fmt(MOCK_TIDS.reduce((s, t) => s + t.hoNet, 0))} EUR</div></div>
                        <div className="rounded-md border p-3 bg-muted/30"><div className="text-xs text-muted-foreground mb-1">Difference (SP − HO)</div><div className="text-lg font-mono font-semibold text-amber-600">+{fmt(MOCK_TIDS.reduce((s, t) => s + t.spNet - t.hoNet, 0))} EUR</div></div>
                      </div>
                    </div>
                  </div>

                  <div className={`rounded-md border-2 overflow-hidden transition-colors ${disputeChecked ? "border-amber-500 bg-amber-50/50" : "border-border"}`}>
                    <div className="px-4 py-4 flex items-start gap-4">
                      <div className={`h-10 w-10 rounded-md flex items-center justify-center flex-shrink-0 ${disputeChecked ? "bg-amber-100" : "bg-muted"}`}>
                        <AlertTriangle className={`h-5 w-5 ${disputeChecked ? "text-amber-600" : "text-muted-foreground"}`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-3 mb-1"><span className="text-sm font-semibold">Raise Dispute</span><Switch checked={disputeChecked} onCheckedChange={setDisputeChecked} /></div>
                        <p className="text-xs text-muted-foreground">This is SP error and refund to be claimed</p>
                        <p className="text-xs text-muted-foreground mt-1">Paying SP Net now. The difference of <span className="font-mono font-semibold text-amber-600">{fmt(Math.abs(MOCK_TIDS.reduce((s, t) => s + t.spNet - t.hoNet, 0)))} EUR</span> will be tracked as a dispute.</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-md bg-orange-100 flex items-center justify-center"><FileWarning className="h-4 w-4 text-orange-600" /></div>
                      <div><div className="text-sm font-medium">Raise Issue</div><div className="text-xs text-muted-foreground">This is HO error — to be checked with internal teams</div></div>
                    </div>
                    <Checkbox checked={issueChecked} onCheckedChange={(c) => setIssueChecked(!!c)} className="h-5 w-5" />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <Button variant="ghost" size="sm" onClick={goBack}><ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back</Button>
                    <Button size="sm" onClick={() => { showFeedback(`All ${reasonData?.count} bookings updated to SP Net`); setModalView({ level: "reason", reason: currentReason }); }}>
                      <Check className="h-3.5 w-3.5 mr-1.5" /> Confirm & Apply SP Net
                    </Button>
                  </div>
                </div>
              )}

              {/* ──── TID LEVEL: Action cards ──── */}
              {modalView.level === "tid" && tidData && (
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-md border p-2.5 bg-blue-50/50"><span className="text-muted-foreground">SP Net Total:</span> <span className="font-mono font-semibold text-blue-700">{fmt(tidData.spNet)} EUR</span></div>
                    <div className="rounded-md border p-2.5 bg-green-50/50"><span className="text-muted-foreground">HO Net Total:</span> <span className="font-mono font-semibold text-green-700">{fmt(tidData.hoNet)} EUR</span></div>
                  </div>

                  <div className="space-y-2">
                    <div className="rounded-md border overflow-hidden cursor-pointer hover:bg-blue-50/60 transition-colors" onClick={() => setModalView({ level: "tid-spnet", reason: currentReason, tid: currentTid, experience: currentExperience })}>
                      <div className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-md bg-blue-100 flex items-center justify-center"><TrendingUp className="h-4 w-4 text-blue-600" /></div>
                          <div><div className="text-sm font-medium">Update to SP Net</div><div className="text-xs text-muted-foreground">Set Amount Payable = SP Net for all {tidData.bidCount} bookings ({fmt(tidData.spNet)} EUR)</div></div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>

                    <div className="rounded-md border overflow-hidden cursor-pointer hover:bg-green-50/60 transition-colors" onClick={() => showFeedback(`${currentTid}: All set to HO Net`)}>
                      <div className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-md bg-green-100 flex items-center justify-center"><TrendingDown className="h-4 w-4 text-green-600" /></div>
                          <div><div className="text-sm font-medium">Update to HO Net</div><div className="text-xs text-muted-foreground">Set Amount Payable = HO Net for all {tidData.bidCount} bookings ({fmt(tidData.hoNet)} EUR)</div></div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>

                    <div className="rounded-md border overflow-hidden cursor-pointer hover:bg-violet-50/60 transition-colors" onClick={() => setModalView({ level: "tid-pax", reason: currentReason, tid: currentTid, experience: currentExperience })}>
                      <div className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-md bg-violet-100 flex items-center justify-center"><Calculator className="h-4 w-4 text-violet-600" /></div>
                          <div><div className="text-sm font-medium">Update based on Pax Type</div><div className="text-xs text-muted-foreground">Enter final unit price per pax type to recalculate</div></div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>

                    <div className="rounded-md border overflow-hidden cursor-pointer hover:bg-muted/40 transition-colors" onClick={() => setModalView({ level: "bookings", reason: currentReason, tid: currentTid, experience: currentExperience })}>
                      <div className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center"><Eye className="h-4 w-4 text-muted-foreground" /></div>
                          <div><div className="text-sm font-medium">View & Edit Individual Bookings</div><div className="text-xs text-muted-foreground">Set net, dispute, or flag issues per booking</div></div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ──── TID SP NET CONFIRM ──── */}
              {modalView.level === "tid-spnet" && tidData && (
                <div className="p-4 space-y-3">
                  <div className="rounded-md border overflow-hidden">
                    <div className="px-4 py-3 border-b bg-blue-50">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-md bg-blue-100 flex items-center justify-center"><TrendingUp className="h-4 w-4 text-blue-600" /></div>
                        <div><div className="text-sm font-medium">Confirm: Update to SP Net</div><div className="text-xs text-muted-foreground">{tidData.bidCount} bookings in {currentTid}</div></div>
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-md border p-3 bg-blue-50/50"><div className="text-xs text-muted-foreground mb-1">SP Net (Paying)</div><div className="text-lg font-mono font-semibold text-blue-700">{fmt(tidData.spNet)}</div></div>
                        <div className="rounded-md border p-3 bg-green-50/50"><div className="text-xs text-muted-foreground mb-1">HO Net</div><div className="text-lg font-mono font-semibold text-green-700">{fmt(tidData.hoNet)}</div></div>
                        <div className="rounded-md border p-3 bg-muted/30"><div className="text-xs text-muted-foreground mb-1">Difference</div><div className="text-lg font-mono font-semibold text-amber-600">+{fmt(tidData.spNet - tidData.hoNet)}</div></div>
                      </div>
                    </div>
                  </div>

                  <div className={`rounded-md border-2 transition-colors ${disputeChecked ? "border-amber-500 bg-amber-50/50" : "border-border"}`}>
                    <div className="px-4 py-4 flex items-start gap-4">
                      <div className={`h-10 w-10 rounded-md flex items-center justify-center flex-shrink-0 ${disputeChecked ? "bg-amber-100" : "bg-muted"}`}>
                        <AlertTriangle className={`h-5 w-5 ${disputeChecked ? "text-amber-600" : "text-muted-foreground"}`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1"><span className="text-sm font-semibold">Raise Dispute</span><Switch checked={disputeChecked} onCheckedChange={setDisputeChecked} /></div>
                        <p className="text-xs text-muted-foreground">Difference of <span className="font-mono font-semibold text-amber-600">{fmt(tidData.spNet - tidData.hoNet)} EUR</span> tracked as dispute</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-md bg-orange-100 flex items-center justify-center"><FileWarning className="h-4 w-4 text-orange-600" /></div>
                      <div><div className="text-sm font-medium">Raise Issue</div><div className="text-xs text-muted-foreground">HO error — check with internal teams</div></div>
                    </div>
                    <Checkbox checked={issueChecked} onCheckedChange={(c) => setIssueChecked(!!c)} className="h-5 w-5" />
                  </div>

                  <div className="flex justify-between pt-1">
                    <Button variant="ghost" size="sm" onClick={goBack}><ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back</Button>
                    <Button size="sm" onClick={() => { showFeedback(`${currentTid}: Updated to SP Net`); setModalView({ level: "tid", reason: currentReason, tid: currentTid, experience: currentExperience }); }}>
                      <Check className="h-3.5 w-3.5 mr-1.5" /> Confirm & Apply
                    </Button>
                  </div>
                </div>
              )}

              {/* ──── TID PAX PRICING ──── */}
              {modalView.level === "tid-pax" && tidData && (
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-md border p-2 bg-blue-50"><span className="text-muted-foreground">SP Net Total:</span> <span className="font-mono font-semibold text-blue-700">{fmt(tidData.spNet)} EUR</span></div>
                    <div className="rounded-md border p-2 bg-green-50"><span className="text-muted-foreground">HO Net Total:</span> <span className="font-mono font-semibold text-green-700">{fmt(tidData.hoNet)} EUR</span></div>
                  </div>

                  <div className="text-xs text-muted-foreground">Grouped by: <span className="font-medium text-foreground">Experience Date</span></div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Quick fill all:</span>
                    <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => {
                      const p: Record<string, string> = {};
                      MOCK_PAX_ROWS.forEach(r => { p[`${r.paxType}__${r.dateRange}`] = String(r.spUnit); });
                      setPaxPrices(p);
                    }}>All SP</Button>
                    <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => {
                      const p: Record<string, string> = {};
                      MOCK_PAX_ROWS.forEach(r => { p[`${r.paxType}__${r.dateRange}`] = String(r.hoUnit); });
                      setPaxPrices(p);
                    }}>All HO</Button>
                  </div>

                  <div className="rounded-md border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="h-8 bg-muted/30">
                          <TableHead className="py-1.5 text-xs pl-4">Pax Type</TableHead>
                          <TableHead className="py-1.5 text-xs">Date Range</TableHead>
                          <TableHead className="py-1.5 text-xs text-right">Count</TableHead>
                          <TableHead className="py-1.5 text-xs text-right">SP Unit</TableHead>
                          <TableHead className="py-1.5 text-xs text-right">HO Unit</TableHead>
                          <TableHead className="py-1.5 text-xs text-right pr-4">Final Price</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {MOCK_PAX_ROWS.map((row) => {
                          const key = `${row.paxType}__${row.dateRange}`;
                          return (
                            <TableRow key={key} className="h-9">
                              <TableCell className="py-1.5 pl-4 text-sm font-medium">{row.paxType}</TableCell>
                              <TableCell className="py-1.5 text-xs text-muted-foreground">{row.dateRange}</TableCell>
                              <TableCell className="py-1.5 text-right text-sm">{row.count}</TableCell>
                              <TableCell className="py-1.5 text-right font-mono text-sm text-blue-600">{fmt(row.spUnit)}</TableCell>
                              <TableCell className="py-1.5 text-right font-mono text-sm text-green-600">{fmt(row.hoUnit)}</TableCell>
                              <TableCell className="py-1.5 text-right pr-4">
                                <Input className="h-7 w-24 text-xs text-right font-mono ml-auto border-dashed" value={paxPrices[key] || ""} onChange={(e) => setPaxPrices(prev => ({ ...prev, [key]: e.target.value }))} />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="flex justify-between pt-1">
                    <Button variant="ghost" size="sm" onClick={goBack}><ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back</Button>
                    <Button size="sm" onClick={() => { showFeedback("Pax-based prices applied"); setModalView({ level: "tid", reason: currentReason, tid: currentTid, experience: currentExperience }); }}>
                      <Check className="h-3.5 w-3.5 mr-1.5" /> Apply Pax Prices
                    </Button>
                  </div>
                </div>
              )}

              {/* ──── BOOKING LEVEL ──── */}
              {modalView.level === "bookings" && (
                <div className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="h-9 bg-muted/30 sticky top-0">
                        <TableHead className="py-2 text-xs pl-6">Booking ID</TableHead>
                        <TableHead className="py-2 text-xs">Pax</TableHead>
                        <TableHead className="py-2 text-xs">Date</TableHead>
                        <TableHead className="py-2 text-xs text-right">SP Net</TableHead>
                        <TableHead className="py-2 text-xs text-right">HO Net</TableHead>
                        <TableHead className="py-2 text-xs text-center w-20">Net</TableHead>
                        <TableHead className="py-2 text-xs text-center">Dispute</TableHead>
                        <TableHead className="py-2 text-xs text-right">Amt Payable</TableHead>
                        <TableHead className="py-2 text-xs text-right pr-6">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {MOCK_BOOKINGS.map((b) => (
                        <TableRow key={b.bookingId} className="h-11 hover:bg-muted/30">
                          <TableCell className="py-2 pl-6 font-mono text-sm text-primary font-medium">{b.bookingId}</TableCell>
                          <TableCell className="py-2 text-xs text-muted-foreground">{b.pax}</TableCell>
                          <TableCell className="py-2 text-xs text-muted-foreground">{b.date}</TableCell>
                          <TableCell className="py-2 text-right font-mono text-sm">{fmt(b.spNet)}</TableCell>
                          <TableCell className="py-2 text-right font-mono text-sm">{fmt(b.hoNet)}</TableCell>
                          <TableCell className="py-2 text-center">
                            <div className="inline-flex rounded-md border overflow-hidden">
                              <button className={`px-2.5 py-0.5 text-xs font-medium transition-colors ${b.selected === "sp" ? "bg-blue-600 text-white" : "bg-background text-muted-foreground hover:bg-muted"}`}>SP</button>
                              <button className={`px-2.5 py-0.5 text-xs font-medium transition-colors border-l ${b.selected === "ho" ? "bg-emerald-600 text-white" : "bg-background text-muted-foreground hover:bg-muted"}`}>HO</button>
                            </div>
                          </TableCell>
                          <TableCell className="py-2 text-center">
                            {b.disputed ? (
                              <Badge variant="destructive" className="text-[11px] px-2 py-0.5"><Gavel className="h-3 w-3 mr-1" />{fmt(b.disputeAmt || 0)}</Badge>
                            ) : (
                              <Checkbox className="h-4 w-4" />
                            )}
                          </TableCell>
                          <TableCell className="py-2 text-right">
                            <Input className="h-7 w-24 text-xs text-right font-mono ml-auto border-dashed" defaultValue={b.amountPayable} />
                          </TableCell>
                          <TableCell className="py-2 pr-6 text-right">
                            <Button variant="outline" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-violet-600"><Flag className="h-3 w-3 mr-1" />Issue</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div className="border-t bg-muted/30 px-6 py-3 flex items-center justify-between flex-shrink-0">
              <div className="text-xs text-muted-foreground">
                {modalView.level === "reason" && `${filteredTids.length} TIDs · ${reasonData?.count} bookings`}
                {(modalView.level === "tid" || modalView.level === "tid-spnet" || modalView.level === "tid-pax") && `${tidData?.bidCount} bookings in ${currentTid}`}
                {modalView.level === "bookings" && `${MOCK_BOOKINGS.length} bookings`}
              </div>
              <div className="flex items-center gap-4 text-sm">
                <div><span className="text-xs text-muted-foreground mr-2">SP Total</span><span className="font-mono font-medium text-blue-700">{fmt(tidData?.spNet || MOCK_TIDS.reduce((s, t) => s + t.spNet, 0))}</span></div>
                <div><span className="text-xs text-muted-foreground mr-2">HO Total</span><span className="font-mono font-medium text-green-700">{fmt(tidData?.hoNet || MOCK_TIDS.reduce((s, t) => s + t.hoNet, 0))}</span></div>
                <div><span className="text-xs text-muted-foreground mr-2">Disc.</span><span className="font-mono font-semibold text-red-600">{fmt(tidData?.discLc || (reasonData?.discLc || 0))}</span></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
