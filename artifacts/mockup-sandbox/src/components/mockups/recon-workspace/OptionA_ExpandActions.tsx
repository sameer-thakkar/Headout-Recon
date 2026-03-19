import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ChevronRight, ChevronDown, CheckCircle2, Search, TrendingUp, TrendingDown,
  Calculator, Check, Gavel, FileWarning, AlertTriangle, X as XIcon,
  BarChart3, PanelTopClose, PanelTop, CheckCheck, AlertCircle, Wallet,
  Download, ArrowRight, Minus, Plus, RefreshCw, ExternalLink
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
  { bookingId: "BID-1001", spNet: 850, hoNet: 800 },
  { bookingId: "BID-1002", spNet: 920, hoNet: 850 },
  { bookingId: "BID-1003", spNet: 1_100, hoNet: 1_050 },
  { bookingId: "BID-1004", spNet: 780, hoNet: 780 },
  { bookingId: "BID-1005", spNet: 850, hoNet: 670 },
  { bookingId: "BID-1006", spNet: 700, hoNet: 700 },
];

const PAX_ROWS = [
  { paxType: "Adult", dateRange: "12/01 - 28/01", count: 8, spUnit: 650, hoUnit: 600 },
  { paxType: "Adult", dateRange: "01/02 - 15/02", count: 4, spUnit: 680, hoUnit: 620 },
  { paxType: "Child", dateRange: "12/01 - 15/02", count: 3, spUnit: 420, hoUnit: 400 },
];

const RELOAD_ROWS = [
  { zendesk: "ZD-44201", date: "05/01/2026", amount: 10_000, currency: "EUR", loaded: 10_500 },
  { zendesk: "ZD-44387", date: "14/01/2026", amount: 8_000, currency: "EUR", loaded: 8_200 },
  { zendesk: "ZD-44519", date: "22/01/2026", amount: 7_000, currency: "EUR", loaded: 7_100 },
];

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

// ─── Derived mock numbers ────────────────────────────────────────────────────
const SP_TOTAL = TIDS.reduce((s, t) => s + t.spNet, 0);      // 35,600
const HO_TOTAL = TIDS.reduce((s, t) => s + t.hoNet, 0);      // 23,150
const OPENING_BAL = 50_000;
const RELOADS_TOTAL = 25_000;
const REFUNDS = -5_000;
const CLOSING_BAL = OPENING_BAL + RELOADS_TOTAL + REFUNDS;   // 70,000
const COMPUTED_PURCHASES = CLOSING_BAL - SP_TOTAL;            // 34,400
const ACTUAL_PURCHASES_DEFAULT = 34_000;
const ROW9_DEFAULT = ACTUAL_PURCHASES_DEFAULT - COMPUTED_PURCHASES; // -400

