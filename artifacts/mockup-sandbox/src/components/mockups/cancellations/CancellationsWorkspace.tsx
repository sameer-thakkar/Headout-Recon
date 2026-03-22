import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  XCircle, ChevronDown, ChevronRight, AlertTriangle, Info,
  DollarSign, MessageSquareWarning, FileText, CheckCircle2, X as XIcon,
  ArrowLeft,
} from "lucide-react";

const fmt = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── Mock Data ─────────────────────────────────────────────────────────────

interface BreakupRow {
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
  rowKey: string;
}

interface TidRow {
  tid: string;
  bidCount: number;
  spNetLc: number;
  discLc: number;
  discUsd: number;
  fulfillment: string;
  driTeam: string;
  bookings: { bookingId: string; experienceDate: string; spNet: number; hoNet: number }[];
  hasActions: boolean;
}

const MOCK_BREAKUP: BreakupRow[] = [
  {
    rowKey: "sp-error-freesale",
    subCategory: "Cancelled-SP error",
    cancellable: "Yes",
    spNetLc: 14820,
    hoNetLc: 0,
    cancellationInsurance: "N/A",
    chargeLoss: "",
    actionPoint: "Check why did we cancel the booking with SP? If cancelled on time- raise with SP, if cancellation was delayed- Raise with RO.",
    driTeam: "Tech",
    fulfillment: "Freesale",
    bidCount: 9,
    startDate: "02/01/2026",
    endDate: "18/01/2026",
    totalBids: 52,
    discLc: -14820,
    discUsd: -172.34,
    tidConcentration: "TID-40021",
  },
  {
    rowKey: "sp-error-manual",
    subCategory: "Cancelled-SP error",
    cancellable: "Yes",
    spNetLc: 5340,
    hoNetLc: 0,
    cancellationInsurance: "N/A",
    chargeLoss: "",
    actionPoint: "Check why did we cancel the booking with SP? If cancelled on time- raise with SP, if cancellation was delayed- Raise with RO.",
    driTeam: "Reservation Ops",
    fulfillment: "Manual",
    bidCount: 4,
    startDate: "05/01/2026",
    endDate: "20/01/2026",
    totalBids: 28,
    discLc: -5340,
    discUsd: -62.10,
    tidConcentration: "TID-40031",
  },
  {
    rowKey: "charge-loss-freesale",
    subCategory: "Cancelled-Check for Charge loss",
    cancellable: "No",
    spNetLc: 8970,
    hoNetLc: 0,
    cancellationInsurance: "No",
    chargeLoss: "FALSE",
    actionPoint: "Raise this with RO why this is not marked as Charge loss TRUE",
    driTeam: "Tech",
    fulfillment: "Freesale",
    bidCount: 6,
    startDate: "07/01/2026",
    endDate: "22/01/2026",
    totalBids: 40,
    discLc: -8970,
    discUsd: -104.30,
    tidConcentration: "TID-50011, TID-50012",
  },
  {
    rowKey: "insured-freesale",
    subCategory: "Cancelled-Insured Booking",
    cancellable: "No",
    spNetLc: 6250,
    hoNetLc: 0,
    cancellationInsurance: "Yes",
    chargeLoss: "",
    actionPoint: "Claim from insurance",
    driTeam: "N/A",
    fulfillment: "Freesale",
    bidCount: 5,
    startDate: "10/01/2026",
    endDate: "25/01/2026",
    totalBids: 30,
    discLc: -6250,
    discUsd: -72.67,
    tidConcentration: "",
  },
  {
    rowKey: "dss-freesale",
    subCategory: "Cancelled-DSS policy",
    cancellable: "No",
    spNetLc: 3120,
    hoNetLc: 0,
    cancellationInsurance: "No",
    chargeLoss: "TRUE",
    actionPoint: "Covered under DSS policy",
    driTeam: "N/A",
    fulfillment: "Freesale",
    bidCount: 3,
    startDate: "12/01/2026",
    endDate: "28/01/2026",
    totalBids: 20,
    discLc: -3120,
    discUsd: -36.28,
    tidConcentration: "",
  },
  {
    rowKey: "ok-freesale",
    subCategory: "Cancelled-OK",
    cancellable: "",
    spNetLc: 0,
    hoNetLc: 0,
    cancellationInsurance: "N/A",
    chargeLoss: "",
    actionPoint: "No action needed",
    driTeam: "N/A",
    fulfillment: "Freesale",
    bidCount: 12,
    startDate: "01/01/2026",
    endDate: "30/01/2026",
    totalBids: 60,
    discLc: 0,
    discUsd: 0,
    tidConcentration: "",
  },
  {
    rowKey: "refund-ok-freesale",
    subCategory: "Cancelled-Refund OK",
    cancellable: "",
    spNetLc: -2340,
    hoNetLc: 0,
    cancellationInsurance: "",
    chargeLoss: "",
    actionPoint: "No action needed",
    driTeam: "N/A",
    fulfillment: "Freesale",
    bidCount: 4,
    startDate: "03/01/2026",
    endDate: "15/01/2026",
    totalBids: 18,
    discLc: 0,
    discUsd: 0,
    tidConcentration: "",
  },
];

