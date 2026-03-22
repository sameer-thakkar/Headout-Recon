import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  XCircle, AlertTriangle, ChevronRight, ArrowLeft,
  CheckCircle2, X as XIcon, TrendingUp, TrendingDown, Check, Zap,
} from "lucide-react";

const fmt = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── Sort order (mirrors server/export-routes.ts) ──────────────────────────
const CANCELLATION_SORT_ORDER: Record<string, number> = {
  "Cancelled-SP error":              0,
  "Cancelled-Check for Charge loss": 1,
  "Cancelled-DSS policy":            2,
  "Cancelled-OK":                    3,
  "Cancelled-Insured Booking":       4,
  "Cancelled-Refund OK":             5,
};
const sortKey = (sub: string) => CANCELLATION_SORT_ORDER[sub] ?? 99;

// ─── Types ─────────────────────────────────────────────────────────────────
interface BreakupRow {
  rowKey: string;
  subCategory: string;
  cancellable: string;
  spNetLc: number;
  hoNetLc: number;
  cancellationInsurance: string;
  chargeLoss: string;
  actionPoint: string;
  driTeam: string;
  fulfillment: string;
  bidCount: number;
  startDate: string;
  endDate: string;
  totalBids: number;
  discLc: number;
  discUsd: number;
  tidConcentration: string;
  hasActions: boolean;
}

interface PaxRow { paxType: string; dateRange: string; count: number; spUnit: number; hoUnit: number; }

interface TidRow {
  tid: string;
  bidCount: number;
  spNetLc: number;
  discLc: number;
  discUsd: number;
  fulfillment: string;
  driTeam: string;
  hasPax: boolean;
  hasActions: boolean;
  paxRows: PaxRow[];
}

type TakeActionState = {
  rowKey: string;
  step: 1 | 2 | 3;
  priceChoice: "sp" | "ho" | null;
  tidOverrides: Record<string, "sp" | "ho" | "pax">;
  paxExpandedTid: string | null;
  paxPrices: Record<string, string>;
  disputeTids: Set<string>;
  disputeAmounts: Record<string, string>;
  issueTids: Set<string>;
} | null;

// ─── Mock Breakup Data (sorted by CANCELLATION_SORT_ORDER) ─────────────────
const MOCK_BREAKUP_RAW: BreakupRow[] = [
  {
    rowKey: "sp-error", subCategory: "Cancelled-SP error", hasActions: true,
    cancellable: "Yes", spNetLc: 20160, hoNetLc: 0,
    cancellationInsurance: "N/A", chargeLoss: "",
    actionPoint: "Check why did we cancel the booking with SP? If cancelled on time — raise with SP, if delayed — raise with RO.",
    driTeam: "Tech / Res Ops", fulfillment: "Mixed", bidCount: 13,
    startDate: "02/01/2026", endDate: "20/01/2026", totalBids: 80,
    discLc: -20160, discUsd: -234.44, tidConcentration: "TID-40021, TID-40031",
  },
  {
    rowKey: "charge-loss-freesale", subCategory: "Cancelled-Check for Charge loss", hasActions: true,
    cancellable: "No", spNetLc: 8970, hoNetLc: 0,
    cancellationInsurance: "No", chargeLoss: "FALSE",
    actionPoint: "Raise this with RO — why is this not marked as Charge loss TRUE?",
    driTeam: "Tech", fulfillment: "Freesale", bidCount: 6,
    startDate: "07/01/2026", endDate: "22/01/2026", totalBids: 40,
    discLc: -8970, discUsd: -104.30, tidConcentration: "TID-50011, TID-50012",
  },
  {
    rowKey: "dss-freesale", subCategory: "Cancelled-DSS policy", hasActions: false,
    cancellable: "No", spNetLc: 3120, hoNetLc: 0,
    cancellationInsurance: "No", chargeLoss: "TRUE",
    actionPoint: "Covered under DSS policy",
    driTeam: "N/A", fulfillment: "Freesale", bidCount: 3,
    startDate: "12/01/2026", endDate: "28/01/2026", totalBids: 20,
    discLc: -3120, discUsd: -36.28, tidConcentration: "",
  },
  {
    rowKey: "ok-freesale", subCategory: "Cancelled-OK", hasActions: false,
    cancellable: "", spNetLc: 0, hoNetLc: 0,
    cancellationInsurance: "N/A", chargeLoss: "",
    actionPoint: "No action needed",
    driTeam: "N/A", fulfillment: "Freesale", bidCount: 12,
    startDate: "01/01/2026", endDate: "30/01/2026", totalBids: 60,
    discLc: 0, discUsd: 0, tidConcentration: "",
  },
  {
    rowKey: "insured-freesale", subCategory: "Cancelled-Insured Booking", hasActions: false,
    cancellable: "No", spNetLc: 6250, hoNetLc: 0,
    cancellationInsurance: "Yes", chargeLoss: "",
    actionPoint: "Claim from insurance",
    driTeam: "N/A", fulfillment: "Freesale", bidCount: 5,
    startDate: "10/01/2026", endDate: "25/01/2026", totalBids: 30,
    discLc: -6250, discUsd: -72.67, tidConcentration: "",
  },
  {
    rowKey: "refund-ok-freesale", subCategory: "Cancelled-Refund OK", hasActions: false,
    cancellable: "", spNetLc: -2340, hoNetLc: 0,
    cancellationInsurance: "", chargeLoss: "",
    actionPoint: "No action needed",
    driTeam: "N/A", fulfillment: "Freesale", bidCount: 4,
    startDate: "03/01/2026", endDate: "15/01/2026", totalBids: 18,
    discLc: 0, discUsd: 0, tidConcentration: "",
  },
];

const MOCK_BREAKUP = [...MOCK_BREAKUP_RAW].sort((a, b) => sortKey(a.subCategory) - sortKey(b.subCategory));

