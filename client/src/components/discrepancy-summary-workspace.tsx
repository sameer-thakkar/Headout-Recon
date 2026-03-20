import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ChevronRight, ChevronDown, CheckCircle2, Search, TrendingUp, TrendingDown,
  Check, Gavel, FileWarning, AlertTriangle, X as XIcon,
  BarChart3, PanelTopClose, PanelTop, CheckCheck, Calculator, Loader2
} from "lucide-react";
import type { DiscrepancyAnalysisRow, PrimaryRow } from "@shared/schema";

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const strValue = String(value);
  const numValue = Number(strValue);
  if (!isNaN(numValue) && numValue > 1000 && numValue < 100000) {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + numValue * 24 * 60 * 60 * 1000);
    return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  }
  const dateStr = strValue.split("T")[0];
  const [year, month, day] = dateStr.split("-");
  if (year && month && day && year.length === 4) return `${day}/${month}/${year}`;
  return strValue;
}

interface TidGroup {
  tid: string;
  bookings: PrimaryRow[];
  spNet: number;
  hoNet: number;
  discLc: number;
  discUsd: number;
  bidCount: number;
}

interface DiscrepancySummaryWorkspaceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: string | null;
  runId: string | null;
  primaryRows: PrimaryRow[];
  secondaryVendorRows: PrimaryRow[];
  unmappedRows: PrimaryRow[];
  analysisRows: DiscrepancyAnalysisRow[];
  isLoadingAnalysis: boolean;
}