export function OptionA_ExpandActions() {
  // Existing state
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
  const [selectedTids, setSelectedTids] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<string | null>(null);
  const [bulkScope, setBulkScope] = useState<"all" | "selected">("all");

  // ── New state ──
  const [negativeSpVerified, setNegativeSpVerified] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [gSheetDone, setGSheetDone] = useState(false);
  const [excelDone, setExcelDone] = useState(false);
  const [lineItemsOpen, setLineItemsOpen] = useState(true);
  const [row10Open, setRow10Open] = useState(false);
  const [row11Open, setRow11Open] = useState(false);
  const [reloadsOpen, setReloadsOpen] = useState(false);
  const [actualTap, setActualTap] = useState(String(ACTUAL_PURCHASES_DEFAULT));
  const [insightTab, setInsightTab] = useState("already");
  const [expandedAlreadyRecon, setExpandedAlreadyRecon] = useState(false);
  const [expandedMismatch, setExpandedMismatch] = useState(false);
  const [expandedCancellations, setExpandedCancellations] = useState(false);

  const parsedTap = parseFloat(actualTap.replace(/,/g, "")) || 0;
  const row9 = parsedTap - COMPUTED_PURCHASES;

  const flash = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 2500); };
  const resolve = (tid: string) => setResolvedTids(prev => new Set(prev).add(tid));
  const resolveMultiple = (tids: string[]) => setResolvedTids(prev => { const next = new Set(prev); tids.forEach(t => next.add(t)); return next; });

  const toggleSelect = (tid: string) => {
    setSelectedTids(prev => {
      const next = new Set(prev);
      if (next.has(tid)) next.delete(tid); else next.add(tid);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const unresolvedTids = filteredTids.filter(t => !resolvedTids.has(t.tid));
    if (selectedTids.size === unresolvedTids.length) {
      setSelectedTids(new Set());
    } else {
      setSelectedTids(new Set(unresolvedTids.map(t => t.tid)));
    }
  };

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

  const getBulkTids = () => bulkScope === "all" ? TIDS.map(t => t.tid) : Array.from(selectedTids);
  const getBulkTidData = () => bulkScope === "all" ? TIDS : TIDS.filter(t => selectedTids.has(t.tid));

  const handleBulkAction = (action: string) => {
    const tids = getBulkTids();
    if (action === "ho" || action === "sp") {
      resolveMultiple(tids);
      flash(`${tids.length} TIDs → ${action === "sp" ? "SP" : "HO"} Net applied`);
      setSelectedTids(new Set());
      setBulkConfirm(null);
    } else if (action === "dispute") {
      flash(`Dispute raised for ${tids.length} TIDs`);
      setSelectedTids(new Set());
      setBulkConfirm(null);
    } else if (action === "issue") {
      flash(`Issue logged for ${tids.length} TIDs`);
      setSelectedTids(new Set());
      setBulkConfirm(null);
    }
  };

  const openDiscrepancyAction = (action: string) => { setBulkScope("all"); setBulkConfirm(action); };
  const openSelectionAction = (action: string) => { setBulkScope("selected"); setBulkConfirm(action); };

  const filteredTids = TIDS.filter(t => !tidSearch || t.tid.toLowerCase().includes(tidSearch.toLowerCase()) || t.experience.toLowerCase().includes(tidSearch.toLowerCase()));
  const resolvedCount = TIDS.filter(t => resolvedTids.has(t.tid)).length;
  const totalDisc = TIDS.reduce((s, t) => s + t.discUsd, 0);

  return (
    <div className="min-h-screen bg-background font-sans flex flex-col">
      {/* Header */}
      <div className="border-b bg-card px-5 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Reconciliation Summary — Vendor ABC · Jan 2026</span>
          <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">PORTAL_DEPOSIT</Badge>
          <Badge variant="outline" className="text-xs font-mono">BE: 10234</Badge>
        </div>
        <div className="flex items-center gap-2">
          {resolvedCount > 0 && <Badge className="text-xs bg-green-100 text-green-700 border-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />{resolvedCount}/{TIDS.length} resolved</Badge>}
          <Button
            size="sm"
            variant={isConfirmed ? "outline" : "default"}
            className={isConfirmed ? "text-green-600 border-green-500 hover:bg-green-50" : ""}
            onClick={() => setShowConfirmDialog(true)}
            data-testid="button-apply-confirm"
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            {isConfirmed ? "Confirmed ✓" : "Apply & Confirm"}
          </Button>
        </div>
      </div>

      {/* Feedback toast */}
      {feedback && (
        <div className="mx-4 mt-2 px-3 py-2 bg-green-50 border border-green-200 rounded-md flex items-center gap-2 text-sm text-green-700 animate-in fade-in duration-200">
          <CheckCircle2 className="h-4 w-4" />{feedback}
        </div>
      )}

      <div className="flex-1 overflow-auto flex flex-col">

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 1 — SUMMARY STRIP (4 stat cards)
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="px-4 pt-3 pb-2 grid grid-cols-4 gap-3 flex-shrink-0">
          <div className="rounded-lg border bg-card p-3" data-testid="card-net-diff">
            <div className="flex items-center gap-1.5 mb-1">
              <div className={`h-2 w-2 rounded-full ${row9 === 0 ? "bg-green-500" : "bg-red-500"}`} />
              <span className="text-xs text-muted-foreground">Net Difference</span>
            </div>
            <p className={`font-mono text-sm font-semibold ${row9 === 0 ? "text-green-600" : "text-red-600"}`}>{fmt(row9)} <span className="text-[10px] font-normal text-muted-foreground">EUR</span></p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{row9 === 0 ? "Balanced" : "Unbalanced"}</p>
          </div>
          <div className="rounded-lg border bg-card p-3" data-testid="card-row9">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingDown className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Difference (Row 9)</span>
            </div>
            <p className="font-mono text-sm font-semibold">{fmt(Math.abs(row9))} <span className="text-[10px] font-normal text-muted-foreground">EUR</span></p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Actual vs Computed</p>
          </div>
          <div className="rounded-lg border bg-card p-3" data-testid="card-discrepancies">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Discrepancies</span>
            </div>
            <p className="font-mono text-sm font-semibold">{TIDS.reduce((s, t) => s + t.bidCount, 0)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Row 10 + Row 11 items</p>
          </div>
          <div className="rounded-lg border bg-card p-3" data-testid="card-insights">
            <div className="flex items-center gap-1.5 mb-1">
              <FileWarning className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Insights</span>
            </div>
            <p className="font-mono text-sm font-semibold">3</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">5 reconciled, 3 mismatches, 8 cancelled</p>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 2 — WARNING BANNERS
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="px-4 pb-2 space-y-1.5 flex-shrink-0">
          {!negativeSpVerified && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50/70 border border-red-200 rounded-md text-xs" data-testid="banner-negative-sp">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />
              <span className="text-red-700">Negative SP Net refund bookings require verification before Apply &amp; Confirm. Check the verification box in the Negative SP reason group below.</span>
            </div>
          )}
          <div className="flex items-center gap-2 px-3 py-2 bg-violet-50/70 border border-violet-200 rounded-md text-xs" data-testid="banner-mismatch">
            <AlertTriangle className="h-3.5 w-3.5 text-violet-500 shrink-0" />
            <span className="text-violet-700">3 bookings with payment method mismatch — update Final Vendor ID in the Row 10/11 breakup.</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50/70 border border-blue-200 rounded-md text-xs" data-testid="banner-cross-currency">
            <AlertCircle className="h-3.5 w-3.5 text-blue-500 shrink-0" />
            <span className="text-blue-700">Cross-currency reconciliation: Summary values in <strong>EUR</strong> (balance/SP currency); transaction-level checks in <strong>USD</strong> (HO currency).</span>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 3 — DISCREPANCY ANALYSIS (violet collapsible panel)
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="flex-shrink-0 border-b border-t">
          <div className="flex items-center justify-between px-4 py-2 bg-violet-50/70 cursor-pointer hover:bg-violet-50" onClick={() => setAnalysisOpen(!analysisOpen)}>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-violet-600" />
              <span className="text-sm font-semibold text-violet-800">Discrepancy Analysis</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-violet-100 text-violet-700 border-violet-200">{TIDS.length} TIDs</Badge>
              <span className="text-[11px] text-violet-600">Click a row to jump to actions ↓</span>
            </div>
            {analysisOpen ? <PanelTopClose className="h-4 w-4 text-violet-500" /> : <PanelTop className="h-4 w-4 text-violet-500" />}
          </div>
          {analysisOpen && (
            <div className="max-h-[28vh] overflow-auto">
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
                    <TableRow key={t.tid} className={`h-9 cursor-pointer hover:bg-violet-50/60 ${resolvedTids.has(t.tid) ? "opacity-50" : ""}`} onClick={() => handleAnalysisClick(t.tid)}>
                      <TableCell className="py-1.5 pl-4 font-mono text-sm text-primary font-medium">
                        <div className="flex items-center gap-1.5">
                          {resolvedTids.has(t.tid) && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />}
                          {t.tid}
                        </div>
                      </TableCell>
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

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 4 — ACTION PANEL (TID list + bulk actions)
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="flex-1 overflow-auto px-4 pb-4 pt-2 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Actions</span>
              <Badge variant="secondary" className="text-xs">{TIDS.length} TIDs · Net Price Discrepancy</Badge>
            </div>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search TIDs..." className="h-8 pl-8 w-48 text-xs" value={tidSearch} onChange={e => setTidSearch(e.target.value)} />
            </div>
          </div>

          {/* Discrepancy-level strip */}
          {!bulkConfirm && (
            <div className="rounded-lg border bg-muted/30 px-3 py-2.5 flex items-center gap-2.5">
              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">All {TIDS.length} TIDs:</span>
              <div className="h-4 w-px bg-border" />
              <Button size="sm" className="h-7 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => openDiscrepancyAction("sp")}>
                <TrendingUp className="h-3 w-3" /> SP Net
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 text-green-700 border-green-300 hover:bg-green-50" onClick={() => openDiscrepancyAction("ho")}>
                <TrendingDown className="h-3 w-3" /> HO Net
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => openDiscrepancyAction("dispute")}>
                <Gavel className="h-3 w-3" /> Raise Dispute
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 text-orange-700 border-orange-300 hover:bg-orange-50" onClick={() => openDiscrepancyAction("issue")}>
                <FileWarning className="h-3 w-3" /> Log Issue
              </Button>
            </div>
          )}

          {/* Checkbox bulk bar */}
          {selectedTids.size >= 2 && !bulkConfirm && (
            <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3 flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center gap-2">
                <CheckCheck className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">{selectedTids.size} TIDs selected</span>
              </div>
              <div className="h-5 w-px bg-border" />
              <Button size="sm" className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => openSelectionAction("sp")}><TrendingUp className="h-3 w-3" /> SP Net</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-green-700 border-green-300 hover:bg-green-50" onClick={() => openSelectionAction("ho")}><TrendingDown className="h-3 w-3" /> HO Net</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => openSelectionAction("dispute")}><Gavel className="h-3 w-3" /> Dispute</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-orange-700 border-orange-300 hover:bg-orange-50" onClick={() => openSelectionAction("issue")}><FileWarning className="h-3 w-3" /> Issue</Button>
              <div className="flex-1" />
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedTids(new Set())}><XIcon className="h-3 w-3 mr-1" /> Clear</Button>
            </div>
          )}

          {/* Bulk confirm — SP/HO table */}
          {bulkConfirm && (bulkConfirm === "sp" || bulkConfirm === "ho") && (() => {
            const selectedTidData = getBulkTidData();
            const isSp = bulkConfirm === "sp";
            const totalPayable = selectedTidData.reduce((s, t) => s + (isSp ? t.spNet : t.hoNet), 0);
            const totalSp = selectedTidData.reduce((s, t) => s + t.spNet, 0);
            const totalHo = selectedTidData.reduce((s, t) => s + t.hoNet, 0);
            const totalDiscount = isSp ? totalSp - totalHo : 0;
            return (
              <div className="rounded-lg border-2 border-blue-200 bg-blue-50/60 p-3 space-y-3 animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-blue-800">
                    {isSp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    Bulk {isSp ? "SP Net" : "HO Net"} —{" "}
                    {bulkScope === "all" ? <span>All {selectedTidData.length} TIDs</span> : <span>{selectedTidData.length} selected TIDs</span>}
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setBulkConfirm(null)}><XIcon className="h-3.5 w-3.5" /></Button>
                </div>
                <div className="rounded-md border overflow-hidden bg-white">
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center h-7 bg-muted/30 px-3 text-[11px] font-medium text-muted-foreground border-b">
                    <div>TID</div>
                    <div className="text-right w-24 px-2 text-blue-600">SP Net</div>
                    <div className="text-right w-24 px-2 text-green-600">HO Net</div>
                    <div className="text-right w-24 px-2">Disc. LC</div>
                    <div className="text-right w-28 px-2 font-semibold text-foreground">Payable</div>
                  </div>
                  {selectedTidData.map(t => (
                    <div key={t.tid} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-3 h-8 border-b last:border-0 text-xs">
                      <div>
                        <span className="font-mono font-medium text-primary">{t.tid}</span>
                        <span className="text-muted-foreground ml-1.5 text-[10px]">{t.experience.slice(0, 22)}{t.experience.length > 22 ? "…" : ""}</span>
                      </div>
                      <div className={`text-right w-24 px-2 font-mono ${isSp ? "font-semibold text-blue-700" : "text-muted-foreground"}`}>{fmt(t.spNet)}</div>
                      <div className={`text-right w-24 px-2 font-mono ${!isSp ? "font-semibold text-green-700" : "text-muted-foreground"}`}>{fmt(t.hoNet)}</div>
                      <div className="text-right w-24 px-2 font-mono text-red-500">{fmt(t.discLc)}</div>
                      <div className={`text-right w-28 px-2 font-mono font-semibold ${isSp ? "text-blue-700" : "text-green-700"}`}>{fmt(isSp ? t.spNet : t.hoNet)}</div>
                    </div>
                  ))}
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-3 h-8 bg-muted/30 border-t text-xs font-semibold">
                    <div className="text-muted-foreground">Total ({selectedTidData.length} TIDs)</div>
                    <div className="text-right w-24 px-2 font-mono text-blue-600">{fmt(totalSp)}</div>
                    <div className="text-right w-24 px-2 font-mono text-green-600">{fmt(totalHo)}</div>
                    <div className="text-right w-24 px-2 font-mono text-red-500">{fmt(selectedTidData.reduce((s, t) => s + t.discLc, 0))}</div>
                    <div className={`text-right w-28 px-2 font-mono text-sm ${isSp ? "text-blue-700" : "text-green-700"}`}>{fmt(totalPayable)}</div>
                  </div>
                </div>
                {isSp && totalDiscount > 0 && (
                  <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                    <span className="text-amber-800">Paying <span className="font-mono font-semibold">{fmt(totalDiscount)}</span> above HO Net across {selectedTidData.length} TIDs — consider raising disputes.</span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBulkConfirm(null)}>Cancel</Button>
                  <Button size="sm" className={`h-7 text-xs gap-1 ${isSp ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}`} variant={isSp ? "default" : "outline"} onClick={() => handleBulkAction(bulkConfirm)}>
                    <Check className="h-3 w-3" /> Apply {isSp ? "SP Net" : "HO Net"} to {selectedTidData.length} TIDs
                  </Button>
                </div>
              </div>
            );
          })()}

          {/* Bulk confirm — dispute/issue badge list */}
          {bulkConfirm && bulkConfirm !== "sp" && bulkConfirm !== "ho" && (() => {
            const confirmTidData = getBulkTidData();
            return (
              <div className="rounded-lg border-2 border-amber-300 bg-amber-50/80 p-3 space-y-2 animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                    <AlertTriangle className="h-4 w-4" />
                    {bulkConfirm === "dispute" ? "Raise Dispute" : "Log Issue"} for {bulkScope === "all" ? `all ${confirmTidData.length}` : `${confirmTidData.length} selected`} TIDs
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setBulkConfirm(null)}><XIcon className="h-3.5 w-3.5" /></Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {confirmTidData.map(t => <Badge key={t.tid} variant="outline" className="text-xs font-mono">{t.tid}</Badge>)}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBulkConfirm(null)}>Cancel</Button>
                  <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleBulkAction(bulkConfirm)}>
                    <Check className="h-3 w-3" /> Confirm &amp; Apply
                  </Button>
                </div>
              </div>
            );
          })()}

          {/* TID list */}
          <div className="rounded-md border overflow-hidden">
            <div className="grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] gap-0 items-center h-8 bg-muted/40 px-3 text-xs font-medium text-muted-foreground border-b">
              <div className="w-7 flex items-center justify-center" onClick={e => { e.stopPropagation(); toggleSelectAll(); }}>
                <Checkbox checked={selectedTids.size > 0 && selectedTids.size === filteredTids.filter(t => !resolvedTids.has(t.tid)).length} className="h-3.5 w-3.5" />
              </div>
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
              const isSelected = selectedTids.has(tid.tid);
              const pct = ((tid.discUsd / totalDisc) * 100).toFixed(0);

              return (
                <div key={tid.tid} id={`a-tid-${tid.tid}`} className={`transition-all duration-500 ${isResolved ? "bg-green-50/40" : ""} ${isHighlighted ? "ring-2 ring-violet-400 ring-inset bg-violet-50/30" : ""} ${isSelected && !isResolved ? "bg-primary/5" : ""}`}>
                  <div className={`grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] gap-0 items-center px-3 h-11 cursor-pointer transition-colors hover:bg-muted/30 border-b ${isExpanded ? "bg-muted/20" : ""}`}
                    onClick={() => { setExpandedTid(isExpanded ? null : tid.tid); setShowPax(null); setShowSpConfirm(null); setDisputeChecked(false); }}>
                    <div className="w-7 flex items-center justify-center" onClick={e => { e.stopPropagation(); if (!isResolved) toggleSelect(tid.tid); }}>
                      {!isResolved && <Checkbox checked={isSelected} className="h-3.5 w-3.5" />}
                    </div>
                    <div className="w-5 flex items-center">
                      {isResolved ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div className="pl-2 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-sm font-medium text-primary">{tid.tid}</span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0">{tid.fm}</Badge>
                        {tid.soldAtLoss && <Badge variant="destructive" className="text-[10px] px-1 py-0">Loss</Badge>}
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
                      {/* Inline analysis chips */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs">
                          <span className="text-muted-foreground">Take Rate:</span>
                          <span className="font-mono font-medium">{tid.hoTakeRate}%</span>
                          <span className="text-muted-foreground">→</span>
                          <span className={`font-mono font-semibold ${tid.actualTakeRate < 0 ? "text-red-600" : tid.actualTakeRate < tid.hoTakeRate ? "text-amber-600" : "text-green-600"}`}>{tid.actualTakeRate}%</span>
                          <span className={`text-[10px] font-medium ${tid.discPercent.startsWith("-") ? "text-red-500" : "text-green-500"}`}>({tid.discPercent})</span>
                        </div>
                        <div className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs">
                          <span className="text-muted-foreground">Period:</span>
                          <span className="font-medium">{tid.startDate} – {tid.endDate}</span>
                        </div>
                        <div className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs">
                          <span className="text-muted-foreground">BIDs w/ disc:</span>
                          <span className="font-mono font-medium">{tid.bidCountWithDisc}/{tid.bidCountInDuration}</span>
                        </div>
                        {tid.soldAtLoss && (
                          <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs">
                            <AlertTriangle className="h-3 w-3 text-red-600" />
                            <span className="font-medium text-red-700">Sold at Loss</span>
                            <span className="font-mono font-semibold text-red-600">{fmt(tid.lossUsd)} USD</span>
                          </div>
                        )}
                      </div>

                      {/* TID action strip */}
                      {!showPax && !showSpConfirm && (
                        <div className="flex items-center gap-2 p-2 rounded-md bg-primary/5 border border-primary/10">
                          <span className="text-xs text-muted-foreground font-medium">{tid.tid}:</span>
                          <Button size="sm" className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setShowSpConfirm(tid.tid)}>
                            <TrendingUp className="h-3 w-3" /> SP Net
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-green-700 border-green-300 hover:bg-green-50" onClick={() => { resolve(tid.tid); flash(`${tid.tid} → HO Net applied`); setExpandedTid(null); }}>
                            <TrendingDown className="h-3 w-3" /> HO Net
                          </Button>
                          {tid.hasPax && (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-violet-700 border-violet-300 hover:bg-violet-50" onClick={() => { setShowPax(tid.tid); setShowSpConfirm(null); }}>
                              <Calculator className="h-3 w-3" /> Pax Pricing
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => { flash(`Dispute raised for ${tid.tid}`); }}>
                            <Gavel className="h-3 w-3" /> Dispute
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-orange-700 border-orange-300 hover:bg-orange-50" onClick={() => { flash(`Issue logged for ${tid.tid}`); }}>
                            <FileWarning className="h-3 w-3" /> Issue
                          </Button>
                        </div>
                      )}

                      {/* SP Net confirm */}
                      {showSpConfirm === tid.tid && (
                        <div className="rounded-md border border-blue-200 bg-blue-50/60 p-3 space-y-2 animate-in fade-in duration-200">
                          <div className="flex items-center gap-2 text-sm font-semibold text-blue-800">
                            <TrendingUp className="h-4 w-4" />
                            Apply SP Net to {tid.tid}
                          </div>
                          <div className="text-xs text-muted-foreground">Total Amount Payable will be set to SP Net: <span className="font-mono font-semibold text-blue-700">{fmt(tid.spNet)}</span> (overpaying by <span className="font-mono text-amber-600">{fmt(tid.discLc)}</span> vs HO Net)</div>
                          <div className="flex items-center gap-2 pt-1">
                            <div className="flex items-center gap-1.5">
                              <Checkbox checked={disputeChecked} onCheckedChange={v => setDisputeChecked(v === true)} />
                              <span className="text-xs">Raise dispute for difference</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowSpConfirm(null)}>Cancel</Button>
                            <Button size="sm" className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { resolve(tid.tid); flash(`${tid.tid} → SP Net applied${disputeChecked ? " + Dispute raised" : ""}`); setShowSpConfirm(null); setDisputeChecked(false); setExpandedTid(null); }}>
                              <Check className="h-3 w-3" /> Confirm
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Pax pricing */}
                      {showPax === tid.tid && (
                        <div className="rounded-md border border-violet-200 bg-violet-50/50 p-3 space-y-2 animate-in fade-in duration-200">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm font-semibold text-violet-800">
                              <Calculator className="h-4 w-4" /> Pax Pricing — {tid.tid}
                            </div>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShowPax(null)}><XIcon className="h-3.5 w-3.5" /></Button>
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow className="h-7">
                                <TableHead className="text-xs">Pax Type</TableHead>
                                <TableHead className="text-xs">Date Range</TableHead>
                                <TableHead className="text-xs text-right">Count</TableHead>
                                <TableHead className="text-xs text-right">SP Unit</TableHead>
                                <TableHead className="text-xs text-right">HO Unit</TableHead>
                                <TableHead className="text-xs text-right">Final Price</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {PAX_ROWS.map(r => (
                                <TableRow key={`${r.paxType}-${r.dateRange}`} className="h-8">
                                  <TableCell className="text-xs font-medium">{r.paxType}</TableCell>
                                  <TableCell className="text-xs font-mono text-muted-foreground">{r.dateRange}</TableCell>
                                  <TableCell className="text-xs text-right font-mono">{r.count}</TableCell>
                                  <TableCell className="text-xs text-right font-mono text-muted-foreground">{fmt(r.spUnit)}</TableCell>
                                  <TableCell className="text-xs text-right font-mono text-muted-foreground">{fmt(r.hoUnit)}</TableCell>
                                  <TableCell className="text-right">
                                    <Input type="number" placeholder="Enter" value={paxPrices[`${r.paxType}-${r.dateRange}`] ?? ""} onChange={e => setPaxPrices(p => ({ ...p, [`${r.paxType}-${r.dateRange}`]: e.target.value }))} className="w-24 text-xs font-mono text-right ml-auto h-7" />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowPax(null)}>Cancel</Button>
                            <Button size="sm" className="h-7 text-xs gap-1" disabled={PAX_ROWS.some(r => !paxPrices[`${r.paxType}-${r.dateRange}`])} onClick={() => { resolve(tid.tid); flash(`${tid.tid} → Pax prices applied`); setShowPax(null); setPaxPrices({}); setExpandedTid(null); }}>
                              <Check className="h-3 w-3" /> Apply Pax Prices
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Booking table */}
                      <div className="rounded-md border overflow-hidden">
                        <div className="grid grid-cols-[1fr_auto_auto] px-3 h-7 bg-muted/30 items-center border-b text-[11px] font-medium text-muted-foreground">
                          <div>Booking ID</div>
                          <div className="w-28 text-right px-2">SP Net</div>
                          <div className="w-28 text-right px-3">HO Net</div>
                        </div>
                        {BOOKINGS.map(b => (
                          <div key={b.bookingId} className={`grid grid-cols-[1fr_auto_auto] px-3 h-8 items-center border-b last:border-0 text-xs ${b.spNet > b.hoNet ? "bg-red-50/30" : ""}`}>
                            <div className="font-mono font-medium">{b.bookingId}</div>
                            <div className={`w-28 text-right px-2 font-mono ${b.spNet > b.hoNet ? "text-red-600 font-semibold" : ""}`}>{fmt(b.spNet)}</div>
                            <div className="w-28 text-right px-3 font-mono text-muted-foreground">{fmt(b.hoNet)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── ITEM 10 — Negative SP Verification checkbox ─────────────────── */}
          <div className={`rounded-lg border-2 p-3 transition-colors ${negativeSpVerified ? "border-green-300 bg-green-50/50" : "border-red-200 bg-red-50/30"}`} data-testid="negative-sp-verification">
            <div className="flex items-center gap-3">
              <div className={`flex items-center justify-center h-9 w-9 rounded-md flex-shrink-0 ${negativeSpVerified ? "bg-green-100" : "bg-red-100"}`}>
                {negativeSpVerified ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertTriangle className="h-5 w-5 text-red-500" />}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">Negative SP Net — Refund Verification</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  2 bookings with negative SP Net (Refund). Sub-types: <Badge variant="outline" className="text-[10px] px-1 py-0 text-muted-foreground">Zero HO ×1</Badge> <Badge variant="outline" className="text-[10px] px-1 py-0 text-amber-600 border-amber-300">Difference ×1</Badge>. TAP auto-computed as |SP − HO|.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox checked={negativeSpVerified} onCheckedChange={v => setNegativeSpVerified(v === true)} data-testid="checkbox-negative-sp-verified" />
                <span className="text-xs font-medium">{negativeSpVerified ? "Verified" : "I have verified all refund transactions"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 5 — 12-LINE ITEM TABLE (Balance & Deposits)
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="border-t mx-4 mb-3 rounded-lg border overflow-hidden" data-testid="line-items-table">
          <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 cursor-pointer hover:bg-muted/60" onClick={() => setLineItemsOpen(o => !o)}>
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Balance &amp; Deposits</span>
              <Badge variant="secondary" className="text-xs">PORTAL_DEPOSIT</Badge>
              <Badge variant="outline" className="text-xs font-mono">BE: 10234</Badge>
            </div>
            {lineItemsOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>

          {lineItemsOpen && (
            <div className="divide-y text-sm">
              {/* Row 1 — Opening Balance */}
              <div className="grid grid-cols-[auto_1fr_auto] px-4 py-2.5 items-center hover:bg-muted/20">
                <div className="w-8 text-xs text-muted-foreground font-mono">1</div>
                <div className="font-medium">Opening Balance</div>
                <div className="font-mono font-semibold text-right w-32">{fmt(OPENING_BAL)} <span className="text-xs font-normal text-muted-foreground">EUR</span></div>
              </div>

              {/* Row 2 — Reloads + Manage button */}
              <div>
                <div className="grid grid-cols-[auto_1fr_auto_auto] px-4 py-2.5 items-center hover:bg-muted/20">
                  <div className="w-8 text-xs text-muted-foreground font-mono">2</div>
                  <div>
                    <span className="font-medium">Reloads</span>
                    <span className="text-xs text-muted-foreground ml-2">3 transactions · Zendesk</span>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs mr-3" onClick={() => setReloadsOpen(o => !o)} data-testid="button-manage-reloads">
                    <RefreshCw className="h-3 w-3 mr-1" /> Manage
                  </Button>
                  <div className="font-mono font-semibold text-right w-32">
                    <Plus className="h-3 w-3 inline text-green-600 mr-0.5" />{fmt(RELOADS_TOTAL)} <span className="text-xs font-normal text-muted-foreground">EUR</span>
                  </div>
                </div>

                {/* Manage Reloads inline panel */}
                {reloadsOpen && (
                  <div className="mx-4 mb-3 rounded-md border border-dashed bg-muted/30 p-3 space-y-2 animate-in fade-in duration-200" data-testid="manage-reloads-panel">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">Reload Transactions</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Adjusted total: <span className="font-mono font-semibold text-foreground">{fmt(RELOADS_TOTAL)} EUR</span></span>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setReloadsOpen(false)}><XIcon className="h-3 w-3" /></Button>
                      </div>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow className="h-7">
                          <TableHead className="text-xs">Zendesk ID</TableHead>
                          <TableHead className="text-xs">Date of Payment</TableHead>
                          <TableHead className="text-xs text-right">Paid Amount</TableHead>
                          <TableHead className="text-xs">Currency</TableHead>
                          <TableHead className="text-xs text-right">Amount Loaded at Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {RELOAD_ROWS.map(r => (
                          <TableRow key={r.zendesk} className="h-8">
                            <TableCell className="text-xs font-mono">{r.zendesk}</TableCell>
                            <TableCell className="text-xs">{r.date}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{fmt(r.amount)}</TableCell>
                            <TableCell className="text-xs">{r.currency}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{fmt(r.loaded)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-xs text-muted-foreground">Add adjustment:</span>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => flash("Adjustment added")}><Plus className="h-3 w-3" /> Add</Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => flash("Subtraction added")}><Minus className="h-3 w-3" /> Subtract</Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Row 3 — Returns/Refunds */}
              <div className="grid grid-cols-[auto_1fr_auto] px-4 py-2.5 items-center hover:bg-muted/20">
                <div className="w-8 text-xs text-muted-foreground font-mono">3</div>
                <div className="font-medium">Less: Returns / Refunds</div>
                <div className="font-mono font-semibold text-right w-32 text-red-600">
                  <Minus className="h-3 w-3 inline mr-0.5" />{fmt(Math.abs(REFUNDS))} <span className="text-xs font-normal text-muted-foreground">EUR</span>
                </div>
              </div>

              {/* Row 4 — Closing Balance */}
              <div className="grid grid-cols-[auto_1fr_auto] px-4 py-2.5 items-center bg-muted/30 hover:bg-muted/40">
                <div className="w-8 text-xs text-muted-foreground font-mono">4</div>
                <div className="font-semibold">Closing Balance <span className="text-xs font-normal text-muted-foreground">(1 + 2 − 3)</span></div>
                <div className="font-mono font-bold text-right w-32">{fmt(CLOSING_BAL)} <span className="text-xs font-normal text-muted-foreground">EUR</span></div>
              </div>

              {/* Row 5 — Net SP */}
              <div className="grid grid-cols-[auto_1fr_auto] px-4 py-2.5 items-center hover:bg-muted/20">
                <div className="w-8 text-xs text-muted-foreground font-mono">5</div>
                <div className="font-medium">Net SP <span className="text-xs font-normal text-muted-foreground">(from SP Invoice)</span></div>
                <div className="font-mono font-semibold text-right w-32 text-blue-700">{fmt(SP_TOTAL)} <span className="text-xs font-normal text-muted-foreground">EUR</span></div>
              </div>

              {/* Row 6 — Difference (closing - SP) */}
              <div className="grid grid-cols-[auto_1fr_auto] px-4 py-2.5 items-center hover:bg-muted/20">
                <div className="w-8 text-xs text-muted-foreground font-mono">6</div>
                <div className="font-medium">Computed Purchases <span className="text-xs font-normal text-muted-foreground">(4 − 5)</span></div>
                <div className="font-mono font-semibold text-right w-32">{fmt(COMPUTED_PURCHASES)} <span className="text-xs font-normal text-muted-foreground">EUR</span></div>
              </div>

              {/* Row 7 — Actual Purchases (editable TAP) */}
              <div className="grid grid-cols-[auto_1fr_auto] px-4 py-2.5 items-center hover:bg-muted/20">
                <div className="w-8 text-xs text-muted-foreground font-mono">7</div>
                <div className="font-medium">Actual Purchases <span className="text-xs font-normal text-muted-foreground">(Total Amount Payable)</span></div>
                <div className="flex items-center gap-2 justify-end">
                  <Input
                    type="text"
                    value={actualTap}
                    onChange={e => setActualTap(e.target.value)}
                    className="w-32 h-7 font-mono text-right text-sm border-dashed hover:border-solid focus:border-solid"
                    data-testid="input-actual-purchases"
                  />
                  <span className="text-xs text-muted-foreground">EUR</span>
                </div>
              </div>

              {/* Row 8 — HO Net */}
              <div className="grid grid-cols-[auto_1fr_auto] px-4 py-2.5 items-center hover:bg-muted/20">
                <div className="w-8 text-xs text-muted-foreground font-mono">8</div>
                <div className="font-medium">HO Net <span className="text-xs font-normal text-muted-foreground">(from HO Report)</span></div>
                <div className="font-mono font-semibold text-right w-32 text-green-700">{fmt(HO_TOTAL)} <span className="text-xs font-normal text-muted-foreground">EUR</span></div>
              </div>

              {/* Row 9 — Net Difference */}
              <div className={`grid grid-cols-[auto_1fr_auto] px-4 py-2.5 items-center font-semibold ${row9 === 0 ? "bg-green-50/50" : "bg-red-50/30"}`}>
                <div className="w-8 text-xs text-muted-foreground font-mono">9</div>
                <div>
                  Net Difference <span className="text-xs font-normal text-muted-foreground">(7 − 6)</span>
                  {row9 !== 0 && <Badge variant="destructive" className="ml-2 text-[10px] px-1.5 py-0">Unbalanced</Badge>}
                  {row9 === 0 && <Badge className="ml-2 text-[10px] px-1.5 py-0 bg-green-100 text-green-700 border-green-200">Balanced</Badge>}
                </div>
                <div className={`font-mono font-bold text-right w-32 ${row9 === 0 ? "text-green-600" : "text-red-600"}`}>{fmt(row9)} <span className="text-xs font-normal text-muted-foreground">EUR</span></div>
              </div>

              {/* Row 10 — Breakup (discrepancy reasons) */}
              <div>
                <div className="grid grid-cols-[auto_1fr_auto_auto] px-4 py-2.5 items-center cursor-pointer hover:bg-muted/20" onClick={() => setRow10Open(o => !o)}>
                  <div className="w-8 text-xs text-muted-foreground font-mono">10</div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Row 10 Breakup</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">HO-side discrepancies</Badge>
                    <span className="text-xs text-muted-foreground">{TIDS.length} reason groups</span>
                  </div>
                  <div className="font-mono font-semibold text-right w-32 text-amber-700">{fmt(totalDisc)} <span className="text-xs font-normal text-muted-foreground">USD</span></div>
                  {row10Open ? <ChevronDown className="h-4 w-4 text-muted-foreground ml-2" /> : <ChevronRight className="h-4 w-4 text-muted-foreground ml-2" />}
                </div>
                {row10Open && (
                  <div className="mx-4 mb-2 rounded-md border overflow-hidden text-xs animate-in fade-in duration-200">
                    {[{ reason: "Net Price Discrepancy", tids: 4, disc: 13_496.61 }, { reason: "Negative SP - Partial Refund", tids: 2, disc: 1_200 }].map(r => (
                      <div key={r.reason} className="flex items-center justify-between px-3 h-9 border-b last:border-0 hover:bg-muted/30">
                        <span className="font-medium">{r.reason}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">{r.tids} TIDs</span>
                          <span className="font-mono font-semibold text-red-600">{fmt(r.disc)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Row 11 — SP Invoice breakup */}
              <div>
                <div className="grid grid-cols-[auto_1fr_auto_auto] px-4 py-2.5 items-center cursor-pointer hover:bg-muted/20" onClick={() => setRow11Open(o => !o)}>
                  <div className="w-8 text-xs text-muted-foreground font-mono">11</div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Row 11 Breakup</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">SP Invoice side</Badge>
                    <span className="text-xs text-muted-foreground">Secondary vendor + Unmapped</span>
                  </div>
                  <div className="font-mono font-semibold text-right w-32 text-orange-700">2,100.00 <span className="text-xs font-normal text-muted-foreground">EUR</span></div>
                  {row11Open ? <ChevronDown className="h-4 w-4 text-muted-foreground ml-2" /> : <ChevronRight className="h-4 w-4 text-muted-foreground ml-2" />}
                </div>
                {row11Open && (
                  <div className="mx-4 mb-2 rounded-md border overflow-hidden text-xs animate-in fade-in duration-200">
                    {[{ reason: "Secondary Vendor", tids: 1, disc: 1_400 }, { reason: "Unmapped", tids: 1, disc: 700 }].map(r => (
                      <div key={r.reason} className="flex items-center justify-between px-3 h-9 border-b last:border-0 hover:bg-muted/30">
                        <span className="font-medium">{r.reason}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">{r.tids} TID{r.tids !== 1 ? "s" : ""}</span>
                          <span className="font-mono font-semibold text-orange-700">{fmt(r.disc)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Row 12 — Grand Total */}
              <div className="grid grid-cols-[auto_1fr_auto] px-4 py-3 items-center bg-primary/5 border-t-2 border-primary/20">
                <div className="w-8 text-xs text-muted-foreground font-mono">12</div>
                <div className="font-bold text-base">Grand Total (TAP)</div>
                <div className="font-mono font-bold text-base text-right w-32 text-primary">{fmt(parsedTap)} <span className="text-xs font-normal text-muted-foreground">EUR</span></div>
              </div>
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 6 — INSIGHTS CARD (Already Reconciled / Mismatch / Cancellations)
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="mx-4 mb-3 rounded-lg border overflow-hidden" data-testid="insights-card">
          <div className="px-4 py-2.5 bg-muted/40 flex items-center gap-2">
            <FileWarning className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Insights</span>
            <Badge variant="secondary" className="text-xs">3 categories</Badge>
          </div>
          <Tabs value={insightTab} onValueChange={setInsightTab} className="p-3">
            <TabsList className="h-8 text-xs">
              <TabsTrigger value="already" className="text-xs h-7">Already Reconciled <Badge variant="secondary" className="ml-1.5 text-[10px]">5</Badge></TabsTrigger>
              <TabsTrigger value="mismatch" className="text-xs h-7">Payment Mismatch <Badge variant="secondary" className="ml-1.5 text-[10px]">3</Badge></TabsTrigger>
              <TabsTrigger value="cancellations" className="text-xs h-7">Cancellations <Badge variant="secondary" className="ml-1.5 text-[10px]">8</Badge></TabsTrigger>
            </TabsList>

            <TabsContent value="already" className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">5 bookings already reconciled with this vendor this period</span>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setExpandedAlreadyRecon(o => !o)}>
                  {expandedAlreadyRecon ? "Collapse" : "Show details"}
                  {expandedAlreadyRecon ? <ChevronDown className="h-3 w-3 ml-1" /> : <ChevronRight className="h-3 w-3 ml-1" />}
                </Button>
              </div>
              <div className="flex gap-3">
                <div className="rounded-md border bg-background p-2 flex-1">
                  <div className="text-[10px] text-muted-foreground mb-0.5">Same BE</div>
                  <div className="font-mono text-sm font-semibold">3</div>
                  <div className="text-[10px] text-muted-foreground">1,800.00 EUR</div>
                </div>
                <div className="rounded-md border bg-background p-2 flex-1">
                  <div className="text-[10px] text-muted-foreground mb-0.5">Different BE</div>
                  <div className="font-mono text-sm font-semibold">2</div>
                  <div className="text-[10px] text-muted-foreground">500.00 EUR</div>
                </div>
                <div className="rounded-md border bg-primary/5 p-2 flex-1">
                  <div className="text-[10px] text-muted-foreground mb-0.5">Total</div>
                  <div className="font-mono text-sm font-semibold">2,300.00</div>
                  <div className="text-[10px] text-muted-foreground">EUR</div>
                </div>
              </div>
              {expandedAlreadyRecon && (
                <div className="rounded-md border overflow-hidden text-xs animate-in fade-in duration-200">
                  {["BID-2001", "BID-2002", "BID-2003"].map(bid => (
                    <div key={bid} className="flex items-center justify-between px-3 h-8 border-b last:border-0">
                      <span className="font-mono">{bid}</span>
                      <Badge variant="outline" className="text-[10px]">Same BE</Badge>
                      <span className="font-mono">600.00 EUR</span>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="mismatch" className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">3 bookings where HO and SP payment methods differ</span>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setExpandedMismatch(o => !o)}>
                  {expandedMismatch ? "Collapse" : "Show details"}
                  {expandedMismatch ? <ChevronDown className="h-3 w-3 ml-1" /> : <ChevronRight className="h-3 w-3 ml-1" />}
                </Button>
              </div>
              <div className="rounded-md border border-violet-200 bg-violet-50/40 p-2 text-xs text-violet-700">
                Update <strong>Final Vendor ID</strong> in the Row 10/11 breakup for each TID with mismatched bookings.
              </div>
              {expandedMismatch && (
                <div className="rounded-md border overflow-hidden text-xs animate-in fade-in duration-200">
                  {[{ bid: "BID-3001", ho: "PORTAL_DEPOSIT", sp: "CREDIT_CARD" }, { bid: "BID-3002", ho: "PORTAL_DEPOSIT", sp: "BANK_TRANSFER" }].map(r => (
                    <div key={r.bid} className="grid grid-cols-[1fr_1fr_1fr] px-3 h-9 border-b last:border-0 items-center">
                      <span className="font-mono">{r.bid}</span>
                      <Badge variant="outline" className="text-[10px] w-fit">HO: {r.ho}</Badge>
                      <Badge variant="outline" className="text-[10px] w-fit text-violet-600 border-violet-300">SP: {r.sp}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="cancellations" className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">8 cancellation bookings across 3 types</span>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setExpandedCancellations(o => !o)}>
                  {expandedCancellations ? "Collapse" : "Show details"}
                  {expandedCancellations ? <ChevronDown className="h-3 w-3 ml-1" /> : <ChevronRight className="h-3 w-3 ml-1" />}
                </Button>
              </div>
              <div className="flex gap-3">
                {[{ type: "Refund OK", count: 4, amt: "2,400.00" }, { type: "No Refund", count: 2, amt: "900.00" }, { type: "Partial", count: 2, amt: "800.00" }].map(c => (
                  <div key={c.type} className="rounded-md border bg-background p-2 flex-1">
                    <div className="text-[10px] text-muted-foreground mb-0.5">{c.type}</div>
                    <div className="font-mono text-sm font-semibold">{c.count}</div>
                    <div className="text-[10px] text-muted-foreground">{c.amt} EUR</div>
                  </div>
                ))}
              </div>
              {expandedCancellations && (
                <div className="rounded-md border overflow-hidden text-xs animate-in fade-in duration-200">
                  {["BID-4001", "BID-4002", "BID-4003"].map(bid => (
                    <div key={bid} className="flex items-center justify-between px-3 h-8 border-b last:border-0">
                      <span className="font-mono">{bid}</span>
                      <Badge variant="outline" className="text-[10px]">Refund OK</Badge>
                      <span className="font-mono">600.00 EUR</span>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 7 — APPLY & CONFIRM / EXPORT (bottom bar)
        ═══════════════════════════════════════════════════════════════════ */}
        {showConfirmDialog && (
          <div className="mx-4 mb-3 rounded-lg border-2 border-primary/30 bg-primary/5 p-4 space-y-3 animate-in fade-in duration-200" data-testid="confirm-dialog">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <span className="text-sm font-semibold">Confirm Purchase Reconciliation</span>
              </div>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setShowConfirmDialog(false)}><XIcon className="h-4 w-4" /></Button>
            </div>
            <p className="text-sm text-muted-foreground">This will lock in the current values and enable the financial report export.</p>

            {!negativeSpVerified && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-sm text-amber-800">
                  <span className="font-medium">Negative SP Net bookings not yet verified.</span>{" "}
                  Please verify all refund transactions in the reason group above before confirming.
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <Button size="sm" variant="ghost" onClick={() => setShowConfirmDialog(false)}>Cancel</Button>
              <Button
                size="sm"
                disabled={!negativeSpVerified}
                onClick={() => { setIsConfirmed(true); setShowConfirmDialog(false); flash("Reconciliation confirmed — export now available"); }}
                data-testid="button-yes-confirm"
              >
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Yes, confirm
              </Button>
            </div>
          </div>
        )}

        {isConfirmed && (
          <div className="mx-4 mb-4 rounded-lg border border-green-200 bg-green-50/60 p-3 flex items-center gap-3 flex-wrap animate-in fade-in duration-200" data-testid="export-bar">
            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
            <span className="text-sm font-medium text-green-800 flex-1">Reconciliation confirmed. Export the financial report:</span>
            <Button
              size="sm"
              onClick={() => { setExcelDone(true); flash("Excel exported successfully"); }}
              variant={excelDone ? "outline" : "default"}
              className={excelDone ? "text-green-600 border-green-400" : ""}
              data-testid="button-export-excel"
            >
              {excelDone ? <Check className="h-3.5 w-3.5 mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
              Export Excel
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setGSheetDone(true); flash("Google Sheet created"); }}
              className={gSheetDone ? "text-green-600 border-green-400" : ""}
              data-testid="button-export-gsheet"
            >
              {gSheetDone ? <Check className="h-3.5 w-3.5 mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
              Export Google Sheets
            </Button>
            {gSheetDone && (
              <a href="#" className="text-sm text-primary underline underline-offset-2 hover:opacity-80 font-medium flex items-center gap-1" data-testid="link-open-gsheet">
                Open Google Sheet <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
