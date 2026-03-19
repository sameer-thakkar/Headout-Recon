import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  ChevronRight, ChevronDown, CheckCircle2, Search, TrendingUp, TrendingDown,
  Calculator, Check, Gavel, FileWarning, AlertTriangle, X as XIcon,
  BarChart3, PanelTopClose, PanelTop
} from "lucide-react";

interface TidData {
  tid: string; spNet: number; hoNet: number; discLc: number; discUsd: number;
  bidCount: number; fm: string; experience: string; hasPax: boolean;
  hoTakeRate: number; actualTakeRate: number; discPercent: string; soldAtLoss: boolean; lossUsd: number;
  startDate: string; endDate: string; bidCountWithDisc: number; bidCountInDuration: number;
}

const TIDS: TidData[] = [
  { tid: "TID-90234", spNet: 5_200, hoNet: 4_850, discLc: 350, discUsd: 379.40, bidCount: 6, fm: "Freesale", experience: "Sagrada Familia Guided Tour", hasPax: true, hoTakeRate: 18.5, actualTakeRate: 12.3, discPercent: "-6.2%", soldAtLoss: false, lossUsd: 0, startDate: "01/01/2026", endDate: "31/01/2026", bidCountWithDisc: 5, bidCountInDuration: 6 },
  { tid: "TID-90456", spNet: 18_400, hoNet: 12_300, discLc: 6_100, discUsd: 6_612.40, bidCount: 12, fm: "Freesale", experience: "Park Güell Skip-the-Line", hasPax: true, hoTakeRate: 20.0, actualTakeRate: -3.2, discPercent: "-23.2%", soldAtLoss: true, lossUsd: 2_450, startDate: "05/01/2026", endDate: "28/01/2026", bidCountWithDisc: 12, bidCountInDuration: 12 },
  { tid: "TID-90789", spNet: 8_900, hoNet: 3_900, discLc: 5_000.75, discUsd: 5_420.81, bidCount: 7, fm: "Manual", experience: "Casa Batlló Night Experience", hasPax: false, hoTakeRate: 15.0, actualTakeRate: 10.8, discPercent: "-4.2%", soldAtLoss: false, lossUsd: 0, startDate: "10/01/2026", endDate: "25/01/2026", bidCountWithDisc: 6, bidCountInDuration: 7 },
  { tid: "TID-91012", spNet: 3_100, hoNet: 2_100, discLc: 1_000, discUsd: 1_084, bidCount: 3, fm: "Freesale", experience: "Montserrat Day Trip", hasPax: false, hoTakeRate: 22.0, actualTakeRate: 18.5, discPercent: "-3.5%", soldAtLoss: false, lossUsd: 0, startDate: "15/01/2026", endDate: "20/01/2026", bidCountWithDisc: 3, bidCountInDuration: 3 },
];

const BOOKINGS = [
  { bookingId: "BID-1001", spNet: 850, hoNet: 800, date: "12/01/2026", pax: "1 Adult" },
  { bookingId: "BID-1002", spNet: 920, hoNet: 850, date: "15/01/2026", pax: "1 Adult" },
  { bookingId: "BID-1003", spNet: 1_100, hoNet: 1_050, date: "20/01/2026", pax: "1 Adult, 1 Child" },
  { bookingId: "BID-1004", spNet: 780, hoNet: 780, date: "25/01/2026", pax: "1 Adult" },
  { bookingId: "BID-1005", spNet: 850, hoNet: 670, date: "01/02/2026", pax: "2 Adults" },
  { bookingId: "BID-1006", spNet: 700, hoNet: 700, date: "10/02/2026", pax: "1 Adult" },
];