const MOCK_TIDS: Record<string, TidRow[]> = {
  "sp-error-freesale": [
    {
      tid: "TID-40021", bidCount: 5, spNetLc: 8250, discLc: -8250, discUsd: -95.94,
      fulfillment: "Freesale", driTeam: "Tech", hasActions: true,
      bookings: [
        { bookingId: "BID-201001", experienceDate: "05/01/2026", spNet: 1650, hoNet: 0 },
        { bookingId: "BID-201002", experienceDate: "06/01/2026", spNet: 1650, hoNet: 0 },
        { bookingId: "BID-201003", experienceDate: "08/01/2026", spNet: 1720, hoNet: 0 },
        { bookingId: "BID-201004", experienceDate: "12/01/2026", spNet: 1680, hoNet: 0 },
        { bookingId: "BID-201005", experienceDate: "18/01/2026", spNet: 1550, hoNet: 0 },
      ],
    },
    {
      tid: "TID-40022", bidCount: 3, spNetLc: 4890, discLc: -4890, discUsd: -56.87,
      fulfillment: "Freesale", driTeam: "Tech", hasActions: true,
      bookings: [
        { bookingId: "BID-201011", experienceDate: "09/01/2026", spNet: 1680, hoNet: 0 },
        { bookingId: "BID-201012", experienceDate: "11/01/2026", spNet: 1530, hoNet: 0 },
        { bookingId: "BID-201013", experienceDate: "14/01/2026", spNet: 1680, hoNet: 0 },
      ],
    },
    {
      tid: "TID-40023", bidCount: 1, spNetLc: 1680, discLc: -1680, discUsd: -19.53,
      fulfillment: "Freesale", driTeam: "Tech", hasActions: true,
      bookings: [
        { bookingId: "BID-201020", experienceDate: "15/01/2026", spNet: 1680, hoNet: 0 },
      ],
    },
  ],
  "sp-error-manual": [
    {
      tid: "TID-40031", bidCount: 2, spNetLc: 3240, discLc: -3240, discUsd: -37.67,
      fulfillment: "Manual", driTeam: "Reservation Ops", hasActions: true,
      bookings: [
        { bookingId: "BID-202001", experienceDate: "07/01/2026", spNet: 1620, hoNet: 0 },
        { bookingId: "BID-202002", experienceDate: "15/01/2026", spNet: 1620, hoNet: 0 },
      ],
    },
    {
      tid: "TID-40032", bidCount: 2, spNetLc: 2100, discLc: -2100, discUsd: -24.42,
      fulfillment: "Manual", driTeam: "Reservation Ops", hasActions: true,
      bookings: [
        { bookingId: "BID-202011", experienceDate: "10/01/2026", spNet: 1050, hoNet: 0 },
        { bookingId: "BID-202012", experienceDate: "20/01/2026", spNet: 1050, hoNet: 0 },
      ],
    },
  ],
  "charge-loss-freesale": [
    {
      tid: "TID-50011", bidCount: 4, spNetLc: 5880, discLc: -5880, discUsd: -68.37,
      fulfillment: "Freesale", driTeam: "Tech", hasActions: true,
      bookings: [
        { bookingId: "BID-301001", experienceDate: "07/01/2026", spNet: 1470, hoNet: 0 },
        { bookingId: "BID-301002", experienceDate: "10/01/2026", spNet: 1470, hoNet: 0 },
        { bookingId: "BID-301003", experienceDate: "14/01/2026", spNet: 1470, hoNet: 0 },
        { bookingId: "BID-301004", experienceDate: "18/01/2026", spNet: 1470, hoNet: 0 },
      ],
    },
    {
      tid: "TID-50012", bidCount: 2, spNetLc: 3090, discLc: -3090, discUsd: -35.93,
      fulfillment: "Freesale", driTeam: "Tech", hasActions: true,
      bookings: [
        { bookingId: "BID-301011", experienceDate: "20/01/2026", spNet: 1545, hoNet: 0 },
        { bookingId: "BID-301012", experienceDate: "22/01/2026", spNet: 1545, hoNet: 0 },
      ],
    },
  ],
  "insured-freesale": [
    {
      tid: "TID-60011", bidCount: 3, spNetLc: 3750, discLc: -3750, discUsd: -43.60,
      fulfillment: "Freesale", driTeam: "N/A", hasActions: false,
      bookings: [
        { bookingId: "BID-401001", experienceDate: "10/01/2026", spNet: 1250, hoNet: 0 },
        { bookingId: "BID-401002", experienceDate: "15/01/2026", spNet: 1250, hoNet: 0 },
        { bookingId: "BID-401003", experienceDate: "22/01/2026", spNet: 1250, hoNet: 0 },
      ],
    },
    {
      tid: "TID-60012", bidCount: 2, spNetLc: 2500, discLc: -2500, discUsd: -29.07,
      fulfillment: "Freesale", driTeam: "N/A", hasActions: false,
      bookings: [
        { bookingId: "BID-401011", experienceDate: "18/01/2026", spNet: 1250, hoNet: 0 },
        { bookingId: "BID-401012", experienceDate: "25/01/2026", spNet: 1250, hoNet: 0 },
      ],
    },
  ],
  "dss-freesale": [
    {
      tid: "TID-70011", bidCount: 2, spNetLc: 2080, discLc: -2080, discUsd: -24.19,
      fulfillment: "Freesale", driTeam: "N/A", hasActions: false,
      bookings: [
        { bookingId: "BID-501001", experienceDate: "12/01/2026", spNet: 1040, hoNet: 0 },
        { bookingId: "BID-501002", experienceDate: "20/01/2026", spNet: 1040, hoNet: 0 },
      ],
    },
    {
      tid: "TID-70012", bidCount: 1, spNetLc: 1040, discLc: -1040, discUsd: -12.09,
      fulfillment: "Freesale", driTeam: "N/A", hasActions: false,
      bookings: [
        { bookingId: "BID-501011", experienceDate: "28/01/2026", spNet: 1040, hoNet: 0 },
      ],
    },
  ],
  "ok-freesale": [
    {
      tid: "TID-80011", bidCount: 5, spNetLc: 0, discLc: 0, discUsd: 0,
      fulfillment: "Freesale", driTeam: "N/A", hasActions: false,
      bookings: [
        { bookingId: "BID-601001", experienceDate: "05/01/2026", spNet: 0, hoNet: 0 },
        { bookingId: "BID-601002", experienceDate: "10/01/2026", spNet: 0, hoNet: 0 },
        { bookingId: "BID-601003", experienceDate: "15/01/2026", spNet: 0, hoNet: 0 },
        { bookingId: "BID-601004", experienceDate: "20/01/2026", spNet: 0, hoNet: 0 },
        { bookingId: "BID-601005", experienceDate: "25/01/2026", spNet: 0, hoNet: 0 },
      ],
    },
    {
      tid: "TID-80012", bidCount: 4, spNetLc: 0, discLc: 0, discUsd: 0,
      fulfillment: "Freesale", driTeam: "N/A", hasActions: false,
      bookings: [
        { bookingId: "BID-601011", experienceDate: "08/01/2026", spNet: 0, hoNet: 0 },
        { bookingId: "BID-601012", experienceDate: "12/01/2026", spNet: 0, hoNet: 0 },
        { bookingId: "BID-601013", experienceDate: "18/01/2026", spNet: 0, hoNet: 0 },
        { bookingId: "BID-601014", experienceDate: "30/01/2026", spNet: 0, hoNet: 0 },
      ],
    },
    {
      tid: "TID-80013", bidCount: 3, spNetLc: 0, discLc: 0, discUsd: 0,
      fulfillment: "Freesale", driTeam: "N/A", hasActions: false,
      bookings: [
        { bookingId: "BID-601021", experienceDate: "02/01/2026", spNet: 0, hoNet: 0 },
        { bookingId: "BID-601022", experienceDate: "14/01/2026", spNet: 0, hoNet: 0 },
        { bookingId: "BID-601023", experienceDate: "22/01/2026", spNet: 0, hoNet: 0 },
      ],
    },
  ],
  "refund-ok-freesale": [
    {
      tid: "TID-90011", bidCount: 2, spNetLc: -1560, discLc: 0, discUsd: 0,
      fulfillment: "Freesale", driTeam: "N/A", hasActions: false,
      bookings: [
        { bookingId: "BID-701001", experienceDate: "03/01/2026", spNet: -780, hoNet: 0 },
        { bookingId: "BID-701002", experienceDate: "10/01/2026", spNet: -780, hoNet: 0 },
      ],
    },
    {
      tid: "TID-90012", bidCount: 2, spNetLc: -780, discLc: 0, discUsd: 0,
      fulfillment: "Freesale", driTeam: "N/A", hasActions: false,
      bookings: [
        { bookingId: "BID-701011", experienceDate: "08/01/2026", spNet: -390, hoNet: 0 },
        { bookingId: "BID-701012", experienceDate: "15/01/2026", spNet: -390, hoNet: 0 },
      ],
    },
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
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${cls}`}>
      <XCircle className="h-3 w-3 shrink-0" />
      {sub}
    </span>
  );
}

function actionBadge(action: string) {
  if (action === "No action needed") {
    return <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3 w-3" />{action}</span>;
  }
  if (action.startsWith("Claim")) {
    return <span className="flex items-center gap-1 text-xs text-blue-600"><Info className="h-3 w-3" />{action}</span>;
  }
  if (action.startsWith("Covered")) {
    return <span className="flex items-center gap-1 text-xs text-violet-600"><CheckCircle2 className="h-3 w-3" />{action}</span>;
  }
  return <span className="text-xs text-muted-foreground">{action}</span>;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function CancellationsWorkspace() {
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [expandedTids, setExpandedTids] = useState<Set<string>>(new Set());
  const [priceValues, setPriceValues] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const selectedRow = MOCK_BREAKUP.find(r => r.rowKey === selectedRowKey) ?? null;
  const selectedTids = selectedRowKey ? (MOCK_TIDS[selectedRowKey] ?? []) : [];

  const totalDiscLc = MOCK_BREAKUP.reduce((s, r) => s + r.discLc, 0);
  const totalDiscUsd = MOCK_BREAKUP.reduce((s, r) => s + r.discUsd, 0);
  const totalBidCount = MOCK_BREAKUP.reduce((s, r) => s + r.bidCount, 0);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const toggleTid = (tid: string) => {
    setExpandedTids(prev => {
      const next = new Set(prev);
      if (next.has(tid)) next.delete(tid);
      else next.add(tid);
      return next;
    });
  };

  const handleRowClick = (rowKey: string) => {
    if (selectedRowKey === rowKey) {
      setSelectedRowKey(null);
    } else {
      setSelectedRowKey(rowKey);
      const tids = MOCK_TIDS[rowKey] ?? [];
      const autoExpanded = new Set<string>(
        tids.filter(t => t.bidCount === 1).map(t => t.tid)
      );
      setExpandedTids(autoExpanded);
    }
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

          {/* Section 1: Analysis Breakup Table */}
          <div className={`${selectedRowKey ? "border-b" : ""} overflow-auto shrink-0`}
            style={{ maxHeight: selectedRowKey ? "55%" : "100%" }}>
            <div className="px-5 pt-4 pb-2">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wide">Cancellation Breakup</span>
                  <Badge variant="secondary" className="text-xs">{MOCK_BREAKUP.length} rows</Badge>
                </div>
                <span className="text-xs text-muted-foreground">Click a row to view TID-level actions</span>
              </div>

              <Card className="overflow-hidden border flex flex-col" style={{ maxHeight: selectedRowKey ? "none" : "calc(100vh - 150px)" }}>
                {/* Scrollable table body */}
                <div className="overflow-auto flex-1 min-h-0">
                  <Table>
                    <TableHeader className="sticky top-0 z-10">
                      <TableRow className="h-8 bg-muted/90">
                        <TableHead className="py-1.5 text-xs font-medium pl-3 min-w-[210px] whitespace-nowrap bg-muted/90">Sub category</TableHead>
                        <TableHead className="py-1.5 text-xs font-medium text-center whitespace-nowrap bg-muted/90">Cancellable</TableHead>
                        <TableHead className="py-1.5 text-xs font-medium text-right whitespace-nowrap bg-muted/90">SP Net (LC)</TableHead>
                        <TableHead className="py-1.5 text-xs font-medium text-right whitespace-nowrap bg-muted/90">HO Net (LC)</TableHead>
                        <TableHead className="py-1.5 text-xs font-medium text-center whitespace-nowrap bg-muted/90">Cancellation Insurance</TableHead>
                        <TableHead className="py-1.5 text-xs font-medium text-center whitespace-nowrap bg-muted/90">Charge Loss</TableHead>
                        <TableHead className="py-1.5 text-xs font-medium min-w-[200px] bg-muted/90">Action point</TableHead>
                        <TableHead className="py-1.5 text-xs font-medium whitespace-nowrap bg-muted/90">DRI Team</TableHead>
                        <TableHead className="py-1.5 text-xs font-medium whitespace-nowrap bg-muted/90">Fulfillment</TableHead>
                        <TableHead className="py-1.5 text-xs font-medium text-right whitespace-nowrap bg-muted/90">BID Count</TableHead>
                        <TableHead className="py-1.5 text-xs font-medium whitespace-nowrap bg-muted/90">Start Date</TableHead>
                        <TableHead className="py-1.5 text-xs font-medium whitespace-nowrap bg-muted/90">End Date</TableHead>
                        <TableHead className="py-1.5 text-xs font-medium text-right whitespace-nowrap bg-muted/90">Total BIDs</TableHead>
                        <TableHead className="py-1.5 text-xs font-medium text-right whitespace-nowrap bg-muted/90">Discrepancy (LC)</TableHead>
                        <TableHead className="py-1.5 text-xs font-medium text-right whitespace-nowrap bg-muted/90">Discrepancy (USD)</TableHead>
                        <TableHead className="py-1.5 text-xs font-medium whitespace-nowrap pr-3 bg-muted/90">TID Concentration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {MOCK_BREAKUP.map((row) => {
                        const isSelected = selectedRowKey === row.rowKey;
                        const isNoAction = row.actionPoint === "No action needed";
                        return (
                          <TableRow
                            key={row.rowKey}
                            onClick={() => handleRowClick(row.rowKey)}
                            className={`h-10 cursor-pointer transition-colors text-xs
                              ${isSelected ? "bg-blue-50/80 border-l-2 border-l-blue-400" : ""}
                              ${!isSelected && isNoAction ? "opacity-70 hover:bg-muted/20" : ""}
                              ${!isSelected && !isNoAction ? "hover:bg-muted/30" : ""}
                            `}
                          >
                            <TableCell className="py-1.5 pl-3 font-medium whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                {isSelected && <ChevronDown className="h-3.5 w-3.5 text-blue-500 shrink-0" />}
                                {!isSelected && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                                {subCategoryBadge(row.subCategory)}
                              </div>
                            </TableCell>
                            <TableCell className="py-1.5 text-center whitespace-nowrap">
                              {row.cancellable && (
                                <Badge variant={row.cancellable === "Yes" ? "outline" : "secondary"} className="text-xs py-0">
                                  {row.cancellable}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="py-1.5 text-right font-mono whitespace-nowrap text-xs">
                              {row.spNetLc !== 0 ? fmt(row.spNetLc) : "—"}
                            </TableCell>
                            <TableCell className="py-1.5 text-right font-mono whitespace-nowrap text-xs">
                              {row.hoNetLc !== 0 ? fmt(row.hoNetLc) : "—"}
                            </TableCell>
                            <TableCell className="py-1.5 text-center whitespace-nowrap">
                              {row.cancellationInsurance && (
                                <span className={`text-xs font-medium ${
                                  row.cancellationInsurance === "Yes" ? "text-blue-600" :
                                  row.cancellationInsurance === "No" ? "text-muted-foreground" :
                                  "text-muted-foreground"
                                }`}>{row.cancellationInsurance}</span>
                              )}
                            </TableCell>
                            <TableCell className="py-1.5 text-center whitespace-nowrap">
                              {row.chargeLoss && (
                                <Badge variant={row.chargeLoss === "TRUE" ? "outline" : "secondary"} className={`text-xs py-0 ${row.chargeLoss === "FALSE" ? "border-orange-200 bg-orange-50 text-orange-700" : "border-green-200 bg-green-50 text-green-700"}`}>
                                  {row.chargeLoss}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="py-1.5 max-w-[220px]">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="truncate">{actionBadge(row.actionPoint)}</div>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-[280px] text-xs">{row.actionPoint}</TooltipContent>
                              </Tooltip>
                            </TableCell>
                            <TableCell className="py-1.5 whitespace-nowrap">
                              <span className={`text-xs ${row.driTeam === "N/A" ? "text-muted-foreground" : "text-foreground font-medium"}`}>{row.driTeam}</span>
                            </TableCell>
                            <TableCell className="py-1.5 whitespace-nowrap text-xs">{row.fulfillment}</TableCell>
                            <TableCell className="py-1.5 text-right font-mono whitespace-nowrap">{row.bidCount}</TableCell>
                            <TableCell className="py-1.5 whitespace-nowrap font-mono text-xs">{row.startDate}</TableCell>
                            <TableCell className="py-1.5 whitespace-nowrap font-mono text-xs">{row.endDate}</TableCell>
                            <TableCell className="py-1.5 text-right font-mono whitespace-nowrap">{row.totalBids}</TableCell>
                            <TableCell className={`py-1.5 text-right font-mono whitespace-nowrap ${row.discLc < 0 ? "text-red-600" : row.discLc === 0 ? "text-muted-foreground" : "text-foreground"}`}>
                              {row.discLc !== 0 ? fmt(row.discLc) : "—"}
                            </TableCell>
                            <TableCell className={`py-1.5 text-right font-mono whitespace-nowrap ${row.discUsd < 0 ? "text-red-600" : row.discUsd === 0 ? "text-muted-foreground" : "text-foreground"}`}>
                              {row.discUsd !== 0 ? fmt(row.discUsd) : "—"}
                            </TableCell>
                            <TableCell className="py-1.5 font-mono text-xs text-muted-foreground pr-3 whitespace-nowrap">
                              {row.tidConcentration || "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Pinned total row — always visible at bottom, outside the scroll area */}
                <div className="border-t-2 bg-muted/70 shrink-0 overflow-x-auto">
                  <Table>
                    <TableBody>
                      <TableRow className="h-9">
                        <TableCell className="py-1.5 pl-3 text-xs font-bold text-foreground min-w-[210px] whitespace-nowrap">Total</TableCell>
                        <TableCell className="py-1.5 whitespace-nowrap" />
                        <TableCell className="py-1.5 text-right font-mono text-xs font-semibold whitespace-nowrap">{fmt(MOCK_BREAKUP.reduce((s,r)=>s+r.spNetLc,0))}</TableCell>
                        <TableCell className="py-1.5 text-right font-mono text-xs whitespace-nowrap">—</TableCell>
                        <TableCell className="py-1.5 text-center whitespace-nowrap" />
                        <TableCell className="py-1.5 text-center whitespace-nowrap" />
                        <TableCell className="py-1.5 min-w-[200px]" />
                        <TableCell className="py-1.5 whitespace-nowrap" />
                        <TableCell className="py-1.5 whitespace-nowrap" />
                        <TableCell className="py-1.5 text-right font-mono text-xs font-semibold whitespace-nowrap">{totalBidCount}</TableCell>
                        <TableCell className="py-1.5 whitespace-nowrap" />
                        <TableCell className="py-1.5 whitespace-nowrap" />
                        <TableCell className="py-1.5 text-right font-mono text-xs whitespace-nowrap">{MOCK_BREAKUP.reduce((s,r)=>s+r.totalBids,0)}</TableCell>
                        <TableCell className={`py-1.5 text-right font-mono text-xs font-bold whitespace-nowrap ${totalDiscLc < 0 ? "text-red-600" : ""}`}>
                          {fmt(totalDiscLc)}
                        </TableCell>
                        <TableCell className={`py-1.5 text-right font-mono text-xs font-bold whitespace-nowrap ${totalDiscUsd < 0 ? "text-red-600" : ""}`}>
                          {fmt(totalDiscUsd)}
                        </TableCell>
                        <TableCell className="py-1.5 pr-3 whitespace-nowrap" />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </div>
          </div>

          {/* Section 2: TID-Level Actions (shown when a row is selected) */}
          {selectedRowKey && selectedRow && (
            <div className="flex-1 overflow-auto">
              <div className="px-5 pt-3 pb-4">
                {/* Section header */}
                <div className="flex items-center gap-3 mb-3">
                  <button
                    onClick={() => setSelectedRowKey(null)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <div className="flex items-center gap-2">
                    {subCategoryBadge(selectedRow.subCategory)}
                    <span className="text-xs text-muted-foreground">· {selectedTids.length} TID{selectedTids.length !== 1 ? "s" : ""} · {selectedRow.bidCount} bookings</span>
                  </div>
                  {selectedRow.actionPoint !== "No action needed" && (
                    <div className="ml-auto flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded px-2.5 py-1 text-xs text-amber-700">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span className="truncate max-w-[320px]">{selectedRow.actionPoint}</span>
                    </div>
                  )}
                </div>

                {/* TID list */}
                <div className="space-y-2">
                  {selectedTids.map((tidRow) => {
                    const isExpanded = expandedTids.has(tidRow.tid);
                    return (
                      <Card key={tidRow.tid} className={`overflow-hidden border ${isExpanded ? "ring-1 ring-blue-200" : ""}`}>
                        {/* TID header row */}
                        <div
                          className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors
                            ${isExpanded ? "bg-blue-50/60" : "hover:bg-muted/30"}
                          `}
                          onClick={() => toggleTid(tidRow.tid)}
                        >
                          {isExpanded
                            ? <ChevronDown className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          }
                          <span className="font-mono text-xs font-semibold text-foreground">{tidRow.tid}</span>
                          <Badge variant="secondary" className="text-xs py-0 h-5">{tidRow.bidCount} BID{tidRow.bidCount !== 1 ? "s" : ""}</Badge>
                          <span className="text-xs text-muted-foreground">{tidRow.fulfillment}</span>
                          <span className={`text-xs font-medium ${tidRow.driTeam === "N/A" ? "text-muted-foreground" : "text-foreground"}`}>{tidRow.driTeam}</span>

                          <div className="ml-auto flex items-center gap-4">
                            <div className="text-right">
                              <div className="text-xs text-muted-foreground">SP Net</div>
                              <div className="font-mono text-xs font-semibold">{fmt(Math.abs(tidRow.spNetLc))}</div>
                            </div>
                            {tidRow.discLc !== 0 && (
                              <div className="text-right">
                                <div className="text-xs text-muted-foreground">Discrepancy</div>
                                <div className={`font-mono text-xs font-semibold ${tidRow.discLc < 0 ? "text-red-600" : "text-foreground"}`}>
                                  {fmt(tidRow.discLc)} LC / {fmt(tidRow.discUsd)} USD
                                </div>
                              </div>
                            )}

                            {/* Actions */}
                            {tidRow.hasActions ? (
                              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                <div className="flex items-center gap-1.5 border rounded px-2 py-1 bg-background">
                                  <DollarSign className="h-3 w-3 text-muted-foreground shrink-0" />
                                  <Input
                                    className="h-5 w-20 text-xs border-0 p-0 focus-visible:ring-0 font-mono"
                                    placeholder="Price..."
                                    value={priceValues[tidRow.tid] ?? ""}
                                    onChange={e => setPriceValues(prev => ({ ...prev, [tidRow.tid]: e.target.value }))}
                                  />
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2.5 text-xs border-amber-200 text-amber-700 hover:bg-amber-50"
                                  onClick={() => showToast(`Dispute raised for ${tidRow.tid}`)}
                                >
                                  <MessageSquareWarning className="h-3 w-3 mr-1" />
                                  Raise Dispute
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2.5 text-xs border-blue-200 text-blue-700 hover:bg-blue-50"
                                  onClick={() => showToast(`Issue raised for ${tidRow.tid}`)}
                                >
                                  <FileText className="h-3 w-3 mr-1" />
                                  Raise Issue
                                </Button>
                              </div>
                            ) : (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground italic">
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                No action required
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Expanded booking rows */}
                        {isExpanded && (
                          <div className="border-t">
                            <Table>
                              <TableHeader>
                                <TableRow className="h-7 bg-muted/40">
                                  <TableHead className="py-1 text-xs font-medium pl-8">Booking ID</TableHead>
                                  <TableHead className="py-1 text-xs font-medium">Experience Date</TableHead>
                                  <TableHead className="py-1 text-xs font-medium text-right">SP Net</TableHead>
                                  <TableHead className="py-1 text-xs font-medium text-right pr-4">HO Net</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {tidRow.bookings.map((b) => (
                                  <TableRow key={b.bookingId} className="h-8 hover:bg-muted/20">
                                    <TableCell className="py-1 pl-8 font-mono text-xs">{b.bookingId}</TableCell>
                                    <TableCell className="py-1 font-mono text-xs text-muted-foreground">{b.experienceDate}</TableCell>
                                    <TableCell className="py-1 text-right font-mono text-xs">{fmt(b.spNet)}</TableCell>
                                    <TableCell className="py-1 text-right font-mono text-xs pr-4 text-muted-foreground">{fmt(b.hoNet)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </Card>
                    );
                  })}
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
