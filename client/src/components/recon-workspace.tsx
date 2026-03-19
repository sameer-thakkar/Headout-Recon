import { useState, useCallback, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ChevronRight, ChevronDown, CheckCircle2, Search, TrendingUp, TrendingDown,
  Check, Gavel, FileWarning, AlertTriangle, X as XIcon, BarChart3,
  PanelTopClose, PanelTop, CheckCheck, Loader2, Calculator, Link2, Wand2, RotateCcw,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { DiscrepancyAnalysisRow, PrimaryRow } from "@shared/schema";
import { driTeams, errorBucketRcaMapping, errorBucketOptions } from "@shared/schema";
import type { BookingForPayable } from "@/components/amount-payable-modal";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatDateDDMMYYYY(value: unknown): string | null {
  if (!value) return null;
  const strValue = String(value);
  const numValue = Number(strValue);
  if (!isNaN(numValue) && numValue > 1000 && numValue < 100000) {
    const epoch = new Date(1899, 11, 30);
    const d = new Date(epoch.getTime() + numValue * 86400000);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }
  const dateStr = strValue.split("T")[0];
  const [year, month, day] = dateStr.split("-");
  if (year && month && day && year.length === 4) return `${day}/${month}/${year}`;
  return strValue;
}

// ─── TID Aggregate ──────────────────────────────────────────────────────────

interface TidAggregate {
  tid: string;
  bookings: BookingForPayable[];
  totalSpNet: number;
  totalHoNet: number;
  discrepancy: number;
  hasPax: boolean;
}

function buildTidAggregates(bookings: BookingForPayable[]): TidAggregate[] {
  const tidMap = new Map<string, BookingForPayable[]>();
  for (const b of bookings) {
    const t = b.tid || "UNKNOWN";
    if (!tidMap.has(t)) tidMap.set(t, []);
    tidMap.get(t)!.push(b);
  }
  return Array.from(tidMap.entries())
    .map(([tid, bs]) => {
      const totalSpNet = Math.round(bs.reduce((s, b) => s + b.spNet, 0) * 100) / 100;
      const totalHoNet = Math.round(bs.reduce((s, b) => s + b.hoNet, 0) * 100) / 100;
      const hasPax = bs.some(b => b.paxBreakdown && b.paxBreakdown.length > 0);
      return {
        tid, bookings: bs, totalSpNet, totalHoNet,
        discrepancy: Math.round((totalHoNet - totalSpNet) * 100) / 100,
        hasPax,
      };
    })
    .sort((a, b) => Math.abs(b.discrepancy) - Math.abs(a.discrepancy));
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ReconWorkspaceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: string;
  discrepancyRows: DiscrepancyAnalysisRow[];
  isDiscrepancyLoading: boolean;
  bookings: BookingForPayable[];
  allRows: PrimaryRow[];
  currency: string;
  runId: string | null;
  fxRateToUsd?: number;
  billingEntityName: string;
  beId: string;
  onApplyFinalNet?: (bookingIds: string[], mode: "sp" | "ho") => void;
}

// ─── Issue form state ────────────────────────────────────────────────────────

interface IssueForm {
  driTeam: string;
  errorBucket: string;
  rca: string;
  priority: string;
  slackLink: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ReconWorkspace({
  open, onOpenChange, reason, discrepancyRows, isDiscrepancyLoading,
  bookings, allRows, currency, runId, fxRateToUsd, billingEntityName, beId,
  onApplyFinalNet,
}: ReconWorkspaceProps) {
  const { toast } = useToast();

  // Panel state
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const [expandedTid, setExpandedTid] = useState<string | null>(null);
  const [selectedTids, setSelectedTids] = useState<Set<string>>(new Set());
  const [resolvedTids, setResolvedTids] = useState<Set<string>>(new Set());
  const [highlightedTid, setHighlightedTid] = useState<string | null>(null);
  const [tidSearch, setTidSearch] = useState("");

  // Bulk confirm state
  const [bulkConfirm, setBulkConfirm] = useState<string | null>(null);
  const [bulkScope, setBulkScope] = useState<"all" | "selected">("all");

  // Per-TID action UI state
  const [showSpConfirmTid, setShowSpConfirmTid] = useState<string | null>(null);
  const [spDisputeChecked, setSpDisputeChecked] = useState(false);
  const [showPaxTid, setShowPaxTid] = useState<string | null>(null);
  const [paxPrices, setPaxPrices] = useState<Record<string, string>>({});

  // Bottom section state
  const [disputeSectionOpen, setDisputeSectionOpen] = useState(false);
  const [issueSectionOpen, setIssueSectionOpen] = useState(false);
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [issueForm, setIssueForm] = useState<IssueForm>({
    driTeam: "",
    errorBucket: reason,
    rca: "",
    priority: "Medium",
    slackLink: "",
  });

  // API pending state
  const [pendingDisputeTids, setPendingDisputeTids] = useState<Set<string>>(new Set());
  const [raisedDisputeTids, setRaisedDisputeTids] = useState<Set<string>>(new Set());

  const isNPD = reason === "Net Price Discrepancy";
  const isMTB = reason === "Multiple Tickets Booked";

  // ── Derived data ──────────────────────────────────────────────────────────
  const tidAggregates = useMemo(() => buildTidAggregates(
    bookings.filter(b => b.reason === reason)
  ), [bookings, reason]);

  const filteredAggregates = useMemo(() =>
    tidAggregates.filter(t =>
      !tidSearch || t.tid.toLowerCase().includes(tidSearch.toLowerCase())
    ), [tidAggregates, tidSearch]);

  const totalDisc = tidAggregates.reduce((s, t) => s + Math.abs(t.discrepancy), 0);

  // Disputeable bookings
  const { disputableCount, disputableTotal } = useMemo(() => {
    let count = 0; let total = 0;
    for (const agg of tidAggregates) {
      for (const b of agg.bookings) {
        const d = Math.abs(b.hoNet - b.spNet);
        if (d > 0) { count++; total += d; }
      }
    }
    return { disputableCount: count, disputableTotal: total };
  }, [tidAggregates]);

  // RCA options derived from error bucket
  const rcaOptions = useMemo(() =>
    errorBucketRcaMapping[issueForm.errorBucket] || []
  , [issueForm.errorBucket]);

  // ── Analysis row lookup by TID ────────────────────────────────────────────
  const analysisRowByTid = useMemo(() => {
    const m = new Map<string, DiscrepancyAnalysisRow>();
    for (const r of discrepancyRows) m.set(r.tid, r);
    return m;
  }, [discrepancyRows]);

  // ── Selection helpers ─────────────────────────────────────────────────────
  const toggleSelect = useCallback((tid: string) => {
    setSelectedTids(prev => {
      const next = new Set(prev);
      if (next.has(tid)) next.delete(tid); else next.add(tid);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    const unresolvedTids = filteredAggregates.filter(t => !resolvedTids.has(t.tid));
    setSelectedTids(prev =>
      prev.size === unresolvedTids.length
        ? new Set()
        : new Set(unresolvedTids.map(t => t.tid))
    );
  }, [filteredAggregates, resolvedTids]);

  const handleAnalysisRowClick = useCallback((tid: string) => {
    setHighlightedTid(tid);
    setExpandedTid(tid);
    setShowSpConfirmTid(null);
    setShowPaxTid(null);
    setTimeout(() => {
      document.getElementById(`ws-tid-${tid}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    setTimeout(() => setHighlightedTid(null), 3000);
  }, []);

  const clearTidActionPanels = () => {
    setShowSpConfirmTid(null);
    setShowPaxTid(null);
    setSpDisputeChecked(false);
    setPaxPrices({});
  };

  // ── Resolve helpers ───────────────────────────────────────────────────────
  const resolveMultiple = useCallback((tids: string[]) => {
    setResolvedTids(prev => { const next = new Set(prev); tids.forEach(t => next.add(t)); return next; });
  }, []);

  // ── Action: Apply SP/HO Net ───────────────────────────────────────────────
  const applyFinalNet = useCallback((tids: TidAggregate[], mode: "sp" | "ho") => {
    const bookingIds = tids.flatMap(t => t.bookings.map(b => b.bookingId));
    onApplyFinalNet?.(bookingIds, mode);
    resolveMultiple(tids.map(t => t.tid));
    toast({
      title: `${mode === "sp" ? "SP" : "HO"} Net applied`,
      description: `${tids.length} TID${tids.length !== 1 ? "s" : ""} updated (${bookingIds.length} bookings).`,
    });
  }, [onApplyFinalNet, resolveMultiple, toast]);

  // ── Action: Raise Dispute ─────────────────────────────────────────────────
  const raiseDisputes = useCallback(async (tids: TidAggregate[]) => {
    if (!runId) return;
    const tidIds = tids.map(t => t.tid);
    setPendingDisputeTids(prev => { const next = new Set(prev); tidIds.forEach(id => next.add(id)); return next; });
    let count = 0;
    for (const t of tids) {
      for (const b of t.bookings) {
        const disc = Math.abs(b.hoNet - b.spNet);
        if (disc === 0) continue;
        try {
          await apiRequest("POST", `/api/disputes/${runId}`, {
            bookingId: b.bookingId,
            billingEntityId: beId,
            billingEntityName,
            ticketId: b.ticketId || "",
            tid: b.tid || "",
            currency,
            disputeAmount: disc,
            maxDisputeAmount: disc,
            reconciledNet: Math.abs(b.hoNet),
            status: "pending",
            closureStatus: "open",
          });
          count++;
        } catch (err) {
          console.error(`Dispute failed for ${b.bookingId}:`, err);
        }
      }
    }
    setPendingDisputeTids(prev => { const next = new Set(prev); tidIds.forEach(id => next.delete(id)); return next; });
    if (count > 0) {
      setRaisedDisputeTids(prev => { const next = new Set(prev); tidIds.forEach(id => next.add(id)); return next; });
      queryClient.invalidateQueries({ queryKey: [`/api/disputes/${runId}`] });
      toast({ title: "Disputes raised", description: `${count} dispute${count !== 1 ? "s" : ""} created.` });
    }
  }, [runId, beId, billingEntityName, currency, toast]);

  // ── Action: Log Issue (single, from bottom form) ──────────────────────────
  const submitIssue = useCallback(async () => {
    if (!runId) return;
    setIssueSubmitting(true);
    const fxRate = fxRateToUsd || 1;
    const allBookingIds = tidAggregates.flatMap(t => t.bookings.map(b => b.bookingId));
    try {
      await apiRequest("POST", `/api/issues`, {
        runId,
        billingEntityId: beId,
        billingEntityName,
        currency,
        discrepancyLocal: totalDisc,
        discrepancyUsd: totalDisc * fxRate,
        reason,
        driTeam: issueForm.driTeam,
        bookingIds: allBookingIds,
        paymentMethod: tidAggregates[0]?.bookings[0]?.paymentMethod || "",
        errorBucket: issueForm.errorBucket,
        rca: issueForm.rca,
        slackLink: issueForm.slackLink,
        priority: issueForm.priority,
        issueStatus: "open",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/issues/${runId}`] });
      toast({ title: "Issue logged", description: "Issue created and linked to this reconciliation." });
      setIssueSectionOpen(false);
      setIssueForm(prev => ({ ...prev, rca: "", slackLink: "" }));
    } catch (err) {
      console.error("Issue submit failed:", err);
      toast({ title: "Failed to log issue", description: "Please try again.", variant: "destructive" });
    } finally {
      setIssueSubmitting(false);
    }
  }, [runId, beId, billingEntityName, currency, fxRateToUsd, reason, issueForm, tidAggregates, totalDisc, toast]);

  // ── Bulk action helpers ───────────────────────────────────────────────────
  const getBulkTids = useCallback(() =>
    bulkScope === "all" ? tidAggregates : tidAggregates.filter(t => selectedTids.has(t.tid))
  , [bulkScope, tidAggregates, selectedTids]);

  const openDiscrepancyAction = (action: string) => { setBulkScope("all"); setBulkConfirm(action); };
  const openSelectionAction = (action: string) => { setBulkScope("selected"); setBulkConfirm(action); };

  const handleBulkConfirm = useCallback(async (action: string) => {
    const tids = getBulkTids();
    if (action === "sp" || action === "ho") {
      applyFinalNet(tids, action as "sp" | "ho");
    } else if (action === "dispute") {
      await raiseDisputes(tids);
    }
    setSelectedTids(new Set());
    setBulkConfirm(null);
  }, [getBulkTids, applyFinalNet, raiseDisputes]);

  const resolvedCount = resolvedTids.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-3 border-b flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span>{reason}</span>
            <Badge variant="secondary" className="text-xs">
              {tidAggregates.length} TIDs · {bookings.filter(b => b.reason === reason).length} bookings
            </Badge>
            {resolvedCount > 0 && (
              <Badge className="text-xs bg-green-100 text-green-700 border-green-200">
                <CheckCircle2 className="h-3 w-3 mr-1" />{resolvedCount}/{tidAggregates.length} resolved
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col min-h-0">

          {/* ═════════════════════════════════════════════════════════════
              ANALYSIS PANEL — collapsible violet header + table
          ═════════════════════════════════════════════════════════════ */}
          <div className="flex-shrink-0 border-b">
            <div
              className="flex items-center justify-between px-4 py-2 bg-violet-50/70 dark:bg-violet-950/20 cursor-pointer hover:bg-violet-50 dark:hover:bg-violet-950/30"
              onClick={() => setAnalysisOpen(o => !o)}
            >
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-violet-600" />
                <span className="text-sm font-semibold text-violet-800 dark:text-violet-300">Discrepancy Analysis</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-violet-100 text-violet-700 border-violet-200">
                  {discrepancyRows.length} TIDs
                </Badge>
                {!isDiscrepancyLoading && discrepancyRows.length > 0 && (
                  <span className="text-[11px] text-violet-600 dark:text-violet-400">Click a row to jump to actions ↓</span>
                )}
              </div>
              {analysisOpen
                ? <PanelTopClose className="h-4 w-4 text-violet-500" />
                : <PanelTop className="h-4 w-4 text-violet-500" />}
            </div>

            {analysisOpen && (
              <div className="max-h-[28vh] overflow-auto">
                {isDiscrepancyLoading ? (
                  <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading analysis…
                  </div>
                ) : discrepancyRows.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">No analysis data available.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="h-8 bg-violet-50/40 dark:bg-violet-950/10">
                        <TableHead className="py-1.5 text-xs pl-4">TID</TableHead>
                        <TableHead className="py-1.5 text-xs text-right">Disc. USD</TableHead>
                        <TableHead className="py-1.5 text-xs">Fulfilment</TableHead>
                        {isMTB && (
                          <>
                            <TableHead className="py-1.5 text-xs">Times Charged</TableHead>
                            <TableHead className="py-1.5 text-xs">Start Date</TableHead>
                            <TableHead className="py-1.5 text-xs">End Date</TableHead>
                            <TableHead className="py-1.5 text-xs text-right">BID Count</TableHead>
                            <TableHead className="py-1.5 text-xs text-right">BID Count Dur.</TableHead>
                            <TableHead className="py-1.5 text-xs text-right">Total BIDs</TableHead>
                            <TableHead className="py-1.5 text-xs">DRI Team</TableHead>
                          </>
                        )}
                        {isNPD && (
                          <>
                            <TableHead className="py-1.5 text-xs text-right">HO Rate</TableHead>
                            <TableHead className="py-1.5 text-xs text-right">Actual Rate</TableHead>
                            <TableHead className="py-1.5 text-xs">Start Date</TableHead>
                            <TableHead className="py-1.5 text-xs">End Date</TableHead>
                            <TableHead className="py-1.5 text-xs text-right">Disc %</TableHead>
                            <TableHead className="py-1.5 text-xs text-right">BIDs w/ Disc</TableHead>
                            <TableHead className="py-1.5 text-xs text-right">BIDs Dur.</TableHead>
                            <TableHead className="py-1.5 text-xs text-center">Loss?</TableHead>
                            <TableHead className="py-1.5 text-xs text-right pr-4">Loss USD</TableHead>
                          </>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {discrepancyRows.map((row, idx) => (
                        <TableRow
                          key={`${row.tid}-${idx}`}
                          className="h-9 cursor-pointer hover:bg-violet-50/60 dark:hover:bg-violet-950/10"
                          onClick={() => handleAnalysisRowClick(row.tid)}
                          data-testid={`analysis-row-${row.tid}`}
                        >
                          <TableCell className="py-1.5 pl-4 font-mono text-sm text-primary font-medium">
                            <div className="flex items-center gap-1.5">
                              {resolvedTids.has(row.tid) && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />}
                              {row.tid}
                            </div>
                          </TableCell>
                          <TableCell className="py-1.5 text-right font-mono text-sm text-red-600 dark:text-red-400">
                            {formatNumber(row.discrepancyUsd)}
                          </TableCell>
                          <TableCell className="py-1.5 text-sm">{row.fulfillmentMethod}</TableCell>
                          {isMTB && (
                            <>
                              <TableCell className="py-1.5 text-sm">{row.timesCharged}</TableCell>
                              <TableCell className="py-1.5 text-sm">{formatDateDDMMYYYY(row.startDate) || "—"}</TableCell>
                              <TableCell className="py-1.5 text-sm">{formatDateDDMMYYYY(row.endDate) || "—"}</TableCell>
                              <TableCell className="py-1.5 text-right text-sm">{row.countBidWithDiscrepancy}</TableCell>
                              <TableCell className="py-1.5 text-right text-sm">{row.countBidsInDuration}</TableCell>
                              <TableCell className="py-1.5 text-right text-sm">{row.totalBidsInReport}</TableCell>
                              <TableCell className="py-1.5 text-sm">{row.driTeam}</TableCell>
                            </>
                          )}
                          {isNPD && (
                            <>
                              <TableCell className="py-1.5 text-right font-mono text-sm">
                                {row.hoTakeRatePercent?.toFixed(2) ?? "—"}%
                              </TableCell>
                              <TableCell className={`py-1.5 text-right font-mono text-sm ${(row.actualTakeRatePercent ?? 0) < 0 ? "text-red-600 dark:text-red-400 font-semibold" : ""}`}>
                                {row.actualTakeRatePercent?.toFixed(2) ?? "—"}%
                              </TableCell>
                              <TableCell className="py-1.5 text-sm">{formatDateDDMMYYYY(row.startDate) || "—"}</TableCell>
                              <TableCell className="py-1.5 text-sm">{formatDateDDMMYYYY(row.endDate) || "—"}</TableCell>
                              <TableCell className={`py-1.5 text-right font-mono text-sm ${row.discrepancyPercentRange?.startsWith("-") ? "text-red-600 dark:text-red-400" : ""}`}>
                                {row.discrepancyPercentRange || "—"}
                              </TableCell>
                              <TableCell className="py-1.5 text-right text-sm">{row.countBidWithDiscrepancy}</TableCell>
                              <TableCell className="py-1.5 text-right text-sm">{row.countBidsInDuration}</TableCell>
                              <TableCell className="py-1.5 text-center">
                                <Badge variant={row.soldAtLoss === "Yes" ? "destructive" : "secondary"} className="text-[10px] px-1.5 py-0">
                                  {row.soldAtLoss || "—"}
                                </Badge>
                              </TableCell>
                              <TableCell className={`py-1.5 text-right font-mono text-sm pr-4 ${(row.lossUsd ?? 0) > 0 ? "text-red-600 dark:text-red-400 font-semibold" : ""}`}>
                                {row.lossUsd != null && row.lossUsd > 0 ? formatNumber(row.lossUsd) : "—"}
                              </TableCell>
                            </>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </div>

          {/* ═════════════════════════════════════════════════════════════
              ACTION PANEL — TID list with bulk controls + expand
          ═════════════════════════════════════════════════════════════ */}
          <div className="flex-1 overflow-auto px-4 py-3 space-y-2 min-h-0">

            {/* Header row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Actions</span>
                <Badge variant="secondary" className="text-xs">{tidAggregates.length} TIDs</Badge>
              </div>
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search TIDs…"
                  className="h-8 pl-8 w-44 text-xs"
                  value={tidSearch}
                  onChange={e => setTidSearch(e.target.value)}
                  data-testid="input-search-tids"
                />
              </div>
            </div>

            {/* ★ DISCREPANCY-LEVEL BULK STRIP — always visible */}
            {!bulkConfirm && (
              <div className="rounded-lg border bg-muted/30 px-3 py-2 flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                  All {tidAggregates.length} TIDs:
                </span>
                <div className="h-4 w-px bg-border" />
                <Button size="sm" className="h-7 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => openDiscrepancyAction("sp")} data-testid="bulk-all-sp">
                  <TrendingUp className="h-3 w-3" /> SP Net
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 text-green-700 border-green-300 hover:bg-green-50" onClick={() => openDiscrepancyAction("ho")} data-testid="bulk-all-ho">
                  <TrendingDown className="h-3 w-3" /> HO Net
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => openDiscrepancyAction("dispute")} data-testid="bulk-all-dispute">
                  <Gavel className="h-3 w-3" /> Raise Dispute
                </Button>
              </div>
            )}

            {/* ★ CHECKBOX BULK BAR — 2+ selected */}
            {selectedTids.size >= 2 && !bulkConfirm && (
              <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-2 flex items-center gap-2 flex-wrap animate-in fade-in duration-200">
                <div className="flex items-center gap-2">
                  <CheckCheck className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">{selectedTids.size} TIDs selected</span>
                </div>
                <div className="h-4 w-px bg-border" />
                <Button size="sm" className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => openSelectionAction("sp")} data-testid="bulk-sel-sp">
                  <TrendingUp className="h-3 w-3" /> SP Net
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-green-700 border-green-300 hover:bg-green-50" onClick={() => openSelectionAction("ho")} data-testid="bulk-sel-ho">
                  <TrendingDown className="h-3 w-3" /> HO Net
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => openSelectionAction("dispute")} data-testid="bulk-sel-dispute">
                  <Gavel className="h-3 w-3" /> Dispute
                </Button>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedTids(new Set())}>
                  <XIcon className="h-3 w-3 mr-1" /> Clear
                </Button>
              </div>
            )}

            {/* ★ BULK CONFIRM — SP/HO table */}
            {bulkConfirm && (bulkConfirm === "sp" || bulkConfirm === "ho") && (() => {
              const selectedData = getBulkTids();
              const isSp = bulkConfirm === "sp";
              const totalPayable = selectedData.reduce((s, t) => s + (isSp ? t.totalSpNet : t.totalHoNet), 0);
              const overpay = isSp ? totalPayable - selectedData.reduce((s, t) => s + t.totalHoNet, 0) : 0;
              return (
                <div className="rounded-lg border-2 border-blue-200 bg-blue-50/60 dark:bg-blue-950/20 p-3 space-y-2 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-blue-800 dark:text-blue-300">
                      {isSp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                      Bulk {isSp ? "SP Net" : "HO Net"} — {bulkScope === "all" ? `All ${selectedData.length}` : `${selectedData.length} selected`} TIDs
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setBulkConfirm(null)}>
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="rounded-md border overflow-hidden bg-background">
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center h-7 bg-muted/30 px-3 text-[11px] font-medium text-muted-foreground border-b">
                      <div>TID</div>
                      <div className="text-right w-28 px-2 text-blue-600">SP Net</div>
                      <div className="text-right w-28 px-2 text-green-600">HO Net</div>
                      <div className="text-right w-24 px-2">Discrepancy</div>
                      <div className="text-right w-28 px-2 font-semibold text-foreground">Payable</div>
                    </div>
                    {selectedData.map(t => (
                      <div key={t.tid} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-3 h-8 border-b last:border-0 text-xs">
                        <div className="font-mono font-medium text-primary">{t.tid}</div>
                        <div className={`text-right w-28 px-2 font-mono ${isSp ? "font-semibold text-blue-700" : "text-muted-foreground"}`}>{formatNumber(t.totalSpNet)}</div>
                        <div className={`text-right w-28 px-2 font-mono ${!isSp ? "font-semibold text-green-700" : "text-muted-foreground"}`}>{formatNumber(t.totalHoNet)}</div>
                        <div className="text-right w-24 px-2 font-mono text-red-500">{formatNumber(Math.abs(t.discrepancy))}</div>
                        <div className={`text-right w-28 px-2 font-mono font-semibold ${isSp ? "text-blue-700" : "text-green-700"}`}>
                          {formatNumber(isSp ? t.totalSpNet : t.totalHoNet)}
                        </div>
                      </div>
                    ))}
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-3 h-8 bg-muted/30 border-t text-xs font-semibold">
                      <div className="text-muted-foreground">Total ({selectedData.length} TIDs)</div>
                      <div className="text-right w-28 px-2 font-mono text-blue-600">{formatNumber(selectedData.reduce((s, t) => s + t.totalSpNet, 0))}</div>
                      <div className="text-right w-28 px-2 font-mono text-green-600">{formatNumber(selectedData.reduce((s, t) => s + t.totalHoNet, 0))}</div>
                      <div className="text-right w-24 px-2 font-mono text-red-500">{formatNumber(selectedData.reduce((s, t) => s + Math.abs(t.discrepancy), 0))}</div>
                      <div className={`text-right w-28 px-2 font-mono text-sm ${isSp ? "text-blue-700" : "text-green-700"}`}>{formatNumber(totalPayable)}</div>
                    </div>
                  </div>
                  {isSp && overpay > 0 && (
                    <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                      <span className="text-amber-800 dark:text-amber-300">
                        Paying <span className="font-mono font-semibold">{formatNumber(overpay)} {currency}</span> above HO Net — consider raising disputes.
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBulkConfirm(null)}>Cancel</Button>
                    <Button
                      size="sm"
                      className={`h-7 text-xs gap-1 ${isSp ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}`}
                      variant={isSp ? "default" : "outline"}
                      onClick={() => handleBulkConfirm(bulkConfirm)}
                      data-testid={`confirm-bulk-${bulkConfirm}`}
                    >
                      <Check className="h-3 w-3" /> Apply {isSp ? "SP Net" : "HO Net"} to {selectedData.length} TIDs
                    </Button>
                  </div>
                </div>
              );
            })()}

            {/* ★ BULK CONFIRM — dispute */}
            {bulkConfirm === "dispute" && (() => {
              const selectedData = getBulkTids();
              const isLoading = selectedData.some(t => pendingDisputeTids.has(t.tid));
              return (
                <div className="rounded-lg border-2 border-amber-300 bg-amber-50/80 dark:bg-amber-950/20 p-3 space-y-2 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="h-4 w-4" />
                      Raise Dispute for {bulkScope === "all" ? `all ${selectedData.length}` : `${selectedData.length} selected`} TIDs
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setBulkConfirm(null)}>
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedData.map(t => <Badge key={t.tid} variant="outline" className="text-xs font-mono">{t.tid}</Badge>)}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBulkConfirm(null)}>Cancel</Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1"
                      disabled={isLoading}
                      onClick={() => handleBulkConfirm(bulkConfirm)}
                      data-testid="confirm-bulk-dispute"
                    >
                      {isLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                      Confirm &amp; Raise
                    </Button>
                  </div>
                </div>
              );
            })()}

            {/* TID LIST */}
            {filteredAggregates.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No TIDs found.</div>
            ) : (
              <div className="rounded-md border overflow-hidden">
                {/* Table header */}
                <div className="grid grid-cols-[auto_auto_1fr_auto_auto_auto] gap-0 items-center h-8 bg-muted/40 px-3 text-xs font-medium text-muted-foreground border-b">
                  <div className="w-7 flex items-center justify-center cursor-pointer" onClick={e => { e.stopPropagation(); toggleSelectAll(); }}>
                    <Checkbox
                      checked={selectedTids.size > 0 && selectedTids.size === filteredAggregates.filter(t => !resolvedTids.has(t.tid)).length}
                      className="h-3.5 w-3.5"
                    />
                  </div>
                  <div className="w-5" />
                  <div className="pl-2">TID</div>
                  <div className="text-right px-3 w-28">SP Net</div>
                  <div className="text-right px-3 w-28">HO Net</div>
                  <div className="text-right px-3 w-24 pr-3">Disc.</div>
                </div>

                {filteredAggregates.map(agg => {
                  const isExpanded = expandedTid === agg.tid;
                  const isResolved = resolvedTids.has(agg.tid);
                  const isHighlighted = highlightedTid === agg.tid;
                  const isSelected = selectedTids.has(agg.tid);
                  const discPct = totalDisc > 0 ? ((Math.abs(agg.discrepancy) / totalDisc) * 100).toFixed(0) : "0";
                  const analysisRow = analysisRowByTid.get(agg.tid);
                  const isShowingAction = showSpConfirmTid === agg.tid || showPaxTid === agg.tid;

                  return (
                    <div
                      key={agg.tid}
                      id={`ws-tid-${agg.tid}`}
                      className={`transition-all duration-500
                        ${isResolved ? "bg-green-50/40 dark:bg-green-950/10" : ""}
                        ${isHighlighted ? "ring-2 ring-violet-400 ring-inset bg-violet-50/30 dark:bg-violet-950/20" : ""}
                        ${isSelected && !isResolved ? "bg-primary/5" : ""}
                      `}
                    >
                      {/* TID row */}
                      <div
                        className={`grid grid-cols-[auto_auto_1fr_auto_auto_auto] gap-0 items-center px-3 h-11 cursor-pointer transition-colors hover:bg-muted/30 border-b ${isExpanded ? "bg-muted/20" : ""}`}
                        onClick={() => {
                          setExpandedTid(isExpanded ? null : agg.tid);
                          clearTidActionPanels();
                        }}
                        data-testid={`tid-row-${agg.tid}`}
                      >
                        <div className="w-7 flex items-center justify-center" onClick={e => { e.stopPropagation(); if (!isResolved) toggleSelect(agg.tid); }}>
                          {!isResolved && (
                            <Checkbox checked={isSelected} className="h-3.5 w-3.5" data-testid={`checkbox-tid-${agg.tid}`} />
                          )}
                        </div>
                        <div className="w-5 flex items-center">
                          {isResolved
                            ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                            : isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </div>
                        <div className="pl-2 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-sm font-medium text-primary">{agg.tid}</span>
                            {analysisRow?.fulfillmentMethod && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0">{analysisRow.fulfillmentMethod}</Badge>
                            )}
                            {analysisRow?.soldAtLoss === "Yes" && (
                              <Badge variant="destructive" className="text-[10px] px-1 py-0">Loss</Badge>
                            )}
                            {agg.hasPax && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 text-violet-600 border-violet-300">Pax</Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {agg.bookings.length} booking{agg.bookings.length !== 1 ? "s" : ""}
                            {analysisRow?.driTeam ? ` · DRI: ${analysisRow.driTeam}` : ""}
                          </div>
                        </div>
                        <div className="text-right px-3 w-28 font-mono text-sm">{formatNumber(agg.totalSpNet)}</div>
                        <div className="text-right px-3 w-28 font-mono text-sm">{formatNumber(agg.totalHoNet)}</div>
                        <div className="text-right px-3 w-24 pr-3">
                          <span className="font-mono text-sm text-red-600 dark:text-red-400">{formatNumber(Math.abs(agg.discrepancy))}</span>
                          <span className="text-[10px] text-muted-foreground ml-0.5">({discPct}%)</span>
                        </div>
                      </div>

                      {/* Expanded TID detail */}
                      {isExpanded && (
                        <div className="border-b bg-muted/10 px-4 py-3 space-y-3">

                          {/* Inline analysis chips */}
                          {analysisRow && (
                            <div className="flex items-center gap-2 flex-wrap">
                              {isNPD && analysisRow.hoTakeRatePercent != null && (
                                <div className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs">
                                  <span className="text-muted-foreground">Take Rate:</span>
                                  <span className="font-mono font-medium">{analysisRow.hoTakeRatePercent.toFixed(1)}%</span>
                                  <span className="text-muted-foreground">→</span>
                                  <span className={`font-mono font-semibold ${(analysisRow.actualTakeRatePercent ?? 0) < 0 ? "text-red-600" : (analysisRow.actualTakeRatePercent ?? 0) < analysisRow.hoTakeRatePercent ? "text-amber-600" : "text-green-600"}`}>
                                    {analysisRow.actualTakeRatePercent?.toFixed(1) ?? "—"}%
                                  </span>
                                  {analysisRow.discrepancyPercentRange && (
                                    <span className={`text-[10px] font-medium ${analysisRow.discrepancyPercentRange.startsWith("-") ? "text-red-500" : "text-green-500"}`}>
                                      ({analysisRow.discrepancyPercentRange})
                                    </span>
                                  )}
                                </div>
                              )}
                              {(analysisRow.startDate || analysisRow.endDate) && (
                                <div className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs">
                                  <span className="text-muted-foreground">Period:</span>
                                  <span className="font-medium">
                                    {formatDateDDMMYYYY(analysisRow.startDate) || "?"} – {formatDateDDMMYYYY(analysisRow.endDate) || "?"}
                                  </span>
                                </div>
                              )}
                              {analysisRow.countBidWithDiscrepancy > 0 && (
                                <div className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs">
                                  <span className="text-muted-foreground">BIDs w/ disc:</span>
                                  <span className="font-mono font-medium">{analysisRow.countBidWithDiscrepancy}/{analysisRow.countBidsInDuration}</span>
                                </div>
                              )}
                              {analysisRow.soldAtLoss === "Yes" && (
                                <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 px-2.5 py-1.5 text-xs">
                                  <AlertTriangle className="h-3 w-3 text-red-600" />
                                  <span className="font-medium text-red-700 dark:text-red-400">Sold at Loss</span>
                                  {analysisRow.lossUsd != null && (
                                    <span className="font-mono font-semibold text-red-600 dark:text-red-400">
                                      {formatNumber(analysisRow.lossUsd)} USD
                                    </span>
                                  )}
                                </div>
                              )}
                              {isMTB && analysisRow.timesCharged && (
                                <div className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs">
                                  <span className="text-muted-foreground">Times Charged:</span>
                                  <span className="font-mono font-medium">{analysisRow.timesCharged}</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* TID action strip */}
                          {!isShowingAction && (
                            <div className="flex items-center gap-2 p-2 rounded-md bg-primary/5 border border-primary/10 flex-wrap">
                              <span className="text-xs text-muted-foreground font-medium">{agg.tid}:</span>
                              <Button
                                size="sm"
                                className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white"
                                onClick={() => { setShowSpConfirmTid(agg.tid); setSpDisputeChecked(false); }}
                                data-testid={`tid-btn-sp-${agg.tid}`}
                              >
                                <TrendingUp className="h-3 w-3" /> SP Net
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1 text-green-700 border-green-300 hover:bg-green-50"
                                onClick={() => { applyFinalNet([agg], "ho"); setExpandedTid(null); }}
                                data-testid={`tid-btn-ho-${agg.tid}`}
                              >
                                <TrendingDown className="h-3 w-3" /> HO Net
                              </Button>
                              {agg.hasPax && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs gap-1 text-violet-700 border-violet-300 hover:bg-violet-50"
                                  onClick={() => { setShowPaxTid(agg.tid); setShowSpConfirmTid(null); setPaxPrices({}); }}
                                  data-testid={`tid-btn-pax-${agg.tid}`}
                                >
                                  <Calculator className="h-3 w-3" /> Pax Pricing
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1 text-amber-700 border-amber-300 hover:bg-amber-50"
                                disabled={pendingDisputeTids.has(agg.tid)}
                                onClick={() => raiseDisputes([agg])}
                                data-testid={`tid-btn-dispute-${agg.tid}`}
                              >
                                {pendingDisputeTids.has(agg.tid)
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <Gavel className="h-3 w-3" />}
                                {raisedDisputeTids.has(agg.tid) ? "Re-raise Dispute" : "Dispute"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1 text-orange-700 border-orange-300 hover:bg-orange-50"
                                onClick={() => {
                                  const driTeam = analysisRowByTid.get(agg.tid)?.driTeam || "";
                                  setIssueForm(prev => ({ ...prev, driTeam: driTeam || prev.driTeam }));
                                  setIssueSectionOpen(true);
                                  setTimeout(() => {
                                    document.querySelector("[data-testid='section-log-issue']")?.scrollIntoView({ behavior: "smooth", block: "start" });
                                  }, 100);
                                }}
                                data-testid={`tid-btn-issue-${agg.tid}`}
                              >
                                <FileWarning className="h-3 w-3" /> Issue
                              </Button>
                            </div>
                          )}

                          {/* SP Net confirm panel */}
                          {showSpConfirmTid === agg.tid && (
                            <div className="rounded-md border border-blue-200 bg-blue-50/60 dark:bg-blue-950/20 p-3 space-y-2 animate-in fade-in duration-200">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-sm font-semibold text-blue-800 dark:text-blue-300">
                                  <TrendingUp className="h-4 w-4" /> Apply SP Net to {agg.tid}
                                </div>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShowSpConfirmTid(null)}>
                                  <XIcon className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                TAP = SP Net <span className="font-mono font-semibold text-blue-700 dark:text-blue-300">{formatNumber(agg.totalSpNet)} {currency}</span>
                                {" "}(paying <span className="font-mono text-amber-600">{formatNumber(Math.abs(agg.discrepancy))}</span> above HO Net)
                              </p>
                              <div className="flex items-center gap-1.5">
                                <Checkbox
                                  checked={spDisputeChecked}
                                  onCheckedChange={v => setSpDisputeChecked(v === true)}
                                  data-testid={`checkbox-sp-dispute-${agg.tid}`}
                                />
                                <span className="text-xs">Also raise a dispute for the difference</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowSpConfirmTid(null)}>Cancel</Button>
                                <Button
                                  size="sm"
                                  className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white"
                                  onClick={async () => {
                                    applyFinalNet([agg], "sp");
                                    if (spDisputeChecked) await raiseDisputes([agg]);
                                    setShowSpConfirmTid(null);
                                    setSpDisputeChecked(false);
                                    setExpandedTid(null);
                                  }}
                                  data-testid={`confirm-sp-${agg.tid}`}
                                >
                                  <Check className="h-3 w-3" /> Confirm
                                </Button>
                              </div>
                            </div>
                          )}

                          {/* Pax Pricing panel */}
                          {showPaxTid === agg.tid && (() => {
                            const paxTypes = Array.from(
                              new Map(
                                agg.bookings.flatMap(b => b.paxBreakdown || [])
                                  .map(p => [p.paxType, p])
                              ).values()
                            );
                            const allFilled = paxTypes.every(p => paxPrices[`${agg.tid}-${p.paxType}`]);
                            return (
                              <div className="rounded-md border border-violet-200 bg-violet-50/60 dark:bg-violet-950/20 p-3 space-y-2 animate-in fade-in duration-200">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 text-sm font-semibold text-violet-800 dark:text-violet-300">
                                    <Calculator className="h-4 w-4" /> Pax Pricing — {agg.tid}
                                  </div>
                                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShowPaxTid(null)}>
                                    <XIcon className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                                {paxTypes.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">No pax breakdown data available for this TID.</p>
                                ) : (
                                  <div className="rounded-md border overflow-hidden bg-background">
                                    <div className="grid grid-cols-[1fr_auto_auto_auto] px-3 h-7 bg-muted/30 items-center border-b text-[11px] font-medium text-muted-foreground">
                                      <div>Pax Type</div>
                                      <div className="w-16 text-right px-2">Count</div>
                                      <div className="w-24 text-right px-2">SP Unit Price</div>
                                      <div className="w-28 text-right px-2 text-violet-600">Final Price</div>
                                    </div>
                                    {paxTypes.map(p => (
                                      <div key={p.paxType} className="grid grid-cols-[1fr_auto_auto_auto] px-3 h-9 items-center border-b last:border-0 text-xs">
                                        <div className="font-medium">{p.paxType}</div>
                                        <div className="w-16 text-right px-2 font-mono">{p.count}</div>
                                        <div className="w-24 text-right px-2 font-mono text-muted-foreground">{formatNumber(p.unitPrice)}</div>
                                        <div className="w-28 px-2">
                                          <Input
                                            type="number"
                                            placeholder="Enter"
                                            className="h-7 text-xs font-mono text-right w-full"
                                            value={paxPrices[`${agg.tid}-${p.paxType}`] ?? ""}
                                            onChange={e => setPaxPrices(prev => ({ ...prev, [`${agg.tid}-${p.paxType}`]: e.target.value }))}
                                            data-testid={`pax-price-${agg.tid}-${p.paxType}`}
                                          />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
                                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowPaxTid(null)}>Cancel</Button>
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs gap-1"
                                    disabled={!allFilled || paxTypes.length === 0}
                                    onClick={() => {
                                      applyFinalNet([agg], "sp");
                                      setShowPaxTid(null);
                                      setPaxPrices({});
                                      setExpandedTid(null);
                                      toast({ title: "Pax prices applied", description: `${agg.tid} updated with custom pax pricing.` });
                                    }}
                                    data-testid={`confirm-pax-${agg.tid}`}
                                  >
                                    <Check className="h-3 w-3" /> Apply Pax Prices
                                  </Button>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Booking table */}
                          <div className="rounded-md border overflow-hidden">
                            <div className="grid grid-cols-[1fr_auto_auto] px-3 h-7 bg-muted/30 items-center border-b text-[11px] font-medium text-muted-foreground">
                              <div>Booking ID</div>
                              <div className="w-28 text-right px-2">SP Net</div>
                              <div className="w-28 text-right px-3">HO Net</div>
                            </div>
                            {agg.bookings.map(b => (
                              <div
                                key={b.bookingId}
                                className={`grid grid-cols-[1fr_auto_auto] px-3 h-8 items-center border-b last:border-0 text-xs ${b.spNet > b.hoNet ? "bg-red-50/30 dark:bg-red-950/10" : ""}`}
                                data-testid={`booking-row-${b.bookingId}`}
                              >
                                <div className="font-mono font-medium">{b.bookingId}</div>
                                <div className={`w-28 text-right px-2 font-mono ${b.spNet > b.hoNet ? "text-red-600 dark:text-red-400 font-semibold" : ""}`}>
                                  {formatNumber(b.spNet)}
                                </div>
                                <div className="w-28 text-right px-3 font-mono text-muted-foreground">{formatNumber(b.hoNet)}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════════
                RAISE DISPUTE SECTION — collapsible, bottom of action panel
            ══════════════════════════════════════════════════════════════ */}
            <div className="rounded-lg border overflow-hidden" data-testid="section-raise-dispute">
              <div
                className="flex items-center justify-between px-4 py-2.5 bg-amber-50/60 dark:bg-amber-950/10 cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-950/20"
                onClick={() => setDisputeSectionOpen(o => !o)}
              >
                <div className="flex items-center gap-2">
                  <Gavel className="h-4 w-4 text-amber-600" />
                  <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">Raise Disputes</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 border-amber-200">
                    {disputableCount} bookings · {formatNumber(disputableTotal)} {currency}
                  </Badge>
                </div>
                {disputeSectionOpen
                  ? <ChevronDown className="h-4 w-4 text-amber-500" />
                  : <ChevronRight className="h-4 w-4 text-amber-500" />}
              </div>
              {disputeSectionOpen && (
                <div className="px-4 py-3 space-y-3 bg-amber-50/20 dark:bg-amber-950/10 animate-in fade-in duration-200">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-md border bg-background p-3 text-center">
                      <div className="text-xs text-muted-foreground mb-1">Disputable Bookings</div>
                      <div className="font-mono text-lg font-semibold">{disputableCount}</div>
                      <div className="text-[11px] text-muted-foreground">where |SP − HO| &gt; 0</div>
                    </div>
                    <div className="rounded-md border bg-background p-3 text-center">
                      <div className="text-xs text-muted-foreground mb-1">Total Disputable Amount</div>
                      <div className="font-mono text-lg font-semibold text-amber-700">{formatNumber(disputableTotal)}</div>
                      <div className="text-[11px] text-muted-foreground">{currency}</div>
                    </div>
                    <div className="rounded-md border bg-background p-3 text-center">
                      <div className="text-xs text-muted-foreground mb-1">TIDs Affected</div>
                      <div className="font-mono text-lg font-semibold">{tidAggregates.filter(t => Math.abs(t.discrepancy) > 0).length}</div>
                      <div className="text-[11px] text-muted-foreground">out of {tidAggregates.length} total</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    <Button
                      size="sm"
                      className="h-8 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
                      disabled={disputableCount === 0 || tidAggregates.some(t => pendingDisputeTids.has(t.tid))}
                      onClick={() => raiseDisputes(tidAggregates)}
                      data-testid="btn-raise-all-disputes"
                    >
                      {tidAggregates.some(t => pendingDisputeTids.has(t.tid))
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Gavel className="h-3.5 w-3.5" />}
                      Raise All Disputes
                    </Button>
                    {raisedDisputeTids.size > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs gap-1.5 text-muted-foreground"
                        onClick={() => setRaisedDisputeTids(new Set())}
                        data-testid="btn-clear-disputes"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Clear Raised State
                      </Button>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {raisedDisputeTids.size > 0
                        ? `${raisedDisputeTids.size} TID${raisedDisputeTids.size !== 1 ? "s" : ""} raised · "Clear" resets to allow re-raising`
                        : "Creates one dispute per booking where a discrepancy exists."}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* ══════════════════════════════════════════════════════════════
                LOG ISSUE SECTION — collapsible, bottom of action panel
            ══════════════════════════════════════════════════════════════ */}
            <div className="rounded-lg border overflow-hidden" data-testid="section-log-issue">
              <div
                className="flex items-center justify-between px-4 py-2.5 bg-orange-50/60 dark:bg-orange-950/10 cursor-pointer hover:bg-orange-50 dark:hover:bg-orange-950/20"
                onClick={() => setIssueSectionOpen(o => !o)}
              >
                <div className="flex items-center gap-2">
                  <FileWarning className="h-4 w-4 text-orange-600" />
                  <span className="text-sm font-semibold text-orange-800 dark:text-orange-300">Log Issue</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-orange-100 text-orange-700 border-orange-200">
                    {tidAggregates.length} TIDs · {formatNumber(totalDisc)} {currency}
                  </Badge>
                </div>
                {issueSectionOpen
                  ? <ChevronDown className="h-4 w-4 text-orange-500" />
                  : <ChevronRight className="h-4 w-4 text-orange-500" />}
              </div>
              {issueSectionOpen && (
                <div className="px-4 py-3 space-y-3 bg-orange-50/20 dark:bg-orange-950/10 animate-in fade-in duration-200">
                  {/* Auto-analyze: pre-fill from reconciliation data */}
                  <div className="flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50 dark:bg-orange-950/30 px-3 py-2">
                    <Wand2 className="h-3.5 w-3.5 text-orange-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-orange-800 dark:text-orange-300">Auto-analyze</div>
                      <div className="text-[11px] text-orange-600 dark:text-orange-400 truncate">
                        Fills DRI team from analysis data · Error Bucket auto-set to "{reason}" · Discrepancy {formatNumber(totalDisc)} {currency}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 border-orange-300 text-orange-700 hover:bg-orange-50 flex-shrink-0"
                      onClick={() => {
                        const inferredDriTeam = discrepancyRows.find(r => r.driTeam)?.driTeam || "";
                        setIssueForm(prev => ({
                          ...prev,
                          errorBucket: reason,
                          rca: "",
                          driTeam: inferredDriTeam || prev.driTeam,
                        }));
                        toast({
                          title: "Auto-analyze applied",
                          description: inferredDriTeam
                            ? `DRI Team set to "${inferredDriTeam}", Error Bucket set to reason.`
                            : "Error Bucket set to reason. Select DRI Team manually.",
                        });
                      }}
                      data-testid="btn-auto-analyze"
                    >
                      <Wand2 className="h-3 w-3" /> Apply
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">DRI Team</label>
                      <Select
                        value={issueForm.driTeam}
                        onValueChange={v => setIssueForm(prev => ({ ...prev, driTeam: v }))}
                      >
                        <SelectTrigger className="h-8 text-xs" data-testid="select-dri-team">
                          <SelectValue placeholder="Select DRI team…" />
                        </SelectTrigger>
                        <SelectContent>
                          {driTeams.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Priority</label>
                      <Select
                        value={issueForm.priority}
                        onValueChange={v => setIssueForm(prev => ({ ...prev, priority: v }))}
                      >
                        <SelectTrigger className="h-8 text-xs" data-testid="select-priority">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["High", "Medium", "Low"].map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Error Bucket</label>
                      <Select
                        value={issueForm.errorBucket}
                        onValueChange={v => setIssueForm(prev => ({ ...prev, errorBucket: v, rca: "" }))}
                      >
                        <SelectTrigger className="h-8 text-xs" data-testid="select-error-bucket">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {errorBucketOptions.map(b => <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">RCA</label>
                      <Select
                        value={issueForm.rca}
                        onValueChange={v => setIssueForm(prev => ({ ...prev, rca: v }))}
                        disabled={rcaOptions.length === 0}
                      >
                        <SelectTrigger className="h-8 text-xs" data-testid="select-rca">
                          <SelectValue placeholder={rcaOptions.length === 0 ? "Select Error Bucket first" : "Select RCA…"} />
                        </SelectTrigger>
                        <SelectContent>
                          {rcaOptions.map(r => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <Link2 className="h-3 w-3" /> Slack Link <span className="font-normal">(optional)</span>
                    </label>
                    <Input
                      placeholder="https://headout.slack.com/archives/…"
                      className="h-8 text-xs"
                      value={issueForm.slackLink}
                      onChange={e => setIssueForm(prev => ({ ...prev, slackLink: e.target.value }))}
                      data-testid="input-slack-link"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <div className="text-xs text-muted-foreground">
                      Issue covers all {tidAggregates.length} TIDs · {formatNumber(totalDisc)} {currency} discrepancy
                    </div>
                    <Button
                      size="sm"
                      className="h-8 text-xs gap-1.5 bg-orange-600 hover:bg-orange-700 text-white"
                      disabled={!issueForm.driTeam || !issueForm.rca || issueSubmitting}
                      onClick={submitIssue}
                      data-testid="btn-submit-issue"
                    >
                      {issueSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileWarning className="h-3.5 w-3.5" />}
                      Log Issue
                    </Button>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