const PAX_ROWS = [
  { paxType: "Adult", dateRange: "12/01 - 28/01", count: 8, spUnit: 650, hoUnit: 600 },
  { paxType: "Adult", dateRange: "01/02 - 15/02", count: 4, spUnit: 680, hoUnit: 620 },
  { paxType: "Child", dateRange: "12/01 - 15/02", count: 3, spUnit: 420, hoUnit: 400 },
];

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function OptionA_ExpandActions() {
  const [expandedTid, setExpandedTid] = useState<string | null>(null);
  const [resolvedTids, setResolvedTids] = useState<Set<string>>(new Set());
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const [highlightedTid, setHighlightedTid] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [tidSearch, setTidSearch] = useState("");
  const [showPax, setShowPax] = useState<string | null>(null);
  const [showSpConfirm, setShowSpConfirm] = useState<string | null>(null);
  const [disputeChecked, setDisputeChecked] = useState(false);
  const [paxPrices, setPaxPrices] = useState<Record<string, string>>({});

  const flash = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 2500); };
  const resolve = (tid: string) => setResolvedTids(prev => new Set(prev).add(tid));

  const handleAnalysisClick = (tid: string) => {
    setHighlightedTid(tid);
    setExpandedTid(tid);
    setShowPax(null);
    setShowSpConfirm(null);
    setTimeout(() => {
      document.getElementById(`a-tid-${tid}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    setTimeout(() => setHighlightedTid(null), 3000);
  };

  const filteredTids = TIDS.filter(t => !tidSearch || t.tid.toLowerCase().includes(tidSearch.toLowerCase()) || t.experience.toLowerCase().includes(tidSearch.toLowerCase()));
  const resolvedCount = TIDS.filter(t => resolvedTids.has(t.tid)).length;
  const totalDisc = TIDS.reduce((s, t) => s + t.discUsd, 0);

  return (
    <div className="min-h-screen bg-background font-sans flex flex-col">
      <div className="border-b bg-card px-5 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Option A: Action Strip on Expand</span>
          <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">Recommended</Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Net Price Discrepancy</span>
          <Badge variant="secondary" className="text-xs">28 bookings</Badge>
          {resolvedCount > 0 && <Badge className="text-xs bg-green-100 text-green-700"><CheckCircle2 className="h-3 w-3 mr-1" />{resolvedCount}/{TIDS.length}</Badge>}
        </div>
      </div>

      {feedback && (
        <div className="mx-4 mt-2 px-3 py-2 bg-green-50 border border-green-200 rounded-md flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4" />{feedback}
        </div>
      )}

      <div className="flex-1 overflow-auto flex flex-col">
        {/* Analysis Panel */}
        <div className="flex-shrink-0 border-b">
          <div className="flex items-center justify-between px-4 py-2 bg-violet-50/70 border-b cursor-pointer hover:bg-violet-50" onClick={() => setAnalysisOpen(!analysisOpen)}>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-violet-600" />
              <span className="text-sm font-semibold text-violet-800">Discrepancy Analysis</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-violet-100 text-violet-700 border-violet-200">{TIDS.length} TIDs</Badge>
              <span className="text-[11px] text-violet-600">Click a row to jump to actions ↓</span>
            </div>
            {analysisOpen ? <PanelTopClose className="h-4 w-4 text-violet-500" /> : <PanelTop className="h-4 w-4 text-violet-500" />}
          </div>
          {analysisOpen && (
            <div className="max-h-[32vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="h-8 bg-violet-50/40">
                    <TableHead className="py-1.5 text-xs pl-4">TID</TableHead>
                    <TableHead className="py-1.5 text-xs text-right">Disc. USD</TableHead>
                    <TableHead className="py-1.5 text-xs">Fulfilment</TableHead>
                    <TableHead className="py-1.5 text-xs text-right">HO Rate</TableHead>
                    <TableHead className="py-1.5 text-xs text-right">Actual</TableHead>
                    <TableHead className="py-1.5 text-xs">Start</TableHead>
                    <TableHead className="py-1.5 text-xs">End</TableHead>
                    <TableHead className="py-1.5 text-xs text-right">Disc %</TableHead>
                    <TableHead className="py-1.5 text-xs text-right">BIDs w/ Disc</TableHead>
                    <TableHead className="py-1.5 text-xs text-right">BIDs Dur.</TableHead>
                    <TableHead className="py-1.5 text-xs text-center">Loss?</TableHead>
                    <TableHead className="py-1.5 text-xs text-right pr-4">Loss USD</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {TIDS.map(t => (
                    <TableRow key={t.tid} className="h-9 cursor-pointer hover:bg-violet-50/60" onClick={() => handleAnalysisClick(t.tid)}>
                      <TableCell className="py-1.5 pl-4 font-mono text-sm text-primary font-medium">{t.tid}</TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-sm text-red-600">{fmt(t.discUsd)}</TableCell>
                      <TableCell className="py-1.5 text-sm">{t.fm}</TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-sm">{t.hoTakeRate.toFixed(2)}%</TableCell>
                      <TableCell className={`py-1.5 text-right font-mono text-sm ${t.actualTakeRate < 0 ? "text-red-600 font-semibold" : ""}`}>{t.actualTakeRate.toFixed(2)}%</TableCell>
                      <TableCell className="py-1.5 text-sm">{t.startDate}</TableCell>
                      <TableCell className="py-1.5 text-sm">{t.endDate}</TableCell>
                      <TableCell className={`py-1.5 text-right font-mono text-sm ${t.discPercent.startsWith("-") ? "text-red-600" : ""}`}>{t.discPercent}</TableCell>
                      <TableCell className="py-1.5 text-right text-sm">{t.bidCountWithDisc}</TableCell>
                      <TableCell className="py-1.5 text-right text-sm">{t.bidCountInDuration}</TableCell>
                      <TableCell className="py-1.5 text-center"><Badge variant={t.soldAtLoss ? "destructive" : "secondary"} className="text-[10px] px-1.5 py-0">{t.soldAtLoss ? "Yes" : "No"}</Badge></TableCell>
                      <TableCell className={`py-1.5 text-right font-mono text-sm pr-4 ${t.lossUsd > 0 ? "text-red-600 font-semibold" : ""}`}>{t.lossUsd ? fmt(t.lossUsd) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Action Panel — clean rows, actions only on expand */}
        <div className="flex-1 overflow-auto p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Actions</span>
              <Badge variant="secondary" className="text-xs">{TIDS.length} TIDs</Badge>
            </div>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search TIDs..." className="h-8 pl-8 w-48 text-xs" value={tidSearch} onChange={e => setTidSearch(e.target.value)} />
            </div>
          </div>

          <div className="rounded-md border overflow-hidden">
            <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-0 items-center h-8 bg-muted/40 px-3 text-xs font-medium text-muted-foreground border-b">
              <div className="w-5" />
              <div className="pl-2">TID / Experience</div>
              <div className="text-right px-3 w-24">SP Net</div>
              <div className="text-right px-3 w-24">HO Net</div>
              <div className="text-right px-3 w-24">Disc.</div>
              <div className="text-center px-2 w-14 pr-3">BIDs</div>
            </div>

            {filteredTids.map(tid => {
              const isExpanded = expandedTid === tid.tid;
              const isResolved = resolvedTids.has(tid.tid);
              const isHighlighted = highlightedTid === tid.tid;
              const pct = ((tid.discUsd / totalDisc) * 100).toFixed(0);

              return (
                <div key={tid.tid} id={`a-tid-${tid.tid}`} className={`transition-all duration-500 ${isResolved ? "bg-green-50/40" : ""} ${isHighlighted ? "ring-2 ring-violet-400 ring-inset bg-violet-50/30" : ""}`}>
                  <div className={`grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-0 items-center px-3 h-11 cursor-pointer transition-colors hover:bg-muted/30 border-b ${isExpanded ? "bg-muted/20" : ""}`}
                    onClick={() => { setExpandedTid(isExpanded ? null : tid.tid); setShowPax(null); setShowSpConfirm(null); setDisputeChecked(false); }}>
                    <div className="w-5 flex items-center">
                      {isResolved ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div className="pl-2 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-sm font-medium text-primary">{tid.tid}</span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0">{tid.fm}</Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">{tid.experience}</div>
                    </div>
                    <div className="text-right px-3 w-24 font-mono text-sm">{fmt(tid.spNet)}</div>
                    <div className="text-right px-3 w-24 font-mono text-sm">{fmt(tid.hoNet)}</div>
                    <div className="text-right px-3 w-24">
                      <span className="font-mono text-sm text-red-600">{fmt(tid.discLc)}</span>
                      <span className="text-[10px] text-muted-foreground ml-0.5">({pct}%)</span>
                    </div>
                    <div className="text-center px-2 w-14 text-sm pr-3">{tid.bidCount}</div>
                  </div>

                  {isExpanded && (
                    <div className="border-b bg-muted/10 px-4 py-3 space-y-3">
                      {/* ★ ACTION STRIP — prominent, full-text buttons */}
                      {!showPax && !showSpConfirm && (
                        <div className="flex items-center gap-2 p-2 rounded-md bg-primary/5 border border-primary/10">
                          <Button size="sm" className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { setShowSpConfirm(tid.tid); setDisputeChecked(false); }}>
                            <TrendingUp className="h-3.5 w-3.5" /> Set SP Net
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-green-700 border-green-300 hover:bg-green-50" onClick={() => { flash(`${tid.tid} → HO Net applied`); resolve(tid.tid); setExpandedTid(null); }}>
                            <TrendingDown className="h-3.5 w-3.5" /> Set HO Net
                          </Button>
                          {tid.hasPax && (
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-violet-700 border-violet-300 hover:bg-violet-50" onClick={() => { setShowPax(tid.tid); setPaxPrices({}); }}>
                              <Calculator className="h-3.5 w-3.5" /> Pax Pricing
                            </Button>
                          )}
                          <div className="flex-1" />
                          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => flash(`Dispute raised for ${tid.tid}`)}>
                            <Gavel className="h-3.5 w-3.5" /> Dispute
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-orange-700 border-orange-300 hover:bg-orange-50" onClick={() => flash(`Issue logged for ${tid.tid}`)}>
                            <FileWarning className="h-3.5 w-3.5" /> Issue
                          </Button>
                        </div>
                      )}

                      {/* SP Net Confirm inline */}
                      {showSpConfirm === tid.tid && (
                        <div className="rounded-md border bg-blue-50/50 p-3 space-y-3">
                          <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
                            <TrendingUp className="h-4 w-4" /> Confirm: Set to SP Net
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="rounded border p-2 bg-white"><span className="text-muted-foreground">SP Net</span><div className="font-mono font-semibold text-blue-700">{fmt(tid.spNet)}</div></div>
                            <div className="rounded border p-2 bg-white"><span className="text-muted-foreground">HO Net</span><div className="font-mono font-semibold text-green-700">{fmt(tid.hoNet)}</div></div>
                            <div className="rounded border p-2 bg-white"><span className="text-muted-foreground">Difference</span><div className="font-mono font-semibold text-amber-600">+{fmt(tid.spNet - tid.hoNet)}</div></div>
                          </div>
                          <div className={`rounded border p-3 flex items-start gap-3 ${disputeChecked ? "border-amber-400 bg-amber-50" : "bg-white"}`}>
                            <AlertTriangle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${disputeChecked ? "text-amber-600" : "text-muted-foreground"}`} />
                            <div className="flex-1">
                              <div className="flex items-center justify-between"><span className="text-xs font-medium">Raise Dispute</span><Switch checked={disputeChecked} onCheckedChange={setDisputeChecked} /></div>
                              <p className="text-[11px] text-muted-foreground mt-0.5">Track <span className="font-mono font-medium text-amber-600">{fmt(tid.spNet - tid.hoNet)}</span> as dispute</p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowSpConfirm(null)}>Cancel</Button>
                            <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { flash(`${tid.tid} → SP Net applied`); resolve(tid.tid); setExpandedTid(null); setShowSpConfirm(null); }}>
                              <Check className="h-3 w-3" /> Confirm & Apply
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Pax Pricing inline */}
                      {showPax === tid.tid && (
                        <div className="rounded-md border bg-violet-50/30 p-3 space-y-2">
                          <div className="flex items-center gap-2 text-sm font-medium text-violet-800">
                            <Calculator className="h-4 w-4" /> Pax Pricing
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">Quick fill:</span>
                            <Button size="sm" variant="outline" className="h-5 text-[10px] px-2" onClick={() => { const p: Record<string, string> = {}; PAX_ROWS.forEach(r => p[`${r.paxType}__${r.dateRange}`] = String(r.spUnit)); setPaxPrices(p); }}>All SP</Button>
                            <Button size="sm" variant="outline" className="h-5 text-[10px] px-2" onClick={() => { const p: Record<string, string> = {}; PAX_ROWS.forEach(r => p[`${r.paxType}__${r.dateRange}`] = String(r.hoUnit)); setPaxPrices(p); }}>All HO</Button>
                          </div>
                          <Table>
                            <TableHeader><TableRow className="h-7"><TableHead className="text-xs py-1">Pax</TableHead><TableHead className="text-xs py-1">Dates</TableHead><TableHead className="text-xs py-1 text-right">Cnt</TableHead><TableHead className="text-xs py-1 text-right">SP</TableHead><TableHead className="text-xs py-1 text-right">HO</TableHead><TableHead className="text-xs py-1 text-right">Final</TableHead></TableRow></TableHeader>
                            <TableBody>
                              {PAX_ROWS.map(r => { const k = `${r.paxType}__${r.dateRange}`; return (
                                <TableRow key={k} className="h-8">
                                  <TableCell className="py-1 text-xs">{r.paxType}</TableCell>
                                  <TableCell className="py-1 text-xs text-muted-foreground">{r.dateRange}</TableCell>
                                  <TableCell className="py-1 text-xs text-right">{r.count}</TableCell>
                                  <TableCell className="py-1 text-xs text-right font-mono text-blue-600">{fmt(r.spUnit)}</TableCell>
                                  <TableCell className="py-1 text-xs text-right font-mono text-green-600">{fmt(r.hoUnit)}</TableCell>
                                  <TableCell className="py-1 text-right"><Input className="h-6 w-20 text-xs text-right font-mono ml-auto" value={paxPrices[k] || ""} onChange={e => setPaxPrices(p => ({ ...p, [k]: e.target.value }))} /></TableCell>
                                </TableRow>
                              ); })}
                            </TableBody>
                          </Table>
                          <div className="flex items-center justify-between">
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowPax(null)}>Cancel</Button>
                            <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { flash("Pax prices applied"); resolve(tid.tid); setExpandedTid(null); setShowPax(null); }}>
                              <Check className="h-3 w-3" /> Apply Pax Prices
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Bookings table */}
                      {!showPax && !showSpConfirm && (
                        <div className="rounded-md border overflow-hidden bg-background">
                          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center h-7 bg-muted/30 px-3 text-[11px] font-medium text-muted-foreground border-b">
                            <div>Booking ID</div><div className="text-right w-20 px-2">SP Net</div><div className="text-right w-20 px-2">HO Net</div><div className="w-20 px-2 text-right">Date</div><div className="w-16 px-2">Pax</div>
                          </div>
                          {BOOKINGS.map(b => (
                            <div key={b.bookingId} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-3 h-7 border-b last:border-0 text-xs hover:bg-muted/20">
                              <div className="font-mono text-primary">{b.bookingId}</div>
                              <div className="text-right w-20 px-2 font-mono text-blue-600">{fmt(b.spNet)}</div>
                              <div className="text-right w-20 px-2 font-mono text-green-600">{fmt(b.hoNet)}</div>
                              <div className="w-20 px-2 text-right text-muted-foreground">{b.date}</div>
                              <div className="w-16 px-2 text-muted-foreground">{b.pax}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="border-t bg-muted/30 px-5 py-2 flex items-center justify-between flex-shrink-0 text-xs">
        <span className="text-muted-foreground">{TIDS.length} TIDs · 28 bookings</span>
        <div className="flex items-center gap-4">
          <span><span className="text-muted-foreground mr-1">SP</span><span className="font-mono font-medium text-blue-700">{fmt(TIDS.reduce((s, t) => s + t.spNet, 0))}</span></span>
          <span><span className="text-muted-foreground mr-1">HO</span><span className="font-mono font-medium text-green-700">{fmt(TIDS.reduce((s, t) => s + t.hoNet, 0))}</span></span>
          <span><span className="text-muted-foreground mr-1">Disc.</span><span className="font-mono font-semibold text-red-600">{fmt(TIDS.reduce((s, t) => s + t.discLc, 0))}</span></span>
        </div>
      </div>
    </div>
  );
}
