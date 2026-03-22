import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  XCircle, ChevronDown, ChevronRight, AlertTriangle, Info,
  CheckCircle2, X as XIcon, ArrowLeft, TrendingUp, TrendingDown,
  Calculator, Gavel, FileWarning, Check,
} from "lucide-react";

const fmt = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── Sort order (mirrors server/export-routes.ts) ──────────────────────────
const CANCELLATION_SORT_ORDER: Record<string, number> = {
  "Cancelled-SP error":              0,
  "Cancelled-Check for Charge loss": 1,
  "Cancelled-DSS policy":            2,
  "Cancelled-OK":                    3,
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
  bookings: { bookingId: string; experienceDate: string; spNet: number; hoNet: number; pax: string }[];
  paxRows: PaxRow[];
}

type WorkspaceView =
  | null
  | { level: "subcat"; rowKey: string }
  | { level: "subcat-spnet"; rowKey: string }
  | { level: "tid-spnet"; rowKey: string; tid: string }
  | { level: "tid-pax"; rowKey: string; tid: string };

// ─── Mock Breakup Data (sorted by CANCELLATION_SORT_ORDER) ─────────────────
const MOCK_BREAKUP_RAW: BreakupRow[] = [
  {
    rowKey: "sp-error-freesale", subCategory: "Cancelled-SP error", hasActions: true,
    cancellable: "Yes", spNetLc: 14820, hoNetLc: 0,
    cancellationInsurance: "N/A", chargeLoss: "",
    actionPoint: "Check why did we cancel the booking with SP? If cancelled on time- raise with SP, if cancellation was delayed- Raise with RO.",
    driTeam: "Tech", fulfillment: "Freesale", bidCount: 9,
    startDate: "02/01/2026", endDate: "18/01/2026", totalBids: 52,
    discLc: -14820, discUsd: -172.34, tidConcentration: "TID-40021",
  },
  {
    rowKey: "sp-error-manual", subCategory: "Cancelled-SP error", hasActions: true,
    cancellable: "Yes", spNetLc: 5340, hoNetLc: 0,
    cancellationInsurance: "N/A", chargeLoss: "",
    actionPoint: "Check why did we cancel the booking with SP? If cancelled on time- raise with SP, if cancellation was delayed- Raise with RO.",
    driTeam: "Reservation Ops", fulfillment: "Manual", bidCount: 4,
    startDate: "05/01/2026", endDate: "20/01/2026", totalBids: 28,
    discLc: -5340, discUsd: -62.10, tidConcentration: "TID-40031",
  },
  {
    rowKey: "charge-loss-freesale", subCategory: "Cancelled-Check for Charge loss", hasActions: true,
    cancellable: "No", spNetLc: 8970, hoNetLc: 0,
    cancellationInsurance: "No", chargeLoss: "FALSE",
    actionPoint: "Raise this with RO why this is not marked as Charge loss TRUE",
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
  "sp-error-freesale": [
    {
      tid: "TID-40021", bidCount: 5, spNetLc: 8250, discLc: -8250, discUsd: -95.94,
      fulfillment: "Freesale", driTeam: "Tech", hasPax: true, hasActions: true,
      bookings: [
        { bookingId: "BID-201001", experienceDate: "05/01/2026", spNet: 1650, hoNet: 0, pax: "2 Adults" },
        { bookingId: "BID-201002", experienceDate: "06/01/2026", spNet: 1650, hoNet: 0, pax: "1 Adult, 1 Child" },
        { bookingId: "BID-201003", experienceDate: "08/01/2026", spNet: 1720, hoNet: 0, pax: "2 Adults" },
        { bookingId: "BID-201004", experienceDate: "12/01/2026", spNet: 1680, hoNet: 0, pax: "2 Adults" },
        { bookingId: "BID-201005", experienceDate: "18/01/2026", spNet: 1550, hoNet: 0, pax: "1 Adult, 1 Child" },
      ],
      paxRows: [
        { paxType: "Adult", dateRange: "02/01 - 12/01", count: 6, spUnit: 825, hoUnit: 0 },
        { paxType: "Adult", dateRange: "13/01 - 18/01", count: 2, spUnit: 840, hoUnit: 0 },
        { paxType: "Child", dateRange: "02/01 - 18/01", count: 2, spUnit: 550, hoUnit: 0 },
      ],
    },
    {
      tid: "TID-40022", bidCount: 3, spNetLc: 4890, discLc: -4890, discUsd: -56.87,
      fulfillment: "Freesale", driTeam: "Tech", hasPax: false, hasActions: true,
      bookings: [
        { bookingId: "BID-201011", experienceDate: "09/01/2026", spNet: 1680, hoNet: 0, pax: "2 Adults" },
        { bookingId: "BID-201012", experienceDate: "11/01/2026", spNet: 1530, hoNet: 0, pax: "2 Adults" },
        { bookingId: "BID-201013", experienceDate: "14/01/2026", spNet: 1680, hoNet: 0, pax: "2 Adults" },
      ],
      paxRows: [],
    },
    {
      tid: "TID-40023", bidCount: 1, spNetLc: 1680, discLc: -1680, discUsd: -19.53,
      fulfillment: "Freesale", driTeam: "Tech", hasPax: false, hasActions: true,
      bookings: [
        { bookingId: "BID-201020", experienceDate: "15/01/2026", spNet: 1680, hoNet: 0, pax: "2 Adults" },
      ],
      paxRows: [],
    },
  ],
  "sp-error-manual": [
    {
      tid: "TID-40031", bidCount: 2, spNetLc: 3240, discLc: -3240, discUsd: -37.67,
      fulfillment: "Manual", driTeam: "Reservation Ops", hasPax: true, hasActions: true,
      bookings: [
        { bookingId: "BID-202001", experienceDate: "07/01/2026", spNet: 1620, hoNet: 0, pax: "1 Adult" },
        { bookingId: "BID-202002", experienceDate: "15/01/2026", spNet: 1620, hoNet: 0, pax: "1 Adult" },
      ],
      paxRows: [
        { paxType: "Adult", dateRange: "05/01 - 20/01", count: 2, spUnit: 1620, hoUnit: 0 },
      ],
    },
    {
      tid: "TID-40032", bidCount: 2, spNetLc: 2100, discLc: -2100, discUsd: -24.42,
      fulfillment: "Manual", driTeam: "Reservation Ops", hasPax: false, hasActions: true,
      bookings: [
        { bookingId: "BID-202011", experienceDate: "10/01/2026", spNet: 1050, hoNet: 0, pax: "1 Adult" },
        { bookingId: "BID-202012", experienceDate: "20/01/2026", spNet: 1050, hoNet: 0, pax: "1 Adult" },
      ],
      paxRows: [],
    },
  ],
  "charge-loss-freesale": [
    {
      tid: "TID-50011", bidCount: 4, spNetLc: 5880, discLc: -5880, discUsd: -68.37,
      fulfillment: "Freesale", driTeam: "Tech", hasPax: true, hasActions: true,
      bookings: [
        { bookingId: "BID-301001", experienceDate: "07/01/2026", spNet: 1470, hoNet: 0, pax: "2 Adults" },
        { bookingId: "BID-301002", experienceDate: "10/01/2026", spNet: 1470, hoNet: 0, pax: "2 Adults" },
        { bookingId: "BID-301003", experienceDate: "14/01/2026", spNet: 1470, hoNet: 0, pax: "2 Adults" },
        { bookingId: "BID-301004", experienceDate: "18/01/2026", spNet: 1470, hoNet: 0, pax: "2 Adults" },
      ],
      paxRows: [
        { paxType: "Adult", dateRange: "07/01 - 18/01", count: 8, spUnit: 735, hoUnit: 0 },
      ],
    },
    {
      tid: "TID-50012", bidCount: 2, spNetLc: 3090, discLc: -3090, discUsd: -35.93,
      fulfillment: "Freesale", driTeam: "Tech", hasPax: false, hasActions: true,
      bookings: [
        { bookingId: "BID-301011", experienceDate: "20/01/2026", spNet: 1545, hoNet: 0, pax: "1 Adult" },
        { bookingId: "BID-301012", experienceDate: "22/01/2026", spNet: 1545, hoNet: 0, pax: "1 Adult" },
      ],
      paxRows: [],
    },
  ],
  "dss-freesale": [
    {
      tid: "TID-70011", bidCount: 2, spNetLc: 2080, discLc: -2080, discUsd: -24.19,
      fulfillment: "Freesale", driTeam: "N/A", hasPax: false, hasActions: false,
      bookings: [
        { bookingId: "BID-501001", experienceDate: "12/01/2026", spNet: 1040, hoNet: 0, pax: "1 Adult" },
        { bookingId: "BID-501002", experienceDate: "20/01/2026", spNet: 1040, hoNet: 0, pax: "1 Adult" },
      ],
      paxRows: [],
    },
    {
      tid: "TID-70012", bidCount: 1, spNetLc: 1040, discLc: -1040, discUsd: -12.09,
      fulfillment: "Freesale", driTeam: "N/A", hasPax: false, hasActions: false,
      bookings: [
        { bookingId: "BID-501011", experienceDate: "28/01/2026", spNet: 1040, hoNet: 0, pax: "1 Adult" },
      ],
      paxRows: [],
    },
  ],
  "ok-freesale": [
    {
      tid: "TID-80011", bidCount: 5, spNetLc: 0, discLc: 0, discUsd: 0,
      fulfillment: "Freesale", driTeam: "N/A", hasPax: false, hasActions: false,
      bookings: [
        { bookingId: "BID-601001", experienceDate: "05/01/2026", spNet: 0, hoNet: 0, pax: "1 Adult" },
        { bookingId: "BID-601002", experienceDate: "10/01/2026", spNet: 0, hoNet: 0, pax: "1 Adult" },
        { bookingId: "BID-601003", experienceDate: "15/01/2026", spNet: 0, hoNet: 0, pax: "1 Adult" },
        { bookingId: "BID-601004", experienceDate: "20/01/2026", spNet: 0, hoNet: 0, pax: "1 Adult" },
        { bookingId: "BID-601005", experienceDate: "25/01/2026", spNet: 0, hoNet: 0, pax: "1 Adult" },
      ],
      paxRows: [],
    },
    {
      tid: "TID-80012", bidCount: 4, spNetLc: 0, discLc: 0, discUsd: 0,
      fulfillment: "Freesale", driTeam: "N/A", hasPax: false, hasActions: false,
      bookings: [
        { bookingId: "BID-601011", experienceDate: "08/01/2026", spNet: 0, hoNet: 0, pax: "1 Adult" },
        { bookingId: "BID-601012", experienceDate: "12/01/2026", spNet: 0, hoNet: 0, pax: "1 Adult" },
        { bookingId: "BID-601013", experienceDate: "18/01/2026", spNet: 0, hoNet: 0, pax: "1 Adult" },
        { bookingId: "BID-601014", experienceDate: "30/01/2026", spNet: 0, hoNet: 0, pax: "1 Adult" },
      ],
      paxRows: [],
    },
  ],
  "insured-freesale": [
    {
      tid: "TID-60011", bidCount: 3, spNetLc: 3750, discLc: -3750, discUsd: -43.60,
      fulfillment: "Freesale", driTeam: "N/A", hasPax: false, hasActions: false,
      bookings: [
        { bookingId: "BID-401001", experienceDate: "10/01/2026", spNet: 1250, hoNet: 0, pax: "1 Adult" },
        { bookingId: "BID-401002", experienceDate: "15/01/2026", spNet: 1250, hoNet: 0, pax: "1 Adult" },
        { bookingId: "BID-401003", experienceDate: "22/01/2026", spNet: 1250, hoNet: 0, pax: "1 Adult" },
      ],
      paxRows: [],
    },
    {
      tid: "TID-60012", bidCount: 2, spNetLc: 2500, discLc: -2500, discUsd: -29.07,
      fulfillment: "Freesale", driTeam: "N/A", hasPax: false, hasActions: false,
      bookings: [
        { bookingId: "BID-401011", experienceDate: "18/01/2026", spNet: 1250, hoNet: 0, pax: "1 Adult" },
        { bookingId: "BID-401012", experienceDate: "25/01/2026", spNet: 1250, hoNet: 0, pax: "1 Adult" },
      ],
      paxRows: [],
    },
  ],
  "refund-ok-freesale": [
    {
      tid: "TID-90011", bidCount: 2, spNetLc: -1560, discLc: 0, discUsd: 0,
      fulfillment: "Freesale", driTeam: "N/A", hasPax: false, hasActions: false,
      bookings: [
        { bookingId: "BID-701001", experienceDate: "03/01/2026", spNet: -780, hoNet: 0, pax: "1 Adult" },
        { bookingId: "BID-701002", experienceDate: "10/01/2026", spNet: -780, hoNet: 0, pax: "1 Adult" },
      ],
      paxRows: [],
    },
    {
      tid: "TID-90012", bidCount: 2, spNetLc: -780, discLc: 0, discUsd: 0,
      fulfillment: "Freesale", driTeam: "N/A", hasPax: false, hasActions: false,
      bookings: [
        { bookingId: "BID-701011", experienceDate: "08/01/2026", spNet: -390, hoNet: 0, pax: "1 Adult" },
        { bookingId: "BID-701012", experienceDate: "15/01/2026", spNet: -390, hoNet: 0, pax: "1 Adult" },
      ],
      paxRows: [],
    },
  ],
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function subCategoryBadge(sub: string, small = false) {
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
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-medium ${small ? "text-[11px]" : "text-xs"} ${cls}`}>
      <XCircle className={`${small ? "h-2.5 w-2.5" : "h-3 w-3"} shrink-0`} />
      {sub}
    </span>
  );
}

function actionBadge(action: string) {
  if (action === "No action needed")
    return <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3 w-3" />{action}</span>;
  if (action.startsWith("Claim"))
    return <span className="flex items-center gap-1 text-xs text-blue-600"><Info className="h-3 w-3" />{action}</span>;
  if (action.startsWith("Covered"))
    return <span className="flex items-center gap-1 text-xs text-violet-600"><CheckCircle2 className="h-3 w-3" />{action}</span>;
  return <span className="text-xs text-muted-foreground">{action}</span>;
}

// ─── Main Component ─────────────────────────────────────────────────────────
export function CancellationsWorkspace() {
  const [view, setView] = useState<WorkspaceView>(null);
  const [expandedTids, setExpandedTids] = useState<Set<string>>(new Set());
  const [resolvedTids, setResolvedTids] = useState<Set<string>>(new Set());
  const [disputeChecked, setDisputeChecked] = useState(false);
  const [issueChecked, setIssueChecked] = useState(false);
  const [paxPrices, setPaxPrices] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const rowKey = view ? (view as any).rowKey as string : null;
  const selectedRow = rowKey ? MOCK_BREAKUP.find(r => r.rowKey === rowKey) ?? null : null;
  const selectedTids = rowKey ? (MOCK_TIDS[rowKey] ?? []) : [];
  const currentTid = view && "tid" in view ? (view as any).tid as string : null;
  const currentTidData = currentTid ? selectedTids.find(t => t.tid === currentTid) ?? null : null;

  const totalDiscLc = MOCK_BREAKUP.reduce((s, r) => s + r.discLc, 0);
  const totalDiscUsd = MOCK_BREAKUP.reduce((s, r) => s + r.discUsd, 0);
  const totalBidCount = MOCK_BREAKUP.reduce((s, r) => s + r.bidCount, 0);

  const openSubcat = (rk: string) => {
    setView({ level: "subcat", rowKey: rk });
    const tids = MOCK_TIDS[rk] ?? [];
    const autoExp = new Set<string>(tids.filter(t => t.bidCount === 1).map(t => t.tid));
    setExpandedTids(autoExp);
    setDisputeChecked(false);
    setIssueChecked(false);
  };

  const goBack = () => {
    if (!view) return;
    if (view.level === "subcat") { setView(null); return; }
    setDisputeChecked(false);
    setIssueChecked(false);
    setView({ level: "subcat", rowKey: view.rowKey });
  };

  const toggleTid = (tid: string) => {
    setExpandedTids(prev => {
      const n = new Set(prev);
      n.has(tid) ? n.delete(tid) : n.add(tid);
      return n;
    });
  };

  const markResolved = (tid: string) => setResolvedTids(prev => new Set(prev).add(tid));

  // Section 1 height: normal when no view, compressed when action panel is showing
  const sec1MaxH = view ? "42%" : "100%";

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
          <div className={`${view ? "border-b" : ""} overflow-auto shrink-0 transition-all`}
            style={{ maxHeight: sec1MaxH }}>
            <div className="px-5 pt-4 pb-2">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wide">Cancellation Breakup</span>
                  <Badge variant="secondary" className="text-xs">{MOCK_BREAKUP.length} rows</Badge>
                </div>
                <span className="text-xs text-muted-foreground">Click a row to view TID-level actions ↓</span>
              </div>

              <Card className="overflow-hidden border flex flex-col">
                <div className="overflow-auto flex-1 min-h-0">
                  <Table>
                    <TableHeader className="sticky top-0 z-10">
                      <TableRow className="h-8 bg-muted/90">
                        {["Sub category","Cancellable","SP Net (LC)","HO Net (LC)","Cancellation Insurance","Charge Loss","Action point","DRI Team","Fulfillment","BID Count","Start Date","End Date","Total BIDs","Discrepancy (LC)","Discrepancy (USD)","TID Concentration"].map((h, i) => (
                          <TableHead key={h} className={`py-1.5 text-xs font-medium bg-muted/90 whitespace-nowrap ${i === 0 ? "pl-3 min-w-[210px]" : ""} ${[2,3,9,12,13,14].includes(i) ? "text-right" : [1,4,5].includes(i) ? "text-center" : ""} ${i === 15 ? "pr-3" : ""}`}>
                            {h}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {MOCK_BREAKUP.map((row) => {
                        const isSelected = rowKey === row.rowKey;
                        return (
                          <TableRow
                            key={row.rowKey}
                            onClick={() => openSubcat(row.rowKey)}
                            className={`h-10 cursor-pointer transition-colors text-xs
                              ${isSelected ? "bg-blue-50/80 border-l-2 border-l-blue-400" : "hover:bg-muted/30"}
                              ${!row.hasActions && !isSelected ? "opacity-70" : ""}
                            `}
                          >
                            <TableCell className="py-1.5 pl-3 font-medium whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                {isSelected ? <ChevronDown className="h-3.5 w-3.5 text-blue-500 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                                {subCategoryBadge(row.subCategory)}
                              </div>
                            </TableCell>
                            <TableCell className="py-1.5 text-center whitespace-nowrap">
                              {row.cancellable && <Badge variant={row.cancellable === "Yes" ? "outline" : "secondary"} className="text-xs py-0">{row.cancellable}</Badge>}
                            </TableCell>
                            <TableCell className="py-1.5 text-right font-mono whitespace-nowrap">{row.spNetLc !== 0 ? fmt(row.spNetLc) : "—"}</TableCell>
                            <TableCell className="py-1.5 text-right font-mono whitespace-nowrap">—</TableCell>
                            <TableCell className="py-1.5 text-center whitespace-nowrap">
                              {row.cancellationInsurance && <span className={`text-xs font-medium ${row.cancellationInsurance === "Yes" ? "text-blue-600" : "text-muted-foreground"}`}>{row.cancellationInsurance}</span>}
                            </TableCell>
                            <TableCell className="py-1.5 text-center whitespace-nowrap">
                              {row.chargeLoss && <Badge variant="secondary" className={`text-xs py-0 ${row.chargeLoss === "FALSE" ? "border-orange-200 bg-orange-50 text-orange-700" : "border-green-200 bg-green-50 text-green-700"}`}>{row.chargeLoss}</Badge>}
                            </TableCell>
                            <TableCell className="py-1.5 max-w-[220px]">
                              <Tooltip><TooltipTrigger asChild><div className="truncate">{actionBadge(row.actionPoint)}</div></TooltipTrigger><TooltipContent className="max-w-[280px] text-xs">{row.actionPoint}</TooltipContent></Tooltip>
                            </TableCell>
                            <TableCell className="py-1.5 whitespace-nowrap"><span className={`text-xs ${row.driTeam === "N/A" ? "text-muted-foreground" : "font-medium"}`}>{row.driTeam}</span></TableCell>
                            <TableCell className="py-1.5 whitespace-nowrap text-xs">{row.fulfillment}</TableCell>
                            <TableCell className="py-1.5 text-right font-mono">{row.bidCount}</TableCell>
                            <TableCell className="py-1.5 whitespace-nowrap font-mono text-xs">{row.startDate}</TableCell>
                            <TableCell className="py-1.5 whitespace-nowrap font-mono text-xs">{row.endDate}</TableCell>
                            <TableCell className="py-1.5 text-right font-mono">{row.totalBids}</TableCell>
                            <TableCell className={`py-1.5 text-right font-mono whitespace-nowrap ${row.discLc < 0 ? "text-red-600" : "text-muted-foreground"}`}>{row.discLc !== 0 ? fmt(row.discLc) : "—"}</TableCell>
                            <TableCell className={`py-1.5 text-right font-mono whitespace-nowrap ${row.discUsd < 0 ? "text-red-600" : "text-muted-foreground"}`}>{row.discUsd !== 0 ? fmt(row.discUsd) : "—"}</TableCell>
                            <TableCell className="py-1.5 font-mono text-xs text-muted-foreground pr-3 whitespace-nowrap">{row.tidConcentration || "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {/* Pinned total row */}
                <div className="border-t-2 bg-muted/70 shrink-0 overflow-x-auto">
                  <Table>
                    <TableBody>
                      <TableRow className="h-9">
                        <TableCell className="py-1.5 pl-3 text-xs font-bold min-w-[210px] whitespace-nowrap">Total</TableCell>
                        <TableCell /><TableCell className="py-1.5 text-right font-mono text-xs font-semibold whitespace-nowrap">{fmt(MOCK_BREAKUP.reduce((s,r)=>s+r.spNetLc,0))}</TableCell>
                        <TableCell className="py-1.5 text-right font-mono text-xs whitespace-nowrap">—</TableCell>
                        <TableCell /><TableCell /><TableCell className="min-w-[200px]" /><TableCell /><TableCell />
                        <TableCell className="py-1.5 text-right font-mono text-xs font-semibold whitespace-nowrap">{totalBidCount}</TableCell>
                        <TableCell /><TableCell />
                        <TableCell className="py-1.5 text-right font-mono text-xs whitespace-nowrap">{MOCK_BREAKUP.reduce((s,r)=>s+r.totalBids,0)}</TableCell>
                        <TableCell className={`py-1.5 text-right font-mono text-xs font-bold whitespace-nowrap ${totalDiscLc < 0 ? "text-red-600" : ""}`}>{fmt(totalDiscLc)}</TableCell>
                        <TableCell className={`py-1.5 text-right font-mono text-xs font-bold whitespace-nowrap ${totalDiscUsd < 0 ? "text-red-600" : ""}`}>{fmt(totalDiscUsd)}</TableCell>
                        <TableCell className="pr-3" />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </div>
          </div>

          {/* ══ SECTION 2: Action Panel ═════════════════════════════════════ */}
          {view && selectedRow && (
            <div className="flex-1 overflow-hidden flex flex-col">

              {/* Breadcrumb / nav header */}
              <div className="px-5 py-2 border-b bg-muted/30 flex items-center gap-2 shrink-0">
                <button onClick={goBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {view.level === "subcat" ? "Back to summary" : "Back"}
                </button>
                <span className="text-muted-foreground text-xs">/</span>
                {subCategoryBadge(selectedRow.subCategory, true)}
                {view.level !== "subcat" && (
                  <>
                    <span className="text-muted-foreground text-xs">/</span>
                    {view.level === "subcat-spnet" && <span className="text-xs font-medium text-blue-700">Set all SP Net</span>}
                    {view.level === "tid-spnet" && <><span className="text-xs font-mono text-foreground">{currentTid}</span><span className="text-muted-foreground text-xs">/</span><span className="text-xs font-medium text-blue-700">SP Net</span></>}
                    {view.level === "tid-pax" && <><span className="text-xs font-mono text-foreground">{currentTid}</span><span className="text-muted-foreground text-xs">/</span><span className="text-xs font-medium text-violet-700">Pax Pricing</span></>}
                  </>
                )}
                {selectedRow.actionPoint !== "No action needed" && view.level === "subcat" && (
                  <div className="ml-auto flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded px-2.5 py-1 text-xs text-amber-700">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    <span className="truncate max-w-[340px]">{selectedRow.actionPoint}</span>
                  </div>
                )}
              </div>

              {/* ── TID List view ──────────────────────────────────────────── */}
              {view.level === "subcat" && (
                <div className="flex-1 overflow-auto">
                  <div className="px-5 pt-3 pb-4 space-y-3">

                    {/* Bulk action cards */}
                    {selectedRow.hasActions ? (
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-md border p-2.5 cursor-pointer hover:bg-blue-50/80 transition-colors"
                          onClick={() => { setDisputeChecked(false); setIssueChecked(false); setView({ level: "subcat-spnet", rowKey: selectedRow.rowKey }); }}>
                          <div className="flex items-center gap-2 mb-1">
                            <div className="h-6 w-6 rounded bg-blue-100 flex items-center justify-center"><TrendingUp className="h-3 w-3 text-blue-600" /></div>
                            <span className="text-xs font-medium">Set all SP Net</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground font-mono">{fmt(selectedRow.spNetLc)} EUR</p>
                        </div>
                        <div className="rounded-md border p-2.5 cursor-pointer hover:bg-green-50/80 transition-colors"
                          onClick={() => { showToast(`All ${selectedRow.bidCount} bookings → HO Net (0)`); selectedTids.forEach(t => markResolved(t.tid)); }}>
                          <div className="flex items-center gap-2 mb-1">
                            <div className="h-6 w-6 rounded bg-green-100 flex items-center justify-center"><TrendingDown className="h-3 w-3 text-green-600" /></div>
                            <span className="text-xs font-medium">Set all HO Net</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground font-mono">{fmt(selectedRow.hoNetLc)} EUR</p>
                        </div>
                        <div className="rounded-md border p-2.5 cursor-pointer hover:bg-amber-50/80 transition-colors"
                          onClick={() => showToast("Dispute raised for all TIDs")}>
                          <div className="flex items-center gap-2 mb-1">
                            <div className="h-6 w-6 rounded bg-amber-100 flex items-center justify-center"><Gavel className="h-3 w-3 text-amber-600" /></div>
                            <span className="text-xs font-medium">Dispute All</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground font-mono">{fmt(Math.abs(selectedRow.discLc))} EUR</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-muted/40 border text-xs text-muted-foreground">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        <span>No price update actions required for <strong className="text-foreground">{selectedRow.subCategory}</strong> — {selectedRow.actionPoint.toLowerCase()}</span>
                      </div>
                    )}

                    {/* TID list */}
                    <div className="rounded-md border overflow-hidden">
                      {/* Header */}
                      <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] gap-0 items-center h-8 bg-muted/40 px-3 text-xs font-medium text-muted-foreground border-b">
                        <div className="w-5" />
                        <div className="pl-2">TID / Fulfillment</div>
                        <div className="text-right px-3 w-24">SP Net</div>
                        <div className="text-right px-3 w-24">HO Net</div>
                        <div className="text-right px-3 w-24">Disc.</div>
                        <div className="text-center px-2 w-14">BIDs</div>
                        <div className="text-right pr-1 w-[170px]">Quick Actions</div>
                      </div>

                      {selectedTids.map((tidRow) => {
                        const isExpanded = expandedTids.has(tidRow.tid);
                        const isResolved = resolvedTids.has(tidRow.tid);
                        const pct = selectedRow.discLc !== 0
                          ? ((tidRow.discLc / selectedRow.discLc) * 100).toFixed(0)
                          : "0";

                        return (
                          <div key={tidRow.tid} className={`transition-all ${isResolved ? "bg-green-50/40" : ""}`}>
                            {/* TID row */}
                            <div
                              className={`grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] gap-0 items-center px-3 h-11 cursor-pointer transition-colors hover:bg-muted/30 border-b ${isExpanded ? "bg-muted/20" : ""}`}
                              onClick={() => toggleTid(tidRow.tid)}
                            >
                              <div className="w-5 flex items-center">
                                {isResolved ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                                  : isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                  : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                              </div>
                              <div className="pl-2 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-sm font-medium text-primary">{tidRow.tid}</span>
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">{tidRow.fulfillment}</Badge>
                                  {tidRow.driTeam !== "N/A" && <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">{tidRow.driTeam}</Badge>}
                                </div>
                              </div>
                              <div className="text-right px-3 w-24 font-mono text-sm text-blue-700">{fmt(Math.abs(tidRow.spNetLc))}</div>
                              <div className="text-right px-3 w-24 font-mono text-sm text-green-700">0.00</div>
                              <div className="text-right px-3 w-24">
                                {tidRow.discLc !== 0 && <>
                                  <span className="font-mono text-sm text-red-600">{fmt(tidRow.discLc)}</span>
                                  <span className="text-[10px] text-muted-foreground ml-0.5">({pct}%)</span>
                                </>}
                                {tidRow.discLc === 0 && <span className="text-muted-foreground text-sm">—</span>}
                              </div>
                              <div className="text-center px-2 w-14 text-sm">{tidRow.bidCount}</div>

                              {/* Quick action icons */}
                              <div className="w-[170px] flex items-center justify-end gap-1 pr-1" onClick={e => e.stopPropagation()}>
                                {tidRow.hasActions ? (
                                  <>
                                    <Tooltip><TooltipTrigger asChild>
                                      <Button variant="outline" size="sm" className="h-6 w-6 p-0 text-blue-600 hover:bg-blue-50"
                                        onClick={() => { setDisputeChecked(false); setIssueChecked(false); setView({ level: "tid-spnet", rowKey: selectedRow.rowKey, tid: tidRow.tid }); }}>
                                        <TrendingUp className="h-3 w-3" />
                                      </Button>
                                    </TooltipTrigger><TooltipContent side="bottom" className="text-xs">Set SP Net</TooltipContent></Tooltip>

                                    <Tooltip><TooltipTrigger asChild>
                                      <Button variant="outline" size="sm" className="h-6 w-6 p-0 text-green-600 hover:bg-green-50"
                                        onClick={() => { showToast(`${tidRow.tid} → HO Net`); markResolved(tidRow.tid); }}>
                                        <TrendingDown className="h-3 w-3" />
                                      </Button>
                                    </TooltipTrigger><TooltipContent side="bottom" className="text-xs">Set HO Net</TooltipContent></Tooltip>

                                    {tidRow.hasPax && (
                                      <Tooltip><TooltipTrigger asChild>
                                        <Button variant="outline" size="sm" className="h-6 w-6 p-0 text-violet-600 hover:bg-violet-50"
                                          onClick={() => setView({ level: "tid-pax", rowKey: selectedRow.rowKey, tid: tidRow.tid })}>
                                          <Calculator className="h-3 w-3" />
                                        </Button>
                                      </TooltipTrigger><TooltipContent side="bottom" className="text-xs">Pax Pricing</TooltipContent></Tooltip>
                                    )}

                                    <Tooltip><TooltipTrigger asChild>
                                      <Button variant="outline" size="sm" className="h-6 w-6 p-0 text-amber-600 hover:bg-amber-50"
                                        onClick={() => showToast(`Dispute raised for ${tidRow.tid}`)}>
                                        <Gavel className="h-3 w-3" />
                                      </Button>
                                    </TooltipTrigger><TooltipContent side="bottom" className="text-xs">Raise Dispute</TooltipContent></Tooltip>

                                    <Tooltip><TooltipTrigger asChild>
                                      <Button variant="outline" size="sm" className="h-6 w-6 p-0 text-orange-600 hover:bg-orange-50"
                                        onClick={() => showToast(`Issue logged for ${tidRow.tid}`)}>
                                        <FileWarning className="h-3 w-3" />
                                      </Button>
                                    </TooltipTrigger><TooltipContent side="bottom" className="text-xs">Log Issue</TooltipContent></Tooltip>
                                  </>
                                ) : (
                                  <span className="text-xs text-muted-foreground italic pr-1">No action</span>
                                )}
                              </div>
                            </div>

                            {/* Expanded: booking table + action buttons */}
                            {isExpanded && (
                              <div className="border-b bg-muted/10 px-4 py-3 space-y-2">
                                <div className="rounded-md border overflow-hidden bg-background">
                                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-0 items-center h-7 bg-muted/30 px-3 text-[11px] font-medium text-muted-foreground border-b">
                                    <div>Booking ID</div>
                                    <div className="text-right w-24 px-2">SP Net</div>
                                    <div className="text-right w-24 px-2">HO Net</div>
                                    <div className="text-right w-28 px-2">Exp. Date</div>
                                    <div className="text-right w-28 pr-2">Pax</div>
                                  </div>
                                  {tidRow.bookings.map(b => (
                                    <div key={b.bookingId} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-3 h-8 border-b last:border-0 text-xs hover:bg-muted/20">
                                      <div className="font-mono text-primary">{b.bookingId}</div>
                                      <div className="text-right w-24 px-2 font-mono text-blue-600">{fmt(b.spNet)}</div>
                                      <div className="text-right w-24 px-2 font-mono text-green-600">{fmt(b.hoNet)}</div>
                                      <div className="text-right w-28 px-2 text-muted-foreground">{b.experienceDate}</div>
                                      <div className="text-right w-28 pr-2 text-muted-foreground">{b.pax}</div>
                                    </div>
                                  ))}
                                </div>
                                {tidRow.hasActions && (
                                  <div className="flex items-center gap-2 pt-0.5">
                                    <Button variant="default" size="sm" className="h-7 text-xs gap-1 bg-primary"
                                      onClick={() => { setDisputeChecked(false); setIssueChecked(false); setView({ level: "tid-spnet", rowKey: selectedRow.rowKey, tid: tidRow.tid }); }}>
                                      <TrendingUp className="h-3 w-3" /> SP Net
                                    </Button>
                                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                                      onClick={() => { showToast(`${tidRow.tid} → HO Net`); markResolved(tidRow.tid); }}>
                                      <TrendingDown className="h-3 w-3" /> HO Net
                                    </Button>
                                    {tidRow.hasPax && (
                                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                                        onClick={() => setView({ level: "tid-pax", rowKey: selectedRow.rowKey, tid: tidRow.tid })}>
                                        <Calculator className="h-3 w-3" /> Pax Pricing
                                      </Button>
                                    )}
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
              )}

              {/* ── Sub-category SP Net confirm panel ──────────────────────── */}
              {view.level === "subcat-spnet" && selectedRow && (
                <div className="flex-1 overflow-auto p-5 space-y-3">
                  <div className="rounded-md border overflow-hidden">
                    <div className="px-4 py-3 border-b bg-blue-50">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-md bg-blue-100 flex items-center justify-center"><TrendingUp className="h-4 w-4 text-blue-600" /></div>
                        <div>
                          <div className="text-sm font-medium">Confirm: Set all {selectedRow.bidCount} bookings to SP Net</div>
                          <div className="text-xs text-muted-foreground">Across {selectedTids.length} TIDs · {selectedRow.subCategory}</div>
                        </div>
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-md border p-3 bg-blue-50/50">
                          <div className="text-xs text-muted-foreground mb-1">SP Net Total (Paying)</div>
                          <div className="text-lg font-mono font-semibold text-blue-700">{fmt(selectedRow.spNetLc)} EUR</div>
                        </div>
                        <div className="rounded-md border p-3 bg-green-50/50">
                          <div className="text-xs text-muted-foreground mb-1">HO Net Total</div>
                          <div className="text-lg font-mono font-semibold text-green-700">0.00 EUR</div>
                        </div>
                        <div className="rounded-md border p-3 bg-muted/30">
                          <div className="text-xs text-muted-foreground mb-1">Difference (SP − HO)</div>
                          <div className="text-lg font-mono font-semibold text-amber-600">+{fmt(selectedRow.spNetLc)} EUR</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={`rounded-md border-2 overflow-hidden transition-colors ${disputeChecked ? "border-amber-500 bg-amber-50/50" : "border-border"}`}>
                    <div className="px-4 py-4 flex items-start gap-4">
                      <div className={`h-10 w-10 rounded-md flex items-center justify-center shrink-0 ${disputeChecked ? "bg-amber-100" : "bg-muted"}`}>
                        <AlertTriangle className={`h-5 w-5 ${disputeChecked ? "text-amber-600" : "text-muted-foreground"}`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <span className="text-sm font-semibold">Raise Dispute</span>
                          <Switch checked={disputeChecked} onCheckedChange={setDisputeChecked} />
                        </div>
                        <p className="text-xs text-muted-foreground">Cancellation charge to be claimed from SP / RO.</p>
                        <p className="text-xs text-muted-foreground mt-1">Paying SP Net now. The difference of <span className="font-mono font-semibold text-amber-600">{fmt(selectedRow.spNetLc)} EUR</span> will be tracked as a dispute.</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-md bg-orange-100 flex items-center justify-center"><FileWarning className="h-4 w-4 text-orange-600" /></div>
                      <div>
                        <div className="text-sm font-medium">Raise Issue</div>
                        <div className="text-xs text-muted-foreground">Internal tracking — check with Finance / RO</div>
                      </div>
                    </div>
                    <Checkbox checked={issueChecked} onCheckedChange={c => setIssueChecked(!!c)} className="h-5 w-5" />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <Button variant="ghost" size="sm" onClick={goBack}><ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back</Button>
                    <Button size="sm" onClick={() => {
                      showToast(`All ${selectedRow.bidCount} bookings → SP Net`);
                      selectedTids.forEach(t => markResolved(t.tid));
                      setView({ level: "subcat", rowKey: selectedRow.rowKey });
                    }}>
                      <Check className="h-3.5 w-3.5 mr-1.5" /> Confirm & Apply SP Net
                    </Button>
                  </div>
                </div>
              )}

              {/* ── TID SP Net confirm panel ───────────────────────────────── */}
              {view.level === "tid-spnet" && currentTidData && (
                <div className="flex-1 overflow-auto p-5 space-y-3">
                  <div className="rounded-md border overflow-hidden">
                    <div className="px-4 py-3 border-b bg-blue-50">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-md bg-blue-100 flex items-center justify-center"><TrendingUp className="h-4 w-4 text-blue-600" /></div>
                        <div>
                          <div className="text-sm font-medium">Confirm: Update to SP Net</div>
                          <div className="text-xs text-muted-foreground">{currentTidData.bidCount} bookings in {currentTid}</div>
                        </div>
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-md border p-3 bg-blue-50/50">
                          <div className="text-xs text-muted-foreground mb-1">SP Net (Paying)</div>
                          <div className="text-lg font-mono font-semibold text-blue-700">{fmt(Math.abs(currentTidData.spNetLc))}</div>
                        </div>
                        <div className="rounded-md border p-3 bg-green-50/50">
                          <div className="text-xs text-muted-foreground mb-1">HO Net</div>
                          <div className="text-lg font-mono font-semibold text-green-700">0.00</div>
                        </div>
                        <div className="rounded-md border p-3 bg-muted/30">
                          <div className="text-xs text-muted-foreground mb-1">Difference</div>
                          <div className="text-lg font-mono font-semibold text-amber-600">+{fmt(Math.abs(currentTidData.spNetLc))}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={`rounded-md border-2 transition-colors ${disputeChecked ? "border-amber-500 bg-amber-50/50" : "border-border"}`}>
                    <div className="px-4 py-4 flex items-start gap-4">
                      <div className={`h-10 w-10 rounded-md flex items-center justify-center shrink-0 ${disputeChecked ? "bg-amber-100" : "bg-muted"}`}>
                        <AlertTriangle className={`h-5 w-5 ${disputeChecked ? "text-amber-600" : "text-muted-foreground"}`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold">Raise Dispute</span>
                          <Switch checked={disputeChecked} onCheckedChange={setDisputeChecked} />
                        </div>
                        <p className="text-xs text-muted-foreground">Cancellation charge to be claimed from SP / RO. Difference of <span className="font-mono font-semibold text-amber-600">{fmt(Math.abs(currentTidData.spNetLc))} EUR</span> tracked as dispute.</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-md bg-orange-100 flex items-center justify-center"><FileWarning className="h-4 w-4 text-orange-600" /></div>
                      <div>
                        <div className="text-sm font-medium">Raise Issue</div>
                        <div className="text-xs text-muted-foreground">Internal tracking — check with Finance / RO</div>
                      </div>
                    </div>
                    <Checkbox checked={issueChecked} onCheckedChange={c => setIssueChecked(!!c)} className="h-5 w-5" />
                  </div>

                  <div className="flex justify-between pt-1">
                    <Button variant="ghost" size="sm" onClick={goBack}><ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back</Button>
                    <Button size="sm" onClick={() => {
                      showToast(`${currentTid} → SP Net applied`);
                      markResolved(currentTid!);
                      setView({ level: "subcat", rowKey: selectedRow.rowKey });
                    }}>
                      <Check className="h-3.5 w-3.5 mr-1.5" /> Confirm & Apply
                    </Button>
                  </div>
                </div>
              )}

              {/* ── Pax pricing panel ──────────────────────────────────────── */}
              {view.level === "tid-pax" && currentTidData && (
                <div className="flex-1 overflow-auto p-5 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-md border p-2 bg-blue-50"><span className="text-muted-foreground">SP Net Total:</span> <span className="font-mono font-semibold text-blue-700">{fmt(Math.abs(currentTidData.spNetLc))} EUR</span></div>
                    <div className="rounded-md border p-2 bg-green-50"><span className="text-muted-foreground">HO Net Total:</span> <span className="font-mono font-semibold text-green-700">0.00 EUR</span></div>
                  </div>

                  <div className="text-xs text-muted-foreground">Grouped by: <span className="font-medium text-foreground">Experience Date</span></div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Quick fill:</span>
                    <Button size="sm" variant="outline" className="h-6 text-xs"
                      onClick={() => {
                        const p: Record<string, string> = {};
                        currentTidData.paxRows.forEach(r => { p[`${r.paxType}__${r.dateRange}`] = String(r.spUnit); });
                        setPaxPrices(p);
                      }}>All SP</Button>
                    <Button size="sm" variant="outline" className="h-6 text-xs"
                      onClick={() => {
                        const p: Record<string, string> = {};
                        currentTidData.paxRows.forEach(r => { p[`${r.paxType}__${r.dateRange}`] = String(r.hoUnit); });
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
                        {currentTidData.paxRows.map(row => {
                          const key = `${row.paxType}__${row.dateRange}`;
                          return (
                            <TableRow key={key} className="h-9">
                              <TableCell className="py-1.5 pl-4 text-sm font-medium">{row.paxType}</TableCell>
                              <TableCell className="py-1.5 text-xs text-muted-foreground">{row.dateRange}</TableCell>
                              <TableCell className="py-1.5 text-right text-sm">{row.count}</TableCell>
                              <TableCell className="py-1.5 text-right font-mono text-sm text-blue-600">{fmt(row.spUnit)}</TableCell>
                              <TableCell className="py-1.5 text-right font-mono text-sm text-green-600">{fmt(row.hoUnit)}</TableCell>
                              <TableCell className="py-1.5 text-right pr-4">
                                <Input
                                  className="h-7 w-24 text-xs text-right font-mono ml-auto border-dashed"
                                  value={paxPrices[key] ?? ""}
                                  onChange={e => setPaxPrices(prev => ({ ...prev, [key]: e.target.value }))}
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {currentTidData.paxRows.length === 0 && (
                          <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-6">No pax data available for this TID</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="flex justify-between pt-1">
                    <Button variant="ghost" size="sm" onClick={goBack}><ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back</Button>
                    <Button size="sm" onClick={() => {
                      showToast("Pax prices applied");
                      markResolved(currentTid!);
                      setView({ level: "subcat", rowKey: selectedRow.rowKey });
                    }}>
                      <Check className="h-3.5 w-3.5 mr-1.5" /> Apply Pax Prices
                    </Button>
                  </div>
                </div>
              )}

              {/* Footer bar — shows SP / HO / Disc totals for context */}
              <div className="border-t bg-muted/30 px-5 py-2 flex items-center justify-between shrink-0">
                <div className="text-xs text-muted-foreground">
                  {view.level === "subcat" && `${selectedTids.length} TIDs · ${selectedRow.bidCount} bookings`}
                  {view.level === "subcat-spnet" && `${selectedTids.length} TIDs · ${selectedRow.bidCount} bookings`}
                  {(view.level === "tid-spnet" || view.level === "tid-pax") && currentTidData && `${currentTidData.bidCount} bookings in ${currentTid}`}
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div><span className="text-xs text-muted-foreground mr-1.5">SP</span><span className="font-mono font-medium text-blue-700">{fmt(Math.abs(view.level === "subcat" || view.level === "subcat-spnet" ? selectedRow.spNetLc : (currentTidData?.spNetLc ?? 0)))}</span></div>
                  <div><span className="text-xs text-muted-foreground mr-1.5">HO</span><span className="font-mono font-medium text-green-700">0.00</span></div>
                  <div><span className="text-xs text-muted-foreground mr-1.5">Disc.</span><span className="font-mono font-semibold text-red-600">{fmt(Math.abs(view.level === "subcat" || view.level === "subcat-spnet" ? selectedRow.discLc : (currentTidData?.discLc ?? 0)))}</span></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-4 right-4 flex items-center gap-2 bg-foreground text-background text-xs px-3 py-2 rounded shadow-lg z-50">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
            {toast}
            <button onClick={() => setToast(null)} className="ml-1 opacity-60 hover:opacity-100"><XIcon className="h-3 w-3" /></button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export default CancellationsWorkspace;