export function DiscrepancySummaryWorkspace({
  open,
  onOpenChange,
  reason,
  runId,
  primaryRows,
  secondaryVendorRows,
  unmappedRows,
  analysisRows,
  isLoadingAnalysis,
}: DiscrepancySummaryWorkspaceProps) {
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const [expandedTid, setExpandedTid] = useState<string | null>(null);
  const [resolvedTids, setResolvedTids] = useState<Set<string>>(new Set());
  const [highlightedTid, setHighlightedTid] = useState<string | null>(null);
  const [tidSearch, setTidSearch] = useState("");
  const [selectedTids, setSelectedTids] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<string | null>(null);
  const [bulkScope, setBulkScope] = useState<"all" | "selected">("all");

  const isMTB = reason === "Multiple Tickets Booked";
  const isNPD = reason === "Net Price Discrepancy";

  const filteredAnalysis = useMemo(() => {
    if (!analysisRows || !reason) return [];
    const filtered = analysisRows.filter(row => row.reason === reason);
    if (isNPD) return [...filtered].sort((a, b) => (a.discrepancyUsd ?? 0) - (b.discrepancyUsd ?? 0));
    return filtered;
  }, [analysisRows, reason, isNPD]);

  const allRows = useMemo(() => [...primaryRows, ...secondaryVendorRows, ...unmappedRows], [primaryRows, secondaryVendorRows, unmappedRows]);

  const tidGroups = useMemo((): TidGroup[] => {
    if (!reason) return [];
    const reasonRows = allRows.filter(r => r.reason === reason);
    const tidMap = new Map<string, PrimaryRow[]>();
    for (const r of reasonRows) {
      const tid = r.tid || r.bookingId;
      if (!tidMap.has(tid)) tidMap.set(tid, []);
      tidMap.get(tid)!.push(r);
    }
    return Array.from(tidMap.entries()).map(([tid, bookings]) => {
      const spNet = bookings.reduce((s, b) => s + (b.spNetInHo || 0), 0);
      const hoNet = bookings.reduce((s, b) => s + (b.hoNet || 0), 0);
      return {
        tid,
        bookings,
        spNet: Math.round(spNet * 100) / 100,
        hoNet: Math.round(hoNet * 100) / 100,
        discLc: Math.round((hoNet - spNet) * 100) / 100,
        discUsd: 0,
        bidCount: bookings.length,
      };
    }).sort((a, b) => Math.abs(b.discLc) - Math.abs(a.discLc));
  }, [allRows, reason]);

  const flash = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 2500); };
  const resolve = (tid: string) => setResolvedTids(prev => new Set(prev).add(tid));
  const resolveMultiple = (tids: string[]) => setResolvedTids(prev => { const next = new Set(prev); tids.forEach(t => next.add(t)); return next; });

  const toggleSelect = (tid: string) => {
    setSelectedTids(prev => { const next = new Set(prev); if (next.has(tid)) next.delete(tid); else next.add(tid); return next; });
  };

  const filteredTids = tidGroups.filter(t =>
    !tidSearch || t.tid.toLowerCase().includes(tidSearch.toLowerCase()) ||
    t.bookings.some(b => b.bookingId?.toLowerCase().includes(tidSearch.toLowerCase()))
  );

  const toggleSelectAll = () => {
    const unresolved = filteredTids.filter(t => !resolvedTids.has(t.tid));
    if (selectedTids.size === unresolved.length) setSelectedTids(new Set());
    else setSelectedTids(new Set(unresolved.map(t => t.tid)));
  };

  const handleAnalysisClick = (tid: string) => {
    setHighlightedTid(tid);
    setExpandedTid(tid);
    setTimeout(() => {
      document.getElementById(`ws-tid-${tid}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    setTimeout(() => setHighlightedTid(null), 3000);
  };

  const getBulkTids = () => bulkScope === "all" ? tidGroups.map(t => t.tid) : Array.from(selectedTids);
  const getBulkTidData = () => bulkScope === "all" ? tidGroups : tidGroups.filter(t => selectedTids.has(t.tid));

  const handleBulkAction = (action: string) => {
    const tids = getBulkTids();
    if (action === "ho" || action === "sp") {
      resolveMultiple(tids);
      flash(`${tids.length} TIDs → ${action === "sp" ? "SP" : "HO"} Net applied`);
    } else if (action === "dispute") {
      flash(`Dispute raised for ${tids.length} TIDs`);
    } else if (action === "issue") {
      flash(`Issue logged for ${tids.length} TIDs`);
    }
    setSelectedTids(new Set());
    setBulkConfirm(null);
  };

  const openDiscrepancyAction = (action: string) => { setBulkScope("all"); setBulkConfirm(action); };
  const openSelectionAction = (action: string) => { setBulkScope("selected"); setBulkConfirm(action); };

  const totalDisc = tidGroups.reduce((s, t) => s + Math.abs(t.discLc), 0);
  const resolvedCount = tidGroups.filter(t => resolvedTids.has(t.tid)).length;

  if (!reason) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v) {
        setExpandedTid(null);
        setAnalysisOpen(true);
        setResolvedTids(new Set());
        setSelectedTids(new Set());
        setBulkConfirm(null);
        setTidSearch("");
        setFeedback(null);
      }
      onOpenChange(v);
    }}>
      <DialogContent className="max-w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0" data-testid="discrepancy-workspace">
        <div className="border-b px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{reason}</span>
            <Badge variant="secondary" className="text-xs">{tidGroups.reduce((s, t) => s + t.bidCount, 0)} bookings</Badge>
            <Badge variant="outline" className="text-xs">{tidGroups.length} TIDs</Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {resolvedCount > 0 && (
              <Badge className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                <CheckCircle2 className="h-3 w-3 mr-1" />{resolvedCount}/{tidGroups.length}
              </Badge>
            )}
          </div>
        </div>

        {feedback && (
          <div className="mx-4 mt-2 px-3 py-2 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md flex items-center gap-2 text-sm text-green-700 dark:text-green-300 animate-in fade-in duration-200">
            <CheckCircle2 className="h-4 w-4" />{feedback}
          </div>
        )}

        <div className="flex-1 overflow-auto flex flex-col min-h-0">
          <div className="flex-shrink-0 border-b">
            <div
              className="flex items-center justify-between px-4 py-2 bg-violet-50/70 dark:bg-violet-950/30 border-b cursor-pointer hover:bg-violet-50 dark:hover:bg-violet-950/50"
              onClick={() => setAnalysisOpen(!analysisOpen)}
              data-testid="analysis-panel-toggle"
            >
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                <span className="text-sm font-semibold text-violet-800 dark:text-violet-300">Discrepancy Analysis</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700">
                  {filteredAnalysis.length} TIDs
                </Badge>
                <span className="text-[11px] text-violet-600 dark:text-violet-400">Click a row to jump to actions ↓</span>
              </div>
              {analysisOpen ? <PanelTopClose className="h-4 w-4 text-violet-500" /> : <PanelTop className="h-4 w-4 text-violet-500" />}
            </div>
            {analysisOpen && (
              <div className="max-h-[32vh] overflow-auto">
                {isLoadingAnalysis ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />Loading analysis...
                  </div>
                ) : filteredAnalysis.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                    No analysis data available
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="h-8 bg-violet-50/40 dark:bg-violet-950/20">
                        <TableHead className="py-1.5 text-xs pl-4">TID</TableHead>
                        <TableHead className="py-1.5 text-xs text-right">Disc. USD</TableHead>
                        <TableHead className="py-1.5 text-xs">Fulfilment</TableHead>
                        {isMTB && (
                          <>
                            <TableHead className="py-1.5 text-xs">Times Charged</TableHead>
                            <TableHead className="py-1.5 text-xs text-right">BID Count</TableHead>
                            <TableHead className="py-1.5 text-xs text-right">BID Count Dur.</TableHead>
                            <TableHead className="py-1.5 text-xs">DRI Team</TableHead>
                          </>
                        )}
                        {isNPD && (
                          <>
                            <TableHead className="py-1.5 text-xs text-right">HO Rate</TableHead>
                            <TableHead className="py-1.5 text-xs text-right">Actual</TableHead>
                            <TableHead className="py-1.5 text-xs text-right">Disc %</TableHead>
                            <TableHead className="py-1.5 text-xs text-center">Loss?</TableHead>
                            <TableHead className="py-1.5 text-xs text-right">Loss USD</TableHead>
                          </>
                        )}
                        <TableHead className="py-1.5 text-xs">Start</TableHead>
                        <TableHead className="py-1.5 text-xs">End</TableHead>
                        <TableHead className="py-1.5 text-xs text-right">BIDs w/ Disc</TableHead>
                        <TableHead className="py-1.5 text-xs text-right pr-4">BIDs Dur.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAnalysis.map((row, i) => (
                        <TableRow
                          key={`${row.tid}-${i}`}
                          className={`h-9 cursor-pointer hover:bg-violet-50/60 dark:hover:bg-violet-950/40 ${resolvedTids.has(row.tid) ? "opacity-50" : ""}`}
                          onClick={() => handleAnalysisClick(row.tid)}
                          data-testid={`analysis-row-${row.tid}`}
                        >
                          <TableCell className="py-1.5 pl-4 font-mono text-sm text-primary font-medium">
                            <div className="flex items-center gap-1.5">
                              {resolvedTids.has(row.tid) && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />}
                              {row.tid}
                            </div>
                          </TableCell>
                          <TableCell className="py-1.5 text-right font-mono text-sm text-red-600 dark:text-red-400">{fmt(row.discrepancyUsd)}</TableCell>
                          <TableCell className="py-1.5 text-sm">{row.fulfillmentMethod}</TableCell>
                          {isMTB && (
                            <>
                              <TableCell className="py-1.5 text-sm">{row.timesCharged}</TableCell>
                              <TableCell className="py-1.5 text-right text-sm">{row.countBidWithDiscrepancy}</TableCell>
                              <TableCell className="py-1.5 text-right text-sm">{row.countBidsInDuration}</TableCell>
                              <TableCell className="py-1.5 text-sm">{row.driTeam}</TableCell>
                            </>
                          )}
                          {isNPD && (
                            <>
                              <TableCell className="py-1.5 text-right font-mono text-sm">{row.hoTakeRatePercent?.toFixed(2) ?? "—"}%</TableCell>
                              <TableCell className={`py-1.5 text-right font-mono text-sm ${(row.actualTakeRatePercent ?? 0) < 0 ? "text-red-600 dark:text-red-400 font-semibold" : ""}`}>
                                {row.actualTakeRatePercent?.toFixed(2) ?? "—"}%
                              </TableCell>
                              <TableCell className={`py-1.5 text-right font-mono text-sm ${row.discrepancyPercentRange?.startsWith("-") ? "text-red-600 dark:text-red-400" : ""}`}>
                                {row.discrepancyPercentRange || "—"}
                              </TableCell>
                              <TableCell className="py-1.5 text-center">
                                <Badge variant={row.soldAtLoss === "Yes" ? "destructive" : "secondary"} className="text-[10px] px-1.5 py-0">
                                  {row.soldAtLoss || "—"}
                                </Badge>
                              </TableCell>
                              <TableCell className={`py-1.5 text-right font-mono text-sm ${(row.lossUsd ?? 0) > 0 ? "text-red-600 dark:text-red-400 font-semibold" : ""}`}>
                                {row.lossUsd != null ? fmt(row.lossUsd) : "—"}
                              </TableCell>
                            </>
                          )}
                          <TableCell className="py-1.5 text-sm">{formatDate(row.startDate)}</TableCell>
                          <TableCell className="py-1.5 text-sm">{formatDate(row.endDate)}</TableCell>
                          <TableCell className="py-1.5 text-right text-sm">{row.countBidWithDiscrepancy}</TableCell>
                          <TableCell className="py-1.5 text-right text-sm pr-4">{row.countBidsInDuration}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto px-4 pb-4 pt-2 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Actions</span>
                <Badge variant="secondary" className="text-xs">{tidGroups.length} TIDs</Badge>
              </div>
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search TIDs / BIDs..." className="h-8 pl-8 w-48 text-xs" value={tidSearch} onChange={e => setTidSearch(e.target.value)} data-testid="workspace-tid-search" />
              </div>
            </div>

            {!bulkConfirm && (
              <div className="rounded-lg border bg-muted/30 dark:bg-muted/10 px-3 py-2.5 flex items-center gap-2.5">
                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">All {tidGroups.length} TIDs:</span>
                <div className="h-4 w-px bg-border" />
                <Button size="sm" className="h-7 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => openDiscrepancyAction("sp")} data-testid="bulk-sp-net">
                  <TrendingUp className="h-3 w-3" /> SP Net
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700 hover:bg-green-50 dark:hover:bg-green-950/30" onClick={() => openDiscrepancyAction("ho")} data-testid="bulk-ho-net">
                  <TrendingDown className="h-3 w-3" /> HO Net
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30" onClick={() => openDiscrepancyAction("dispute")} data-testid="bulk-dispute">
                  <Gavel className="h-3 w-3" /> Raise Dispute
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/30" onClick={() => openDiscrepancyAction("issue")} data-testid="bulk-issue">
                  <FileWarning className="h-3 w-3" /> Log Issue
                </Button>
              </div>
            )}

            {selectedTids.size >= 2 && !bulkConfirm && (
              <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3 flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex items-center gap-2">
                  <CheckCheck className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">{selectedTids.size} TIDs selected</span>
                </div>
                <div className="h-5 w-px bg-border" />
                <Button size="sm" className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => openSelectionAction("sp")}>
                  <TrendingUp className="h-3 w-3" /> SP Net
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-green-700 border-green-300 hover:bg-green-50" onClick={() => openSelectionAction("ho")}>
                  <TrendingDown className="h-3 w-3" /> HO Net
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => openSelectionAction("dispute")}>
                  <Gavel className="h-3 w-3" /> Dispute
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-orange-700 border-orange-300 hover:bg-orange-50" onClick={() => openSelectionAction("issue")}>
                  <FileWarning className="h-3 w-3" /> Issue
                </Button>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedTids(new Set())}>
                  <XIcon className="h-3 w-3 mr-1" /> Clear
                </Button>
              </div>
            )}

            {bulkConfirm && (bulkConfirm === "sp" || bulkConfirm === "ho") && (() => {
              const selData = getBulkTidData();
              const isSp = bulkConfirm === "sp";
              const totalPayable = selData.reduce((s, t) => s + (isSp ? t.spNet : t.hoNet), 0);
              const totalSp = selData.reduce((s, t) => s + t.spNet, 0);
              const totalHo = selData.reduce((s, t) => s + t.hoNet, 0);
              const totalDiff = isSp ? totalSp - totalHo : 0;
              return (
                <div className="rounded-lg border-2 border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/30 p-3 space-y-3 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-blue-800 dark:text-blue-300">
                      {isSp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                      Bulk {isSp ? "SP Net" : "HO Net"} — {bulkScope === "all" ? `All ${selData.length} TIDs` : `${selData.length} selected TIDs`}
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setBulkConfirm(null)}>
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="rounded-md border overflow-hidden bg-white dark:bg-card max-h-48 overflow-y-auto">
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center h-7 bg-muted/30 px-3 text-[11px] font-medium text-muted-foreground border-b sticky top-0">
                      <div>TID</div>
                      <div className="text-right w-24 px-2 text-blue-600">SP Net</div>
                      <div className="text-right w-24 px-2 text-green-600">HO Net</div>
                      <div className="text-right w-24 px-2">Disc. LC</div>
                      <div className="text-right w-28 px-2 font-semibold text-foreground">Payable</div>
                    </div>
                    {selData.map(t => (
                      <div key={t.tid} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-3 h-8 border-b last:border-0 text-xs">
                        <div>
                          <span className="font-mono font-medium text-primary">{t.tid}</span>
                          <span className="text-muted-foreground ml-1.5 text-[10px]">{t.bidCount} BIDs</span>
                        </div>
                        <div className={`text-right w-24 px-2 font-mono ${isSp ? "font-semibold text-blue-700 dark:text-blue-400" : "text-muted-foreground"}`}>{fmt(t.spNet)}</div>
                        <div className={`text-right w-24 px-2 font-mono ${!isSp ? "font-semibold text-green-700 dark:text-green-400" : "text-muted-foreground"}`}>{fmt(t.hoNet)}</div>
                        <div className="text-right w-24 px-2 font-mono text-red-500">{fmt(Math.abs(t.discLc))}</div>
                        <div className={`text-right w-28 px-2 font-mono font-semibold ${isSp ? "text-blue-700 dark:text-blue-400" : "text-green-700 dark:text-green-400"}`}>{fmt(isSp ? t.spNet : t.hoNet)}</div>
                      </div>
                    ))}
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-3 h-8 bg-muted/30 border-t text-xs font-semibold sticky bottom-0">
                      <div className="text-muted-foreground">Total ({selData.length} TIDs)</div>
                      <div className="text-right w-24 px-2 font-mono text-blue-600">{fmt(totalSp)}</div>
                      <div className="text-right w-24 px-2 font-mono text-green-600">{fmt(totalHo)}</div>
                      <div className="text-right w-24 px-2 font-mono text-red-500">{fmt(selData.reduce((s, t) => s + Math.abs(t.discLc), 0))}</div>
                      <div className={`text-right w-28 px-2 font-mono text-sm ${isSp ? "text-blue-700" : "text-green-700"}`}>{fmt(totalPayable)}</div>
                    </div>
                  </div>
                  {isSp && totalDiff > 0 && (
                    <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                      <span className="text-amber-800 dark:text-amber-300">Paying <span className="font-mono font-semibold">{fmt(totalDiff)}</span> above HO Net — consider raising disputes.</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBulkConfirm(null)}>Cancel</Button>
                    <Button size="sm" className={`h-7 text-xs gap-1 ${isSp ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}`} variant={isSp ? "default" : "outline"} onClick={() => handleBulkAction(bulkConfirm)} data-testid="bulk-confirm-apply">
                      <Check className="h-3 w-3" /> Apply {isSp ? "SP Net" : "HO Net"} to {selData.length} TIDs
                    </Button>
                  </div>
                </div>
              );
            })()}

            {bulkConfirm && bulkConfirm !== "sp" && bulkConfirm !== "ho" && (() => {
              const confirmData = getBulkTidData();
              return (
                <div className="rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/30 p-3 space-y-2 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="h-4 w-4" />
                      {bulkConfirm === "dispute" ? "Raise Dispute" : "Log Issue"} for {bulkScope === "all" ? `all ${confirmData.length}` : `${confirmData.length} selected`} TIDs
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setBulkConfirm(null)}>
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {confirmData.map(t => <Badge key={t.tid} variant="outline" className="text-xs font-mono">{t.tid}</Badge>)}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBulkConfirm(null)}>Cancel</Button>
                    <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleBulkAction(bulkConfirm)} data-testid="bulk-confirm-apply-other">
                      <Check className="h-3 w-3" /> Confirm & Apply
                    </Button>
                  </div>
                </div>
              );
            })()}

            {tidGroups.length === 0 && !isLoadingAnalysis && (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No TID-level actions available for this reason
              </div>
            )}

            {filteredTids.length > 0 && (
              <div className="rounded-md border overflow-hidden">
                <div className="grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] gap-0 items-center h-8 bg-muted/40 px-3 text-xs font-medium text-muted-foreground border-b">
                  <div className="w-7 flex items-center justify-center" onClick={e => { e.stopPropagation(); toggleSelectAll(); }}>
                    <Checkbox checked={selectedTids.size > 0 && selectedTids.size === filteredTids.filter(t => !resolvedTids.has(t.tid)).length} className="h-3.5 w-3.5" />
                  </div>
                  <div className="w-5" />
                  <div className="pl-2">TID</div>
                  <div className="text-right px-3 w-24">SP Net</div>
                  <div className="text-right px-3 w-24">HO Net</div>
                  <div className="text-right px-3 w-24">Disc.</div>
                  <div className="text-center px-2 w-14 pr-3">BIDs</div>
                </div>

                {filteredTids.map(tid => {
                  const isExpanded = expandedTid === tid.tid;
                  const isResolved = resolvedTids.has(tid.tid);
                  const isHighlighted = highlightedTid === tid.tid;
                  const isSelected = selectedTids.has(tid.tid);
                  const pct = totalDisc > 0 ? ((Math.abs(tid.discLc) / totalDisc) * 100).toFixed(0) : "0";

                  return (
                    <div key={tid.tid} id={`ws-tid-${tid.tid}`} className={`transition-all duration-500 ${isResolved ? "bg-green-50/40 dark:bg-green-950/10" : ""} ${isHighlighted ? "ring-2 ring-violet-400 ring-inset bg-violet-50/30 dark:bg-violet-950/20" : ""} ${isSelected && !isResolved ? "bg-primary/5" : ""}`} data-testid={`action-tid-${tid.tid}`}>
                      <div
                        className={`grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] gap-0 items-center px-3 h-11 cursor-pointer transition-colors hover:bg-muted/30 border-b ${isExpanded ? "bg-muted/20" : ""}`}
                        onClick={() => setExpandedTid(isExpanded ? null : tid.tid)}
                      >
                        <div className="w-7 flex items-center justify-center" onClick={e => { e.stopPropagation(); if (!isResolved) toggleSelect(tid.tid); }}>
                          {!isResolved && <Checkbox checked={isSelected} className="h-3.5 w-3.5" />}
                        </div>
                        <div className="w-5 flex items-center">
                          {isResolved ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </div>
                        <div className="pl-2 min-w-0">
                          <span className="font-mono text-sm font-medium text-primary">{tid.tid}</span>
                        </div>
                        <div className="text-right px-3 w-24 font-mono text-sm">{fmt(tid.spNet)}</div>
                        <div className="text-right px-3 w-24 font-mono text-sm">{fmt(tid.hoNet)}</div>
                        <div className="text-right px-3 w-24">
                          <span className="font-mono text-sm text-red-600 dark:text-red-400">{fmt(Math.abs(tid.discLc))}</span>
                          <span className="text-[10px] text-muted-foreground ml-0.5">({pct}%)</span>
                        </div>
                        <div className="text-center px-2 w-14 text-sm pr-3">{tid.bidCount}</div>
                      </div>

                      {isExpanded && (
                        <div className="border-b bg-muted/10 dark:bg-muted/5 px-4 py-3 space-y-3">
                          <div className="flex items-center gap-2 p-2 rounded-md bg-primary/5 border border-primary/10">
                            <Button size="sm" className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { flash(`${tid.tid} → SP Net applied`); resolve(tid.tid); setExpandedTid(null); }} data-testid={`tid-sp-net-${tid.tid}`}>
                              <TrendingUp className="h-3.5 w-3.5" /> Set SP Net
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-green-700 border-green-300 hover:bg-green-50" onClick={() => { flash(`${tid.tid} → HO Net applied`); resolve(tid.tid); setExpandedTid(null); }} data-testid={`tid-ho-net-${tid.tid}`}>
                              <TrendingDown className="h-3.5 w-3.5" /> Set HO Net
                            </Button>
                            <div className="flex-1" />
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => flash(`Dispute raised for ${tid.tid}`)} data-testid={`tid-dispute-${tid.tid}`}>
                              <Gavel className="h-3.5 w-3.5" /> Dispute
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-orange-700 border-orange-300 hover:bg-orange-50" onClick={() => flash(`Issue logged for ${tid.tid}`)} data-testid={`tid-issue-${tid.tid}`}>
                              <FileWarning className="h-3.5 w-3.5" /> Issue
                            </Button>
                          </div>

                          <div className="rounded-md border overflow-hidden bg-background">
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="h-7 bg-muted/30 border-b">
                                  <th className="text-left font-medium text-muted-foreground px-2 py-1 whitespace-nowrap">Booking ID</th>
                                  <th className="text-right font-medium text-muted-foreground px-2 py-1 whitespace-nowrap w-24">SP Net</th>
                                  <th className="text-right font-medium text-muted-foreground px-2 py-1 whitespace-nowrap w-24">HO Net</th>
                                  <th className="text-right font-medium text-muted-foreground px-2 py-1 whitespace-nowrap w-24">Diff</th>
                                </tr>
                              </thead>
                              <tbody>
                                {tid.bookings.map(b => {
                                  const diff = (b.hoNet || 0) - (b.spNetInHo || 0);
                                  return (
                                    <tr key={b.bookingId} className="h-8 border-b last:border-0 hover:bg-muted/20">
                                      <td className="px-2 py-1 font-mono text-primary font-medium">{b.bookingId}</td>
                                      <td className="text-right px-2 py-1 font-mono text-blue-600">{fmt(b.spNetInHo || 0)}</td>
                                      <td className="text-right px-2 py-1 font-mono text-green-600">{fmt(b.hoNet || 0)}</td>
                                      <td className={`text-right px-2 py-1 font-mono ${diff < 0 ? "text-red-600" : diff > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                                        {diff > 0 ? "+" : ""}{fmt(diff)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                              <tfoot>
                                <tr className="h-8 bg-muted/40 border-t font-semibold text-[11px]">
                                  <td className="px-2 py-1 text-muted-foreground">Total ({tid.bookings.length})</td>
                                  <td className="text-right px-2 py-1 font-mono text-blue-600">{fmt(tid.spNet)}</td>
                                  <td className="text-right px-2 py-1 font-mono text-green-600">{fmt(tid.hoNet)}</td>
                                  <td className={`text-right px-2 py-1 font-mono ${tid.discLc < 0 ? "text-red-600" : "text-green-600"}`}>{tid.discLc > 0 ? "+" : ""}{fmt(tid.discLc)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="border-t bg-muted/30 dark:bg-muted/10 px-5 py-2 flex items-center justify-between flex-shrink-0 text-xs">
          <span className="text-muted-foreground">{tidGroups.length} TIDs · {tidGroups.reduce((s, t) => s + t.bidCount, 0)} bookings</span>
          <div className="flex items-center gap-4">
            <span><span className="text-muted-foreground mr-1">SP</span><span className="font-mono font-medium text-blue-700 dark:text-blue-400">{fmt(tidGroups.reduce((s, t) => s + t.spNet, 0))}</span></span>
            <span><span className="text-muted-foreground mr-1">HO</span><span className="font-mono font-medium text-green-700 dark:text-green-400">{fmt(tidGroups.reduce((s, t) => s + t.hoNet, 0))}</span></span>
            <span><span className="text-muted-foreground mr-1">Disc.</span><span className="font-mono font-semibold text-red-600 dark:text-red-400">{fmt(tidGroups.reduce((s, t) => s + Math.abs(t.discLc), 0))}</span></span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
