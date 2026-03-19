import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  ChevronRight, ChevronDown, CheckCircle2, Search, TrendingUp, TrendingDown,
  Calculator, Gavel, FileWarning, MoreHorizontal, X as XIcon,
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

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function ContextMenu({ tid, onAction, onClose, position }: { tid: TidData; onAction: (action: string) => void; onClose: () => void; position: { x: number; y: number } }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const items = [
    { icon: <TrendingUp className="h-3.5 w-3.5 text-blue-600" />, label: "Set SP Net", desc: `Pay ${fmt(tid.spNet)}`, action: "sp" },
    { icon: <TrendingDown className="h-3.5 w-3.5 text-green-600" />, label: "Set HO Net", desc: `Pay ${fmt(tid.hoNet)}`, action: "ho" },
    ...(tid.hasPax ? [{ icon: <Calculator className="h-3.5 w-3.5 text-violet-600" />, label: "Pax Pricing", desc: "Set per-pax unit prices", action: "pax" }] : []),
    { icon: <Gavel className="h-3.5 w-3.5 text-amber-600" />, label: "Raise Dispute", desc: "Track as SP error", action: "dispute" },
    { icon: <FileWarning className="h-3.5 w-3.5 text-orange-600" />, label: "Log Issue", desc: "Report as HO error", action: "issue" },
  ];

  return (
    <div ref={ref} className="absolute z-[100] bg-white border rounded-lg shadow-xl py-1 w-56 animate-in fade-in zoom-in-95 duration-100"
      style={{ left: Math.min(position.x, window.innerWidth - 240), top: Math.min(position.y, window.innerHeight - 300) }}>
      <div className="px-3 py-2 border-b">
        <div className="font-mono text-xs font-medium text-primary">{tid.tid}</div>
        <div className="text-[11px] text-muted-foreground truncate">{tid.experience}</div>
      </div>
      {items.map(item => (
        <button key={item.action} className="w-full px-3 py-2 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left" onClick={() => { onAction(item.action); onClose(); }}>
          <div className="flex-shrink-0">{item.icon}</div>
          <div>
            <div className="text-sm font-medium">{item.label}</div>
            <div className="text-[11px] text-muted-foreground">{item.desc}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

export function OptionB_ContextMenu() {
  const [expandedTid, setExpandedTid] = useState<string | null>(null);
  const [resolvedTids, setResolvedTids] = useState<Set<string>>(new Set());
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const [highlightedTid, setHighlightedTid] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [tidSearch, setTidSearch] = useState("");
  const [contextMenu, setContextMenu] = useState<{ tid: TidData; pos: { x: number; y: number } } | null>(null);

  const flash = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 2500); };
  const resolve = (tid: string) => setResolvedTids(prev => new Set(prev).add(tid));
  const totalDisc = TIDS.reduce((s, t) => s + t.discUsd, 0);

  const handleAnalysisClick = (tid: string) => {
    setHighlightedTid(tid);
    setExpandedTid(tid);
    setTimeout(() => document.getElementById(`b-tid-${tid}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    setTimeout(() => setHighlightedTid(null), 3000);
  };

  const handleContextMenu = (e: React.MouseEvent, tid: TidData) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ tid, pos: { x: e.clientX, y: e.clientY } });
  };

  const handleThreeDot = (e: React.MouseEvent, tid: TidData) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({ tid, pos: { x: rect.left, y: rect.bottom + 4 } });
  };

  const handleAction = (action: string, tid: TidData) => {
    if (action === "sp") { flash(`${tid.tid} → SP Net applied`); resolve(tid.tid); }
    else if (action === "ho") { flash(`${tid.tid} → HO Net applied`); resolve(tid.tid); }
    else if (action === "dispute") flash(`Dispute raised for ${tid.tid}`);
    else if (action === "issue") flash(`Issue logged for ${tid.tid}`);
    else if (action === "pax") flash(`Pax pricing opened for ${tid.tid}`);
  };

  const filteredTids = TIDS.filter(t => !tidSearch || t.tid.toLowerCase().includes(tidSearch.toLowerCase()) || t.experience.toLowerCase().includes(tidSearch.toLowerCase()));
  const resolvedCount = TIDS.filter(t => resolvedTids.has(t.tid)).length;

  return (
    <div className="min-h-screen bg-background font-sans flex flex-col relative">
      <div className="border-b bg-card px-5 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Option B: Context Menu / Three-Dot</span>
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

        {/* Action Panel — clean rows with three-dot menu */}
        <div className="flex-1 overflow-auto p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Actions</span>
              <Badge variant="secondary" className="text-xs">{TIDS.length} TIDs</Badge>
              <span className="text-[11px] text-muted-foreground">Right-click or use ⋯ menu for actions</span>
            </div>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search TIDs..." className="h-8 pl-8 w-48 text-xs" value={tidSearch} onChange={e => setTidSearch(e.target.value)} />
            </div>
          </div>

          <div className="rounded-md border overflow-hidden">
            <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] gap-0 items-center h-8 bg-muted/40 px-3 text-xs font-medium text-muted-foreground border-b">
              <div className="w-5" />
              <div className="pl-2">TID / Experience</div>
              <div className="text-right px-3 w-24">SP Net</div>
              <div className="text-right px-3 w-24">HO Net</div>
              <div className="text-right px-3 w-24">Disc.</div>
              <div className="text-center px-2 w-14">BIDs</div>
              <div className="w-8" />
            </div>

            {filteredTids.map(tid => {
              const isExpanded = expandedTid === tid.tid;
              const isResolved = resolvedTids.has(tid.tid);
              const isHighlighted = highlightedTid === tid.tid;
              const pct = ((tid.discUsd / totalDisc) * 100).toFixed(0);

              return (
                <div key={tid.tid} id={`b-tid-${tid.tid}`}
                  className={`transition-all duration-500 ${isResolved ? "bg-green-50/40" : ""} ${isHighlighted ? "ring-2 ring-violet-400 ring-inset bg-violet-50/30" : ""}`}
                  onContextMenu={e => handleContextMenu(e, tid)}>
                  <div className={`grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] gap-0 items-center px-3 h-11 cursor-pointer transition-colors hover:bg-muted/30 border-b ${isExpanded ? "bg-muted/20" : ""}`}
                    onClick={() => setExpandedTid(isExpanded ? null : tid.tid)}>
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
                    <div className="text-center px-2 w-14 text-sm">{tid.bidCount}</div>
                    <div className="w-8 flex justify-center" onClick={e => handleThreeDot(e, tid)}>
                      <div className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-muted cursor-pointer">
                        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-b bg-muted/10 px-4 py-3">
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
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          tid={contextMenu.tid}
          position={contextMenu.pos}
          onAction={action => handleAction(action, contextMenu.tid)}
          onClose={() => setContextMenu(null)}
        />
      )}

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