// ─── Mock TIDs per breakup row ──────────────────────────────────────────────
const MOCK_TIDS: Record<string, TidRow[]> = {
  "sp-error": [
    {
      tid: "TID-40021", bidCount: 5, spNetLc: 8250, discLc: -8250, discUsd: -95.94,
      fulfillment: "Freesale", driTeam: "Tech", hasPax: true, hasActions: true,
      paxRows: [
        { paxType: "Adult", dateRange: "02/01 - 12/01", count: 6, spUnit: 825, hoUnit: 0 },
        { paxType: "Adult", dateRange: "13/01 - 18/01", count: 2, spUnit: 840, hoUnit: 0 },
        { paxType: "Child", dateRange: "02/01 - 18/01", count: 2, spUnit: 550, hoUnit: 0 },
      ],
    },
    {
      tid: "TID-40022", bidCount: 3, spNetLc: 4890, discLc: -4890, discUsd: -56.87,
      fulfillment: "Freesale", driTeam: "Tech", hasPax: false, hasActions: true,
      paxRows: [],
    },
    {
      tid: "TID-40023", bidCount: 1, spNetLc: 1680, discLc: -1680, discUsd: -19.53,
      fulfillment: "Freesale", driTeam: "Tech", hasPax: false, hasActions: true,
      paxRows: [],
    },
    {
      tid: "TID-40031", bidCount: 2, spNetLc: 3240, discLc: -3240, discUsd: -37.67,
      fulfillment: "Manual", driTeam: "Reservation Ops", hasPax: true, hasActions: true,
      paxRows: [
        { paxType: "Adult", dateRange: "05/01 - 20/01", count: 2, spUnit: 1620, hoUnit: 0 },
      ],
    },
    {
      tid: "TID-40032", bidCount: 2, spNetLc: 2100, discLc: -2100, discUsd: -24.42,
      fulfillment: "Manual", driTeam: "Reservation Ops", hasPax: false, hasActions: true,
      paxRows: [],
    },
  ],
  "charge-loss-freesale": [
    {
      tid: "TID-50011", bidCount: 4, spNetLc: 5880, discLc: -5880, discUsd: -68.37,
      fulfillment: "Freesale", driTeam: "Tech", hasPax: true, hasActions: true,
      paxRows: [
        { paxType: "Adult", dateRange: "07/01 - 18/01", count: 8, spUnit: 735, hoUnit: 0 },
      ],
    },
    {
      tid: "TID-50012", bidCount: 2, spNetLc: 3090, discLc: -3090, discUsd: -35.93,
      fulfillment: "Freesale", driTeam: "Tech", hasPax: false, hasActions: true,
      paxRows: [],
    },
  ],
  "dss-freesale": [
    { tid: "TID-70011", bidCount: 2, spNetLc: 2080, discLc: -2080, discUsd: -24.19, fulfillment: "Freesale", driTeam: "N/A", hasPax: false, hasActions: false, paxRows: [] },
    { tid: "TID-70012", bidCount: 1, spNetLc: 1040, discLc: -1040, discUsd: -12.09, fulfillment: "Freesale", driTeam: "N/A", hasPax: false, hasActions: false, paxRows: [] },
  ],
  "ok-freesale": [
    { tid: "TID-80011", bidCount: 5, spNetLc: 0, discLc: 0, discUsd: 0, fulfillment: "Freesale", driTeam: "N/A", hasPax: false, hasActions: false, paxRows: [] },
    { tid: "TID-80012", bidCount: 4, spNetLc: 0, discLc: 0, discUsd: 0, fulfillment: "Freesale", driTeam: "N/A", hasPax: false, hasActions: false, paxRows: [] },
  ],
  "insured-freesale": [
    { tid: "TID-60011", bidCount: 3, spNetLc: 3750, discLc: -3750, discUsd: -43.60, fulfillment: "Freesale", driTeam: "N/A", hasPax: false, hasActions: false, paxRows: [] },
    { tid: "TID-60012", bidCount: 2, spNetLc: 2500, discLc: -2500, discUsd: -29.07, fulfillment: "Freesale", driTeam: "N/A", hasPax: false, hasActions: false, paxRows: [] },
  ],
  "refund-ok-freesale": [
    { tid: "TID-90011", bidCount: 2, spNetLc: -1560, discLc: 0, discUsd: 0, fulfillment: "Freesale", driTeam: "N/A", hasPax: false, hasActions: false, paxRows: [] },
    { tid: "TID-90012", bidCount: 2, spNetLc: -780, discLc: 0, discUsd: 0, fulfillment: "Freesale", driTeam: "N/A", hasPax: false, hasActions: false, paxRows: [] },
  ],
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function subCategoryBadge(sub: string) {
  const colors: Record<string, string> = {
    "Cancelled-SP error":              "bg-red-100 text-red-700 border-red-200",
    "Cancelled-Check for Charge loss": "bg-orange-100 text-orange-700 border-orange-200",
    "Cancelled-Insured Booking":       "bg-blue-100 text-blue-700 border-blue-200",
    "Cancelled-DSS policy":            "bg-violet-100 text-violet-700 border-violet-200",
    "Cancelled-OK":                    "bg-green-100 text-green-700 border-green-200",
    "Cancelled-Refund OK":             "bg-emerald-100 text-emerald-700 border-emerald-200",
  };
  const cls = colors[sub] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-medium text-[11px] ${cls}`}>
      <XCircle className="h-2.5 w-2.5 shrink-0" />
      {sub}
    </span>
  );
}

function computePaxTotal(tid: TidRow, paxPrices: Record<string, string>): number {
  if (tid.paxRows.length === 0) return Math.abs(tid.spNetLc);
  return tid.paxRows.reduce((sum, pr) => {
    const key = `${tid.tid}__${pr.paxType}__${pr.dateRange}`;
    const entered = parseFloat(paxPrices[key] ?? "");
    const unitPrice = isNaN(entered) ? pr.spUnit : entered;
    return sum + unitPrice * pr.count;
  }, 0);
}

function getAppliedPrice(
  tid: TidRow,
  priceChoice: "sp" | "ho",
  overrides: Record<string, "sp" | "ho" | "pax">,
  paxPrices: Record<string, string>,
): number {
  const ov = overrides[tid.tid];
  if (ov === "sp") return Math.abs(tid.spNetLc);
  if (ov === "ho") return 0;
  if (ov === "pax") return computePaxTotal(tid, paxPrices);
  return priceChoice === "sp" ? Math.abs(tid.spNetLc) : 0;
}

// Step indicator sub-component
function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: "Net Price" },
    { n: 2, label: "Disputes" },
    { n: 3, label: "Issues" },
  ];
  return (
    <div className="flex items-center gap-0 shrink-0">
      {steps.map((s, i) => {
        const done = s.n < step;
        const active = s.n === step;
        return (
          <div key={s.n} className="flex items-center">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors
              ${active ? "bg-primary text-primary-foreground" : done ? "text-green-600" : "text-muted-foreground"}`}>
              {done
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                : <span className={`h-5 w-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold shrink-0
                    ${active ? "border-primary-foreground text-primary-foreground" : "border-current"}`}>{s.n}</span>
              }
              {s.label}
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px w-8 mx-1 ${s.n < step ? "bg-green-400" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────
export function CancellationsWorkspace() {
  const [takeAction, setTakeAction] = useState<TakeActionState>(null);
  const [doneRows, setDoneRows] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  // Amount Payable table state
  const [committedDisputes, setCommittedDisputes] = useState<Record<string, number>>({});
  const [tapOverrides, setTapOverrides] = useState<Record<string, string>>({});
  const [tapConfirmedRows, setTapConfirmedRows] = useState<Set<string>>(new Set());

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const totalDiscLc = MOCK_BREAKUP.reduce((s, r) => s + r.discLc, 0);
  const totalDiscUsd = MOCK_BREAKUP.reduce((s, r) => s + r.discUsd, 0);
  const totalBidCount = MOCK_BREAKUP.reduce((s, r) => s + r.bidCount, 0);

  const selectedRow = takeAction ? MOCK_BREAKUP.find(r => r.rowKey === takeAction.rowKey) ?? null : null;
  const selectedTids = takeAction ? (MOCK_TIDS[takeAction.rowKey] ?? []) : [];

  // Computed totals for the bottom bar
  const totalPayable = takeAction && takeAction.priceChoice
    ? selectedTids.reduce((s, t) => s + getAppliedPrice(t, takeAction.priceChoice!, takeAction.tidOverrides, takeAction.paxPrices), 0)
    : 0;
  const totalDisputeAmt = takeAction
    ? [...takeAction.disputeTids].reduce((s, tid) => {
        const amt = parseFloat(takeAction.disputeAmounts[tid] ?? "0") || 0;
        return s + amt;
      }, 0)
    : 0;
  const disputeCount = takeAction ? takeAction.disputeTids.size : 0;
  const issueCount = takeAction ? takeAction.issueTids.size : 0;

  const openTakeAction = (rowKey: string) => {
    const tids = MOCK_TIDS[rowKey] ?? [];
    const row = MOCK_BREAKUP.find(r => r.rowKey === rowKey)!;
    // pre-init disputes: all tids selected, amounts default to SP Net
    const disputeTids = new Set(tids.map(t => t.tid));
    const disputeAmounts: Record<string, string> = {};
    tids.forEach(t => { disputeAmounts[t.tid] = String(Math.abs(t.spNetLc)); });
    setTakeAction({
      rowKey,
      step: 1,
      priceChoice: null,
      tidOverrides: {},
      paxExpandedTid: null,
      paxPrices: {},
      disputeTids,
      disputeAmounts,
      issueTids: new Set(),
    });
  };

  const goToStep = (step: 1 | 2 | 3) => {
    if (!takeAction) return;
    // When advancing to step 2, sync dispute amounts from price choice
    if (step === 2 && takeAction.priceChoice) {
      // Only seed amounts for TIDs that have never been touched; preserve manual edits
      const amounts: Record<string, string> = { ...takeAction.disputeAmounts };
      selectedTids.forEach(t => {
        if (!(t.tid in amounts)) {
          amounts[t.tid] = getAppliedPrice(t, takeAction.priceChoice!, takeAction.tidOverrides, takeAction.paxPrices).toFixed(2);
        }
      });
      setTakeAction(prev => prev ? { ...prev, step, disputeAmounts: amounts } : prev);
    } else {
      setTakeAction(prev => prev ? { ...prev, step } : prev);
    }
  };

  const confirmAction = () => {
    if (!takeAction || !selectedRow) return;
    const rowKey = takeAction.rowKey;
    // Persist total dispute amount for this sub-category into the Amount Payable table
    const totalDisp = [...takeAction.disputeTids].reduce((s, tid) => {
      const amt = parseFloat(takeAction.disputeAmounts[tid] ?? "0") || 0;
      return s + amt;
    }, 0);
    setCommittedDisputes(prev => ({ ...prev, [rowKey]: totalDisp }));
    // Clear any previously confirmed TAP override so it recomputes from new dispute total
    setTapConfirmedRows(prev => { const next = new Set(prev); next.delete(rowKey); return next; });
    setTapOverrides(prev => { const next = { ...prev }; delete next[rowKey]; return next; });
    const m = selectedRow.bidCount;
    const d = disputeCount;
    const i = issueCount;
    showToast(`Applied — ${m} bookings · ${d} dispute${d !== 1 ? "s" : ""} raised · ${i} issue${i !== 1 ? "s" : ""} logged`);
    setDoneRows(prev => new Set(prev).add(rowKey));
    setTakeAction(null);
  };

  const updateTA = (patch: Partial<NonNullable<TakeActionState>>) => {
    setTakeAction(prev => prev ? { ...prev, ...patch } : prev);
  };

  // Returns live dispute total for a rowKey (live if panel open, committed otherwise)
  const liveDispute = (rowKey: string): number => {
    if (takeAction?.rowKey === rowKey) {
      return [...takeAction.disputeTids].reduce((s, tid) => {
        const amt = parseFloat(takeAction.disputeAmounts[tid] ?? "0") || 0;
        return s + amt;
      }, 0);
    }
    return committedDisputes[rowKey] ?? 0;
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background font-sans flex flex-col text-sm">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="border-b bg-card px-5 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <XCircle className="h-4 w-4 text-red-500" />
            <span className="font-semibold text-sm tracking-tight">Cancellations — Manage</span>
            <Badge variant="outline" className="text-xs font-mono">BE-4521 · Musement</Badge>
            <Badge variant="outline" className="text-xs font-mono">EUR</Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{totalBidCount} bookings</span>
            <span className="font-mono font-semibold text-red-600">{fmt(Math.abs(totalDiscUsd))} USD discrepancy</span>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* ══ SECTION 1: Analysis Breakup Table ══════════════════════════ */}
          <div
            className="border-b overflow-auto shrink-0 transition-all"
            style={{ maxHeight: takeAction ? "40%" : "55%" }}
          >
            <div className="px-5 pt-4 pb-2">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wide">Cancellation Breakup</span>
                  <Badge variant="secondary" className="text-xs">{MOCK_BREAKUP.length} rows</Badge>
                </div>
              </div>

              <div className="rounded-md border overflow-hidden flex flex-col">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10">
                      <TableRow className="h-8 bg-muted/90">
                        {["Sub category","Cancellable","SP Net (LC)","HO Net (LC)","Cancellation Insurance","Charge Loss","Action point","DRI Team","Fulfillment","BID Count","Start Date","End Date","Total BIDs","Discrepancy (LC)","Discrepancy (USD)","TID Concentration"].map((h, i) => (
                          <TableHead key={h} className={`py-1.5 text-xs font-medium bg-muted/90 whitespace-nowrap
                            ${i === 0 ? "pl-3 min-w-[200px]" : ""}
                            ${[2,3,9,12,13,14].includes(i) ? "text-right" : [1,4,5].includes(i) ? "text-center" : ""}
                          `}>{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {MOCK_BREAKUP.map((row) => {
                        const isDone = doneRows.has(row.rowKey);
                        const isActive = takeAction?.rowKey === row.rowKey;
                        return (
                          <TableRow
                            key={row.rowKey}
                            className={`h-10 text-xs transition-colors
                              ${isActive ? "bg-blue-50/70 border-l-2 border-l-blue-400" : "hover:bg-muted/20"}
                              ${isDone ? "bg-green-50/40" : ""}
                            `}
                          >
                            <TableCell className="py-1.5 pl-3 font-medium whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                {isDone && <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />}
                                {subCategoryBadge(row.subCategory)}
                              </div>
                            </TableCell>
                            <TableCell className="py-1.5 text-center whitespace-nowrap">
                              {row.cancellable && (
                                <Badge variant={row.cancellable === "Yes" ? "outline" : "secondary"} className="text-xs py-0">{row.cancellable}</Badge>
                              )}
                            </TableCell>
                            <TableCell className="py-1.5 text-right font-mono whitespace-nowrap">{row.spNetLc !== 0 ? fmt(row.spNetLc) : "—"}</TableCell>
                            <TableCell className="py-1.5 text-right font-mono whitespace-nowrap">—</TableCell>
                            <TableCell className="py-1.5 text-center whitespace-nowrap">
                              {row.cancellationInsurance && (
                                <span className={`text-xs font-medium ${row.cancellationInsurance === "Yes" ? "text-blue-600" : "text-muted-foreground"}`}>{row.cancellationInsurance}</span>
                              )}
                            </TableCell>
                            <TableCell className="py-1.5 text-center whitespace-nowrap">
                              {row.chargeLoss && (
                                <Badge variant="secondary" className={`text-xs py-0 ${row.chargeLoss === "FALSE" ? "border-orange-200 bg-orange-50 text-orange-700" : "border-green-200 bg-green-50 text-green-700"}`}>{row.chargeLoss}</Badge>
                              )}
                            </TableCell>
                            <TableCell className="py-1.5 max-w-[200px]">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="truncate text-xs text-muted-foreground">{row.actionPoint}</div>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-[280px] text-xs">{row.actionPoint}</TooltipContent>
                              </Tooltip>
                            </TableCell>
                            <TableCell className="py-1.5 whitespace-nowrap">
                              <span className={`text-xs ${row.driTeam === "N/A" ? "text-muted-foreground" : "font-medium"}`}>{row.driTeam}</span>
                            </TableCell>
                            <TableCell className="py-1.5 whitespace-nowrap text-xs">{row.fulfillment}</TableCell>
                            <TableCell className="py-1.5 text-right font-mono">{row.bidCount}</TableCell>
                            <TableCell className="py-1.5 whitespace-nowrap font-mono text-xs">{row.startDate}</TableCell>
                            <TableCell className="py-1.5 whitespace-nowrap font-mono text-xs">{row.endDate}</TableCell>
                            <TableCell className="py-1.5 text-right font-mono">{row.totalBids}</TableCell>
                            <TableCell className={`py-1.5 text-right font-mono whitespace-nowrap ${row.discLc < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                              {row.discLc !== 0 ? fmt(row.discLc) : "—"}
                            </TableCell>
                            <TableCell className={`py-1.5 text-right font-mono whitespace-nowrap ${row.discUsd < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                              {row.discUsd !== 0 ? fmt(row.discUsd) : "—"}
                            </TableCell>
                            <TableCell className="py-1.5 font-mono text-xs text-muted-foreground whitespace-nowrap">{row.tidConcentration || "—"}</TableCell>

                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {/* Pinned total */}
                <div className="border-t-2 bg-muted/60 px-3 py-1.5 grid grid-cols-[200px_auto_1fr_auto_auto_auto_auto_auto_auto_auto_auto_auto_auto_auto_auto_auto] items-center text-xs font-semibold">
                  <span>Total</span>
                  <span />
                  <span className="text-right font-mono">{fmt(MOCK_BREAKUP.reduce((s,r)=>s+r.spNetLc,0))}</span>
                  <span className="text-right font-mono px-2">—</span>
                  <span /><span />
                  <span className="px-2 min-w-[200px]" />
                  <span /><span />
                  <span className="text-right font-mono px-2">{totalBidCount}</span>
                  <span /><span />
                  <span className="text-right font-mono px-2">{MOCK_BREAKUP.reduce((s,r)=>s+r.totalBids,0)}</span>
                  <span className={`text-right font-mono px-2 ${totalDiscLc < 0 ? "text-red-600" : ""}`}>{fmt(totalDiscLc)}</span>
                  <span className={`text-right font-mono px-2 ${totalDiscUsd < 0 ? "text-red-600" : ""}`}>{fmt(totalDiscUsd)}</span>
                  <span />
                </div>
              </div>
            </div>
          </div>

          {/* ══ SECTION 2: Amount Payable (idle) / 3-step panel (active) ══════ */}
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* ── Active action: 3-step panel ──────────────────────────────── */}
            {takeAction && selectedRow && (
              <div className="flex-1 flex flex-col overflow-hidden">

              {/* Panel header */}
              <div className="px-5 py-2.5 border-b bg-card shrink-0 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Stepper step={takeAction.step} />
                  <div className="text-xs text-muted-foreground shrink-0">
                    · {selectedTids.length} TIDs · {selectedRow.bidCount} bookings
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {subCategoryBadge(selectedRow.subCategory)}
                  {selectedRow.actionPoint !== "No action needed" && (
                    <div className="hidden sm:flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 max-w-[300px]">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span className="truncate">{selectedRow.actionPoint}</span>
                    </div>
                  )}
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setTakeAction(null)}>
                    <XIcon className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Step content */}
              <div className="flex-1 overflow-auto">

                {/* ── STEP 1: Net Price ─────────────────────────────────── */}
                {takeAction.step === 1 && (
                  <div className="px-5 py-4 space-y-4">
                    <div>
                      <div className="text-sm font-semibold mb-0.5">What should be paid for these {selectedRow.bidCount} bookings?</div>
                      <div className="text-xs text-muted-foreground">Select the correct price for all TIDs, then override per-TID if needed.</div>
                    </div>

                    {/* Price choice cards */}
                    <div className="grid grid-cols-2 gap-3">
                      {/* Pay SP Net */}
                      <button
                        onClick={() => updateTA({ priceChoice: "sp" })}
                        className={`rounded-lg border-2 p-4 text-left transition-all cursor-pointer
                          ${takeAction.priceChoice === "sp"
                            ? "border-blue-500 bg-blue-50"
                            : "border-border hover:border-blue-300 hover:bg-blue-50/40"}`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`h-7 w-7 rounded-md flex items-center justify-center ${takeAction.priceChoice === "sp" ? "bg-blue-200" : "bg-blue-100"}`}>
                            <TrendingUp className="h-4 w-4 text-blue-600" />
                          </div>
                          <span className="text-sm font-semibold text-blue-900">Pay SP Net</span>
                          {takeAction.priceChoice === "sp" && <Check className="h-4 w-4 text-blue-600 ml-auto" />}
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">Accept the cancellation charge as billed by SP</p>
                        <p className="font-mono font-semibold text-blue-700">{fmt(Math.abs(selectedRow.spNetLc))} EUR</p>
                      </button>

                      {/* Zero Out */}
                      <button
                        onClick={() => updateTA({ priceChoice: "ho" })}
                        className={`rounded-lg border-2 p-4 text-left transition-all cursor-pointer
                          ${takeAction.priceChoice === "ho"
                            ? "border-green-500 bg-green-50"
                            : "border-border hover:border-green-300 hover:bg-green-50/40"}`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`h-7 w-7 rounded-md flex items-center justify-center ${takeAction.priceChoice === "ho" ? "bg-green-200" : "bg-green-100"}`}>
                            <TrendingDown className="h-4 w-4 text-green-600" />
                          </div>
                          <span className="text-sm font-semibold text-green-900">Zero Out (HO Net)</span>
                          {takeAction.priceChoice === "ho" && <Check className="h-4 w-4 text-green-600 ml-auto" />}
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">Do not pay this charge — set payable to 0</p>
                        <p className="font-mono font-semibold text-green-700">0.00 EUR</p>
                      </button>
                    </div>

                    {/* TID list — shown after a price choice */}
                    {takeAction.priceChoice && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">TID Breakdown</span>
                          <span className="text-xs text-muted-foreground">Override individual TIDs or enable Pax Pricing</span>
                        </div>
                        <div className="rounded-md border overflow-hidden">
                          <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center h-8 bg-muted/40 px-3 text-xs font-medium text-muted-foreground border-b gap-2">
                            <div>TID / Fulfillment</div>
                            <div className="text-right w-24">SP Net</div>
                            <div className="text-right w-10">BIDs</div>
                            <div className="text-right w-24">Applied Price</div>
                            <div className="w-36">Override</div>
                            <div className="w-3" />
                          </div>

                          {selectedTids.map(tid => {
                            const ov = takeAction.tidOverrides[tid.tid];
                            const applied = getAppliedPrice(tid, takeAction.priceChoice!, takeAction.tidOverrides, takeAction.paxPrices);
                            const isPaxExpanded = takeAction.paxExpandedTid === tid.tid;

                            return (
                              <div key={tid.tid} className="border-b last:border-0">
                                <div className={`grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center px-3 h-10 gap-2 transition-colors ${isPaxExpanded ? "bg-violet-50/60" : "hover:bg-muted/20"}`}>
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="font-mono text-sm font-medium text-primary truncate">{tid.tid}</span>
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">{tid.fulfillment}</Badge>
                                  </div>
                                  <div className="text-right w-24 font-mono text-sm text-blue-700">{fmt(Math.abs(tid.spNetLc))}</div>
                                  <div className="text-right w-10 text-sm">{tid.bidCount}</div>
                                  <div className={`text-right w-24 font-mono text-sm font-semibold flex items-center justify-end gap-1 ${ov === "pax" ? "text-violet-600" : applied === 0 ? "text-green-600" : "text-blue-600"}`}>
                                    {fmt(applied)}
                                    {ov === "pax" && <span className="text-[10px] font-normal bg-violet-100 text-violet-700 px-1 rounded leading-4">pax</span>}
                                  </div>
                                  <div className="w-36">
                                    <Select
                                      value={ov ?? "follow"}
                                      onValueChange={val => {
                                        const newOverrides = { ...takeAction.tidOverrides };
                                        if (val === "follow") delete newOverrides[tid.tid];
                                        else newOverrides[tid.tid] = val as "sp" | "ho" | "pax";
                                        const newPaxExpanded = val === "pax" ? tid.tid : (takeAction.paxExpandedTid === tid.tid ? null : takeAction.paxExpandedTid);
                                        updateTA({ tidOverrides: newOverrides, paxExpandedTid: newPaxExpanded });
                                      }}
                                    >
                                      <SelectTrigger className="h-7 text-xs">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="follow">
                                          Follow global ({takeAction.priceChoice === "sp" ? "SP Net" : "HO Net"})
                                        </SelectItem>
                                        <SelectItem value="sp">SP Net</SelectItem>
                                        <SelectItem value="ho">HO Net (0)</SelectItem>
                                        {tid.hasPax && <SelectItem value="pax">Pax Pricing</SelectItem>}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="w-3" />
                                </div>

                                {/* Inline pax sub-table */}
                                {isPaxExpanded && (
                                  <div className="px-4 py-3 bg-violet-50/40 border-t border-violet-100 space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-medium text-violet-700">Pax Pricing — {tid.tid}</span>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-6 text-xs"
                                        onClick={() => updateTA({ paxExpandedTid: null })}
                                      >
                                        <Check className="h-3 w-3 mr-1" /> Apply Pax
                                      </Button>
                                    </div>
                                    <div className="rounded-md border overflow-hidden bg-background">
                                      <Table>
                                        <TableHeader>
                                          <TableRow className="h-7 bg-muted/30">
                                            <TableHead className="py-1 text-xs pl-3">Pax Type</TableHead>
                                            <TableHead className="py-1 text-xs">Date Range</TableHead>
                                            <TableHead className="py-1 text-xs text-right">Count</TableHead>
                                            <TableHead className="py-1 text-xs text-right">SP Unit</TableHead>
                                            <TableHead className="py-1 text-xs text-right">HO Unit</TableHead>
                                            <TableHead className="py-1 text-xs text-right pr-3">Final Price</TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {tid.paxRows.map(pr => {
                                            const key = `${tid.tid}__${pr.paxType}__${pr.dateRange}`;
                                            return (
                                              <TableRow key={key} className="h-8">
                                                <TableCell className="py-1 pl-3 text-xs font-medium">{pr.paxType}</TableCell>
                                                <TableCell className="py-1 text-xs text-muted-foreground">{pr.dateRange}</TableCell>
                                                <TableCell className="py-1 text-right text-xs">{pr.count}</TableCell>
                                                <TableCell className="py-1 text-right font-mono text-xs text-blue-600">{fmt(pr.spUnit)}</TableCell>
                                                <TableCell className="py-1 text-right font-mono text-xs text-green-600">{fmt(pr.hoUnit)}</TableCell>
                                                <TableCell className="py-1 text-right pr-3">
                                                  <Input
                                                    className="h-6 w-20 text-xs text-right font-mono ml-auto border-dashed"
                                                    value={takeAction.paxPrices[key] ?? ""}
                                                    onChange={e => updateTA({ paxPrices: { ...takeAction.paxPrices, [key]: e.target.value } })}
                                                    placeholder={String(pr.spUnit)}
                                                  />
                                                </TableCell>
                                              </TableRow>
                                            );
                                          })}
                                        </TableBody>
                                      </Table>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Running total */}
                        <div className="flex items-center justify-end gap-2 text-xs pt-1">
                          <span className="text-muted-foreground">Total Payable:</span>
                          <span className="font-mono font-semibold text-foreground">{fmt(totalPayable)} EUR</span>
                          <span className="text-muted-foreground">· {selectedTids.length} TIDs · {selectedRow.bidCount} bookings</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── STEP 2: Disputes ─────────────────────────────────── */}
                {takeAction.step === 2 && (
                  <div className="px-5 py-4 space-y-3">
                    <div>
                      <div className="text-sm font-semibold mb-0.5">Which TIDs should have a dispute raised?</div>
                      <div className="text-xs text-muted-foreground">Cancellation charge to be claimed from SP / RO. Amounts default to the applied price from Step 1.</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" className="h-6 text-xs"
                        onClick={() => updateTA({ disputeTids: new Set(selectedTids.map(t => t.tid)) })}>
                        Select all
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-xs"
                        onClick={() => updateTA({ disputeTids: new Set() })}>
                        Deselect all
                      </Button>
                    </div>

                    <div className="rounded-md border overflow-hidden">
                      <div className="grid grid-cols-[auto_1fr_auto_auto_auto_1fr] items-center h-8 bg-muted/40 px-3 text-xs font-medium text-muted-foreground border-b gap-2">
                        <div className="w-4" />
                        <div>TID / Fulfillment</div>
                        <div className="text-right w-24">Applied Price</div>
                        <div className="text-right w-28">Dispute Amount</div>
                        <div className="w-2" />
                        <div>Reason</div>
                      </div>

                      {selectedTids.map(tid => {
                        const checked = takeAction.disputeTids.has(tid.tid);
                        const appliedPrice = takeAction.priceChoice
                          ? getAppliedPrice(tid, takeAction.priceChoice, takeAction.tidOverrides, takeAction.paxPrices)
                          : Math.abs(tid.spNetLc);
                        return (
                          <div key={tid.tid} className={`grid grid-cols-[auto_1fr_auto_auto_auto_1fr] items-center px-3 h-11 border-b last:border-0 gap-2 transition-colors ${checked ? "bg-amber-50/40" : "bg-background opacity-60"}`}>
                            <Checkbox
                              checked={checked}
                              onCheckedChange={v => {
                                const next = new Set(takeAction.disputeTids);
                                v ? next.add(tid.tid) : next.delete(tid.tid);
                                updateTA({ disputeTids: next });
                              }}
                              className="h-4 w-4"
                            />
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-mono text-sm font-medium text-primary">{tid.tid}</span>
                              <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">{tid.fulfillment}</Badge>
                            </div>
                            <div className="text-right w-24 font-mono text-xs text-blue-700">{fmt(appliedPrice)}</div>
                            <div className="w-28">
                              <Input
                                disabled={!checked}
                                className="h-7 text-xs text-right font-mono border-dashed"
                                value={takeAction.disputeAmounts[tid.tid] ?? ""}
                                onChange={e => updateTA({ disputeAmounts: { ...takeAction.disputeAmounts, [tid.tid]: e.target.value } })}
                              />
                            </div>
                            <div className="w-2" />
                            <div className="text-xs text-muted-foreground truncate">Cancellation charge to be claimed from SP / RO</div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-end gap-2 text-xs pt-1">
                      <span className="text-muted-foreground">Disputes:</span>
                      <span className="font-mono font-semibold text-amber-700">{disputeCount} TIDs · {fmt(totalDisputeAmt)} EUR</span>
                    </div>
                  </div>
                )}

                {/* ── STEP 3: Issues ───────────────────────────────────── */}
                {takeAction.step === 3 && (
                  <div className="px-5 py-4 space-y-3">
                    <div>
                      <div className="text-sm font-semibold mb-0.5">Which TIDs need an internal issue logged?</div>
                      <div className="text-xs text-muted-foreground">Internal tracking — check with Finance / RO. DRI teams are pre-filled based on fulfillment type.</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" className="h-6 text-xs"
                        onClick={() => updateTA({ issueTids: new Set(selectedTids.map(t => t.tid)) })}>
                        Select all
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-xs"
                        onClick={() => updateTA({ issueTids: new Set() })}>
                        Deselect all
                      </Button>
                    </div>

                    <div className="rounded-md border overflow-hidden">
                      <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center h-8 bg-muted/40 px-3 text-xs font-medium text-muted-foreground border-b gap-2">
                        <div className="w-4" />
                        <div>TID</div>
                        <div className="w-36">DRI Team</div>
                        <div className="w-24">Fulfillment</div>
                        <div className="text-right w-10">BIDs</div>
                      </div>

                      {selectedTids.map(tid => {
                        const checked = takeAction.issueTids.has(tid.tid);
                        return (
                          <div key={tid.tid} className={`grid grid-cols-[auto_1fr_auto_auto_auto] items-center px-3 h-10 border-b last:border-0 gap-2 transition-colors ${checked ? "bg-orange-50/40" : "bg-background opacity-60"}`}>
                            <Checkbox
                              checked={checked}
                              onCheckedChange={v => {
                                const next = new Set(takeAction.issueTids);
                                v ? next.add(tid.tid) : next.delete(tid.tid);
                                updateTA({ issueTids: next });
                              }}
                              className="h-4 w-4"
                            />
                            <span className="font-mono text-sm font-medium text-primary">{tid.tid}</span>
                            <div className="w-36">
                              <Badge variant="outline" className={`text-xs ${tid.driTeam !== "N/A" ? "bg-blue-50 text-blue-700 border-blue-200" : ""}`}>
                                {tid.driTeam}
                              </Badge>
                            </div>
                            <div className="w-24 text-xs text-muted-foreground">{tid.fulfillment}</div>
                            <div className="text-right w-10 text-sm">{tid.bidCount}</div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-end gap-2 text-xs pt-1">
                      <span className="text-muted-foreground">Issues:</span>
                      <span className="font-mono font-semibold text-orange-700">{issueCount} TIDs</span>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Persistent bottom bar ─────────────────────────────────── */}
              <div className="border-t bg-card px-5 py-3 shrink-0 space-y-2">
                {/* Live summary */}
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Pay:</span>
                    <span className={`font-mono font-semibold ${takeAction.priceChoice ? "text-blue-700" : "text-muted-foreground"}`}>
                      {takeAction.priceChoice ? `${fmt(totalPayable)} EUR` : "—"}
                    </span>
                  </div>
                  <div className="h-3 w-px bg-border" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Disputes:</span>
                    <span className={`font-mono font-semibold ${disputeCount > 0 ? "text-amber-700" : "text-muted-foreground"}`}>
                      {disputeCount > 0 ? `${disputeCount} TIDs · ${fmt(totalDisputeAmt)} EUR` : "none"}
                    </span>
                  </div>
                  <div className="h-3 w-px bg-border" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Issues:</span>
                    <span className={`font-mono font-semibold ${issueCount > 0 ? "text-orange-700" : "text-muted-foreground"}`}>
                      {issueCount > 0 ? `${issueCount} TIDs` : "none"}
                    </span>
                  </div>
                </div>
                {/* Navigation */}
                <div className="flex items-center justify-between">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (takeAction.step === 1) setTakeAction(null);
                      else goToStep((takeAction.step - 1) as 1 | 2 | 3);
                    }}
                  >
                    <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                    {takeAction.step === 1 ? "Close" : "Back"}
                  </Button>

                  <span className="text-xs text-muted-foreground">Step {takeAction.step} of 3</span>

                  {takeAction.step < 3 ? (
                    <Button
                      size="sm"
                      disabled={takeAction.step === 1 && !takeAction.priceChoice}
                      onClick={() => goToStep((takeAction.step + 1) as 2 | 3)}
                    >
                      Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  ) : (
                    <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={confirmAction}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Confirm & Apply
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ══ Amount Payable Summary Table ════════════════════════════════ */}
            {!takeAction && (
            <div className="flex-1 overflow-auto">
            {/* Sticky sub-header */}
            <div className="px-5 pt-2.5 pb-1.5 flex items-center gap-2 sticky top-0 bg-background z-10 border-b">
              <span className="text-xs font-semibold uppercase tracking-wide">Amount Payable</span>
              <Badge variant="secondary" className="text-xs">{MOCK_BREAKUP.length} rows</Badge>
              <span className="ml-auto text-xs text-muted-foreground">Confirm payable amount · click ⚡ to raise disputes &amp; log issues</span>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="h-7 bg-muted/50">
                  {[
                    { label: "Sub Category",         cls: "pl-3 min-w-[200px]",  align: "" },
                    { label: "BID Count",            cls: "",                    align: "text-right" },
                    { label: "SP Net LC",            cls: "",                    align: "text-right" },
                    { label: "HO Net LC",            cls: "",                    align: "text-right" },
                    { label: "Disc. LC",             cls: "",                    align: "text-right" },
                    { label: "Disc. USD",            cls: "",                    align: "text-right" },
                    { label: "Dispute Raised",       cls: "",                    align: "text-right" },
                    { label: "Total Amount Payable", cls: "min-w-[200px]",       align: "text-right" },
                    { label: "Action",               cls: "pr-3 text-center",    align: "" },
                  ].map(col => (
                    <TableHead key={col.label} className={`py-1 text-xs font-medium bg-muted/50 whitespace-nowrap ${col.align} ${col.cls}`}>
                      {col.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>

              <TableBody>
                {MOCK_BREAKUP.map(row => {
                  const disputeAmt = liveDispute(row.rowKey);
                  const defaultTap = Math.max(0, row.spNetLc - disputeAmt);
                  const tapStr = tapOverrides[row.rowKey] !== undefined
                    ? tapOverrides[row.rowKey]
                    : defaultTap.toFixed(2);
                  const isConfirmed = tapConfirmedRows.has(row.rowKey);
                  const isDone = doneRows.has(row.rowKey);
                  return (
                    <TableRow
                      key={row.rowKey}
                      className={`h-8 text-xs ${isConfirmed ? "bg-green-50/70 dark:bg-green-950/20" : ""}`}
                    >
                      <TableCell className="py-1 pl-3">{subCategoryBadge(row.subCategory)}</TableCell>
                      <TableCell className="py-1 text-right font-mono">{row.bidCount}</TableCell>
                      <TableCell className={`py-1 text-right font-mono ${row.spNetLc > 0 ? "text-red-600" : row.spNetLc < 0 ? "text-green-600" : ""}`}>
                        {fmt(row.spNetLc)}
                      </TableCell>
                      <TableCell className="py-1 text-right font-mono">{fmt(row.hoNetLc)}</TableCell>
                      <TableCell className={`py-1 text-right font-mono ${row.discLc < 0 ? "text-red-600" : row.discLc > 0 ? "text-green-600" : ""}`}>
                        {fmt(row.discLc)}
                      </TableCell>
                      <TableCell className={`py-1 text-right font-mono ${row.discUsd < 0 ? "text-red-600" : row.discUsd > 0 ? "text-green-600" : ""}`}>
                        {fmt(row.discUsd)}
                      </TableCell>
                      <TableCell className="py-1 text-right font-mono">
                        {disputeAmt > 0
                          ? <span className="text-amber-600 font-semibold">{fmt(disputeAmt)}</span>
                          : <span className="text-muted-foreground">—</span>
                        }
                      </TableCell>
                      <TableCell className="py-1 pr-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <Input
                            className="h-6 w-28 text-right text-xs font-mono py-0 px-2"
                            value={tapStr}
                            onChange={e => {
                              setTapOverrides(prev => ({ ...prev, [row.rowKey]: e.target.value }));
                              setTapConfirmedRows(prev => { const n = new Set(prev); n.delete(row.rowKey); return n; });
                            }}
                          />
                          <Button
                            size="sm"
                            variant={isConfirmed ? "ghost" : "outline"}
                            className={`h-6 w-6 p-0 shrink-0 ${isConfirmed ? "text-green-600 hover:text-green-700" : ""}`}
                            onClick={() => {
                              const parsed = parseFloat(tapStr);
                              setTapOverrides(prev => ({ ...prev, [row.rowKey]: isNaN(parsed) ? "0.00" : parsed.toFixed(2) }));
                              setTapConfirmedRows(prev => new Set(prev).add(row.rowKey));
                            }}
                            title={isConfirmed ? "Confirmed" : "Confirm this amount"}
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                      {/* ── Action cell ─────────────────────────────────── */}
                      <TableCell className="py-1 pr-3 text-center">
                        {row.hasActions ? (
                          isDone ? (
                            <Badge className="gap-1 bg-green-50 text-green-700 border-green-200 hover:bg-green-50 text-[11px] font-medium px-2 py-0.5">
                              <CheckCircle2 className="h-3 w-3" /> Done
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              className="h-7 text-xs gap-1 bg-primary hover:bg-primary/90 text-primary-foreground"
                              onClick={() => openTakeAction(row.rowKey)}
                            >
                              <Zap className="h-3 w-3" /> Take Action
                            </Button>
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>

              {/* ── Totals footer ─────────────────────────────────────────── */}
              <tfoot>
                <tr className="border-t-2 bg-muted/40 text-xs font-semibold">
                  <td className="py-2 pl-3">Totals</td>
                  <td className="py-2 text-right font-mono pr-2">{MOCK_BREAKUP.reduce((s, r) => s + r.bidCount, 0)}</td>
                  <td className="py-2 text-right font-mono pr-2 text-red-600">
                    {fmt(MOCK_BREAKUP.reduce((s, r) => s + r.spNetLc, 0))}
                  </td>
                  <td className="py-2 text-right font-mono pr-2">
                    {fmt(MOCK_BREAKUP.reduce((s, r) => s + r.hoNetLc, 0))}
                  </td>
                  <td className={`py-2 text-right font-mono pr-2 ${totalDiscLc < 0 ? "text-red-600" : ""}`}>
                    {fmt(totalDiscLc)}
                  </td>
                  <td className={`py-2 text-right font-mono pr-2 ${totalDiscUsd < 0 ? "text-red-600" : ""}`}>
                    {fmt(totalDiscUsd)}
                  </td>
                  <td className="py-2 text-right font-mono pr-2 text-amber-600">
                    {(() => {
                      const tot = MOCK_BREAKUP.reduce((s, r) => s + liveDispute(r.rowKey), 0);
                      return tot > 0 ? fmt(tot) : "—";
                    })()}
                  </td>
                  <td className="py-2 text-right font-mono pr-2">
                    {fmt(MOCK_BREAKUP.reduce((s, r) => {
                      const d = liveDispute(r.rowKey);
                      const def = Math.max(0, r.spNetLc - d);
                      return s + (parseFloat(tapOverrides[r.rowKey] ?? def.toFixed(2)) || 0);
                    }, 0))}
                  </td>
                  <td className="py-2 pr-3" />
                </tr>
              </tfoot>
            </Table>
            </div>
            )}

          </div>
        </div>

        {/* ── Toast ──────────────────────────────────────────────────────── */}
        {toast && (
          <div className="fixed bottom-4 right-4 flex items-center gap-2 bg-foreground text-background text-xs px-3 py-2 rounded shadow-lg z-50">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
            {toast}
            <button onClick={() => setToast(null)} className="ml-1 opacity-60 hover:opacity-100">
              <XIcon className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export default CancellationsWorkspace;
