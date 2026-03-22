import { useState, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  XCircle, AlertTriangle, ChevronRight,
  CheckCircle2, X as XIcon, Check, Zap,
} from "lucide-react";
import type { PrimaryRow } from "@shared/schema";

const fmt = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return dateStr; }
}

const CANCELLATION_SORT_ORDER: Record<string, number> = {
  "Cancelled-SP error": 0,
  "Cancelled-Check for Charge loss": 1,
  "Cancelled-DSS policy": 2,
  "Cancelled-OK": 3,
  "Cancelled-Insured Booking": 4,
  "Cancelled-Refund OK": 5,
};

const CANCELLATION_ACTION_POINTS: Record<string, string> = {
  "Cancelled-OK": "No action needed",
  "Cancelled-Refund OK": "No action needed",
  "Cancelled-SP error": "Raise debit note to SP",
  "Cancelled-Insured Booking": "Claim from insurance",
  "Cancelled-DSS policy": "Covered under DSS policy",
  "Cancelled-Check for Charge loss": "Verify charge loss; raise debit note if applicable",
};

const CANCELLATION_FULFILLMENT_SPLIT = new Set(["Cancelled-SP error", "Cancelled-Check for Charge loss"]);

function getCancellationDriTeam(reason: string, fulfillmentMethod: string): string {
  const noAction = ["Cancelled-OK", "Cancelled-Refund OK", "Cancelled-Insured Booking", "Cancelled-DSS policy"];
  if (noAction.includes(reason)) return "N/A";
  const fm = fulfillmentMethod.trim().toLowerCase();
  if (fm === "freesale") return "Tech";
  if (fm === "manual") return "Reservation Ops";
  if (fm === "selenium") return "Selenium";
  if (fm === "prepurchase" || fm === "pre-purchase" || fm === "pre_purchase" || fm === "pre purchase") return "Inventory Ops";
  if (fm === "vendor api" || fm === "vendorapi" || fm === "vendor-api" || fm === "vendor_api") return "Tech";
  if (fm === "vendor request" || fm === "vendorrequest" || fm === "vendor-request" || fm === "vendor_request") return "Tech";
  return "Unknown";
}

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
  bookings: PrimaryRow[];
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
  paxRows: PaxRow[];
  bookingIds: string[];
}

type TakeActionState = {
  rowKey: string;
  tidFinalPrices: Record<string, string>;
  paxPrices: Record<string, string>;
  expandedPaxTids: Set<string>;
  disputeTids: Set<string>;
  disputeAmounts: Record<string, string>;
  issueTids: Set<string>;
  expandedBidTids: Set<string>;
} | null;

function subCategoryBadge(sub: string) {
  const colors: Record<string, string> = {
    "Cancelled-SP error": "bg-red-100 text-red-700 border-red-200",
    "Cancelled-Check for Charge loss": "bg-orange-100 text-orange-700 border-orange-200",
    "Cancelled-Insured Booking": "bg-blue-100 text-blue-700 border-blue-200",
    "Cancelled-DSS policy": "bg-violet-100 text-violet-700 border-violet-200",
    "Cancelled-OK": "bg-green-100 text-green-700 border-green-200",
    "Cancelled-Refund OK": "bg-emerald-100 text-emerald-700 border-emerald-200",
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

interface CancellationsWorkspaceProps {
  cancellationBookings: PrimaryRow[];
  allRows: PrimaryRow[];
  currency: string;
  beId: string;
  supplierName: string;
  onClose: () => void;
  fxData?: { usdToCcy?: Record<string, number> } | null;
}

export function CancellationsWorkspace({
  cancellationBookings,
  allRows,
  currency,
  beId,
  supplierName,
  onClose,
  fxData,
}: CancellationsWorkspaceProps) {
  const [takeAction, setTakeAction] = useState<TakeActionState>(null);
  const [doneRows, setDoneRows] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [committedDisputes, setCommittedDisputes] = useState<Record<string, number>>({});
  const [tapOverrides, setTapOverrides] = useState<Record<string, string>>({});
  const [tapConfirmedRows, setTapConfirmedRows] = useState<Set<string>>(new Set());

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const breakupRows = useMemo((): BreakupRow[] => {
    const byReason: Record<string, PrimaryRow[]> = {};
    for (const b of cancellationBookings) {
      if (!byReason[b.reason]) byReason[b.reason] = [];
      byReason[b.reason].push(b);
    }

    function getBookingDate(b: PrimaryRow): string {
      return b.experienceDate || b.bookingCreationDate || "";
    }

    function chronoSort(dates: string[]): string[] {
      return dates.filter(Boolean).sort((a, b) => {
        const ta = new Date(a).getTime();
        const tb = new Date(b).getTime();
        if (isNaN(ta) && isNaN(tb)) return a.localeCompare(b);
        if (isNaN(ta)) return 1;
        if (isNaN(tb)) return -1;
        return ta - tb;
      });
    }

    function calcDiscUSD(bkgs: PrimaryRow[]): number {
      return bkgs.reduce((s, b) => s + b.differenceUsd, 0);
    }

    function topTids(bkgs: PrimaryRow[]): string {
      const tidCounts: Record<string, number> = {};
      for (const b of bkgs) {
        const tid = b.tid || b.bookingId;
        tidCounts[tid] = (tidCounts[tid] || 0) + 1;
      }
      return Object.entries(tidCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([tid]) => tid)
        .join(", ");
    }

    function dominantValue(bkgs: PrimaryRow[], field: "cancellable" | "cancellationInsurance" | "chargedLoss"): string {
      const vals = bkgs.map(b => {
        if (field === "cancellable") return b.cancellable || "";
        if (field === "cancellationInsurance") return b.cancellationInsurance || "";
        if (field === "chargedLoss") return b.chargedLoss || "";
        return "";
      }).filter(Boolean);
      if (vals.length === 0) return "";
      const counts: Record<string, number> = {};
      for (const v of vals) counts[v] = (counts[v] || 0) + 1;
      return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }

    const rows: BreakupRow[] = [];

    for (const [reason, bkgs] of Object.entries(byReason)) {
      const totalBidsForReason = bkgs.length;

      if (CANCELLATION_FULFILLMENT_SPLIT.has(reason)) {
        const byFm: Record<string, PrimaryRow[]> = {};
        for (const b of bkgs) {
          const fm = b.fulfillmentMethod || "Unknown";
          if (!byFm[fm]) byFm[fm] = [];
          byFm[fm].push(b);
        }
        for (const [fm, fmBookings] of Object.entries(byFm)) {
          const dates = chronoSort(fmBookings.map(getBookingDate));
          const spNetLc = fmBookings.reduce((s, b) => s + b.spNetInHo, 0);
          const hoNetLc = fmBookings.reduce((s, b) => s + b.hoNet, 0);
          const discLc = hoNetLc - spNetLc;
          rows.push({
            rowKey: `${reason}__${fm}`,
            subCategory: reason,
            cancellable: dominantValue(fmBookings, "cancellable"),
            spNetLc,
            hoNetLc,
            cancellationInsurance: dominantValue(fmBookings, "cancellationInsurance"),
            chargeLoss: dominantValue(fmBookings, "chargedLoss"),
            actionPoint: CANCELLATION_ACTION_POINTS[reason] || "",
            driTeam: getCancellationDriTeam(reason, fm),
            fulfillment: fm,
            bidCount: fmBookings.length,
            startDate: dates[0] || "",
            endDate: dates[dates.length - 1] || "",
            totalBids: totalBidsForReason,
            discLc,
            discUsd: calcDiscUSD(fmBookings),
            tidConcentration: topTids(fmBookings),
            bookings: fmBookings,
          });
        }
      } else {
        const fmSet = new Set<string>();
        for (const b of bkgs) {
          if (b.fulfillmentMethod) fmSet.add(b.fulfillmentMethod);
        }
        const dates = chronoSort(bkgs.map(getBookingDate));
        const spNetLc = bkgs.reduce((s, b) => s + b.spNetInHo, 0);
        const hoNetLc = bkgs.reduce((s, b) => s + b.hoNet, 0);
        const discLc = hoNetLc - spNetLc;
        rows.push({
          rowKey: reason,
          subCategory: reason,
          cancellable: dominantValue(bkgs, "cancellable"),
          spNetLc,
          hoNetLc,
          cancellationInsurance: dominantValue(bkgs, "cancellationInsurance"),
          chargeLoss: dominantValue(bkgs, "chargedLoss"),
          actionPoint: CANCELLATION_ACTION_POINTS[reason] || "",
          driTeam: getCancellationDriTeam(reason, fmSet.size > 0 ? Array.from(fmSet)[0] : ""),
          fulfillment: fmSet.size > 0 ? Array.from(fmSet).join(", ") : "—",
          bidCount: bkgs.length,
          startDate: dates[0] || "",
          endDate: dates[dates.length - 1] || "",
          totalBids: totalBidsForReason,
          discLc,
          discUsd: calcDiscUSD(bkgs),
          tidConcentration: topTids(bkgs),
          bookings: bkgs,
        });
      }
    }

    rows.sort((a, b) => {
      const ai = CANCELLATION_SORT_ORDER[a.subCategory] ?? 99;
      const bi = CANCELLATION_SORT_ORDER[b.subCategory] ?? 99;
      return ai - bi;
    });

    return rows;
  }, [cancellationBookings]);

  const tidsByRow = useMemo((): Record<string, TidRow[]> => {
    const result: Record<string, TidRow[]> = {};
    for (const row of breakupRows) {
      const byTid: Record<string, PrimaryRow[]> = {};
      for (const b of row.bookings) {
        const tid = b.tid || b.bookingId;
        if (!byTid[tid]) byTid[tid] = [];
        byTid[tid].push(b);
      }
      const tidRows: TidRow[] = [];
      for (const [tid, bkgs] of Object.entries(byTid)) {
        const spNetLc = bkgs.reduce((s, b) => s + b.spNetInHo, 0);
        const discLc = bkgs.reduce((s, b) => s + (b.hoNet - b.spNetInHo), 0);
        const discUsd = bkgs.reduce((s, b) => s + b.differenceUsd, 0);
        const fm = bkgs[0]?.fulfillmentMethod || "Unknown";
        const driTeam = getCancellationDriTeam(row.subCategory, fm);

        const paxRows: PaxRow[] = [];
        let hasPax = false;
        for (const b of bkgs) {
          if (b.paxBreakdown && b.paxBreakdown.length > 0) {
            hasPax = true;
            for (const p of b.paxBreakdown) {
              const dateRange = b.experienceDate || b.bookingCreationDate || "—";
              const existing = paxRows.find(
                pr => pr.paxType === p.paxType && pr.dateRange === formatDate(dateRange) && pr.spUnit === p.unitPrice
              );
              if (existing) {
                existing.count += p.count;
              } else {
                paxRows.push({
                  paxType: p.paxType,
                  dateRange: formatDate(dateRange),
                  count: p.count,
                  spUnit: p.unitPrice,
                  hoUnit: 0,
                });
              }
            }
          }
        }

        tidRows.push({
          tid,
          bidCount: bkgs.length,
          spNetLc,
          discLc,
          discUsd,
          fulfillment: fm,
          driTeam,
          hasPax,
          paxRows,
          bookingIds: bkgs.map(b => b.bookingId),
        });
      }
      tidRows.sort((a, b) => Math.abs(b.spNetLc) - Math.abs(a.spNetLc));
      result[row.rowKey] = tidRows;
    }
    return result;
  }, [breakupRows]);

  const totalDiscLc = breakupRows.reduce((s, r) => s + r.discLc, 0);
  const totalDiscUsd = breakupRows.reduce((s, r) => s + r.discUsd, 0);
  const totalBidCount = breakupRows.reduce((s, r) => s + r.bidCount, 0);

  const selectedRow = takeAction ? breakupRows.find(r => r.rowKey === takeAction.rowKey) ?? null : null;
  const selectedTids = takeAction ? (tidsByRow[takeAction.rowKey] ?? []) : [];

  const getTidFinalPrice = useCallback((tid: TidRow): number => {
    if (!takeAction) return 0;
    if (tid.hasPax) return computePaxTotal(tid, takeAction.paxPrices);
    const raw = parseFloat(takeAction.tidFinalPrices[tid.tid] ?? "") || 0;
    return raw;
  }, [takeAction]);

  const totalPayable = takeAction
    ? selectedTids.reduce((s, t) => s + getTidFinalPrice(t), 0)
    : 0;
  const totalDisputeAmt = takeAction
    ? [...takeAction.disputeTids].reduce((s, tid) => {
        const amt = parseFloat(takeAction.disputeAmounts[tid] ?? "0") || 0;
        return s + amt;
      }, 0)
    : 0;
  const disputeCount = takeAction ? takeAction.disputeTids.size : 0;
  const issueCount = takeAction ? takeAction.issueTids.size : 0;

  const openTakeAction = useCallback((rowKey: string) => {
    const tids = tidsByRow[rowKey] ?? [];
    const tidFinalPrices: Record<string, string> = {};
    tids.forEach(t => {
      if (!t.hasPax) tidFinalPrices[t.tid] = String(Math.abs(t.spNetLc));
    });
    const disputeTids = new Set(tids.map(t => t.tid));
    const disputeAmounts: Record<string, string> = {};
    tids.forEach(t => { disputeAmounts[t.tid] = String(Math.abs(t.spNetLc)); });
    setTakeAction({
      rowKey,
      tidFinalPrices,
      paxPrices: {},
      expandedPaxTids: new Set(),
      disputeTids,
      disputeAmounts,
      issueTids: new Set(),
      expandedBidTids: new Set(),
    });
  }, [tidsByRow]);

  const confirmAction = useCallback(() => {
    if (!takeAction || !selectedRow) return;
    const rowKey = takeAction.rowKey;
    const totalDisp = [...takeAction.disputeTids].reduce((s, tid) => {
      const amt = parseFloat(takeAction.disputeAmounts[tid] ?? "0") || 0;
      return s + amt;
    }, 0);
    setCommittedDisputes(prev => ({ ...prev, [rowKey]: totalDisp }));
    setTapConfirmedRows(prev => { const next = new Set(prev); next.delete(rowKey); return next; });
    setTapOverrides(prev => { const next = { ...prev }; delete next[rowKey]; return next; });
    const m = selectedRow.bidCount;
    const d = disputeCount;
    const i = issueCount;
    showToast(`Applied — ${m} bookings · ${d} dispute${d !== 1 ? "s" : ""} raised · ${i} issue${i !== 1 ? "s" : ""} logged`);
    setDoneRows(prev => new Set(prev).add(rowKey));
    setTakeAction(null);
  }, [takeAction, selectedRow, disputeCount, issueCount, showToast]);

  const updateTA = useCallback((patch: Partial<NonNullable<TakeActionState>>) => {
    setTakeAction(prev => prev ? { ...prev, ...patch } : prev);
  }, []);

  const liveDispute = useCallback((rowKey: string): number => {
    if (takeAction?.rowKey === rowKey) {
      return [...takeAction.disputeTids].reduce((s, tid) => {
        const amt = parseFloat(takeAction.disputeAmounts[tid] ?? "0") || 0;
        return s + amt;
      }, 0);
    }
    return committedDisputes[rowKey] ?? 0;
  }, [takeAction, committedDisputes]);

  if (cancellationBookings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20">
        <XCircle className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-muted-foreground">No cancellation bookings found.</p>
        <Button variant="outline" className="mt-4" onClick={onClose}>Close</Button>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full text-sm" data-testid="cancellations-workspace">

        {/* Header */}
        <div className="border-b bg-card px-5 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <XCircle className="h-4 w-4 text-red-500" />
            <span className="font-semibold text-sm tracking-tight">Cancellations — Manage</span>
            <Badge variant="outline" className="text-xs font-mono">{beId} · {supplierName}</Badge>
            <Badge variant="outline" className="text-xs font-mono">{currency}</Badge>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{totalBidCount} bookings</span>
            <span className="text-xs font-mono font-semibold text-red-600" data-testid="total-disc-usd">{fmt(Math.abs(totalDiscUsd))} USD discrepancy</span>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose} data-testid="close-workspace">
              <XIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* SECTION 1: Analysis Breakup Table */}
          <div
            className="border-b overflow-auto shrink-0 transition-all"
            style={{ maxHeight: takeAction ? "40%" : "55%" }}
          >
            <div className="px-5 pt-4 pb-2">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wide">Cancellation Breakup</span>
                  <Badge variant="secondary" className="text-xs">{breakupRows.length} rows</Badge>
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
                      {breakupRows.map((row) => {
                        const isDone = doneRows.has(row.rowKey);
                        const isActive = takeAction?.rowKey === row.rowKey;
                        return (
                          <TableRow
                            key={row.rowKey}
                            className={`h-10 text-xs transition-colors
                              ${isActive ? "bg-blue-50/70 dark:bg-blue-950/30 border-l-2 border-l-blue-400" : "hover:bg-muted/20"}
                              ${isDone ? "bg-green-50/40 dark:bg-green-950/20" : ""}
                            `}
                            data-testid={`breakup-row-${row.rowKey}`}
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
                            <TableCell className="py-1.5 text-right font-mono whitespace-nowrap">{row.hoNetLc !== 0 ? fmt(row.hoNetLc) : "—"}</TableCell>
                            <TableCell className="py-1.5 text-center whitespace-nowrap">
                              {row.cancellationInsurance && (
                                <span className={`text-xs font-medium ${row.cancellationInsurance === "Yes" ? "text-blue-600" : "text-muted-foreground"}`}>{row.cancellationInsurance}</span>
                              )}
                            </TableCell>
                            <TableCell className="py-1.5 text-center whitespace-nowrap">
                              {row.chargeLoss && (
                                <Badge variant="secondary" className={`text-xs py-0 ${row.chargeLoss === "FALSE" ? "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300" : "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300"}`}>{row.chargeLoss}</Badge>
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
                            <TableCell className="py-1.5 whitespace-nowrap font-mono text-xs">{formatDate(row.startDate)}</TableCell>
                            <TableCell className="py-1.5 whitespace-nowrap font-mono text-xs">{formatDate(row.endDate)}</TableCell>
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
                <div className="border-t-2 bg-muted/60 px-3 py-1.5 flex items-center text-xs font-semibold">
                  <span className="min-w-[200px] pl-0">Total</span>
                  <span className="flex-1" />
                  <span className="font-mono mr-6">{fmt(breakupRows.reduce((s, r) => s + r.spNetLc, 0))}</span>
                  <span className="font-mono mr-6">{fmt(breakupRows.reduce((s, r) => s + r.hoNetLc, 0))}</span>
                  <span className="flex-1" />
                  <span className="font-mono mr-4">{totalBidCount}</span>
                  <span className="flex-1" />
                  <span className={`font-mono mr-4 ${totalDiscLc < 0 ? "text-red-600" : ""}`}>{fmt(totalDiscLc)}</span>
                  <span className={`font-mono ${totalDiscUsd < 0 ? "text-red-600" : ""}`}>{fmt(totalDiscUsd)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: Amount Payable (idle) / Take Action panel (active) */}
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Active: Take Action panel */}
            {takeAction && selectedRow && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Panel header */}
                <div className="px-5 py-2.5 border-b bg-card shrink-0 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 min-w-0">
                    {subCategoryBadge(selectedRow.subCategory)}
                    {selectedRow.actionPoint !== "No action needed" && (
                      <div className="hidden sm:flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded px-2 py-1 max-w-[320px]">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        <span className="truncate">{selectedRow.actionPoint}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-muted-foreground">{selectedTids.length} TIDs · {selectedRow.bidCount} bookings</span>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setTakeAction(null)} data-testid="close-take-action">
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Body: all-in-one */}
                <div className="flex-1 overflow-auto">
                  <div className="px-5 py-4 space-y-5">
                    {/* TIDs · Final Price · Disputes · Issues · BIDs */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">TIDs · Final Price · Disputes · Issues · BIDs</div>
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" variant="outline" className="h-6 text-xs"
                            onClick={() => updateTA({ disputeTids: new Set(selectedTids.map(t => t.tid)), issueTids: new Set(selectedTids.map(t => t.tid)) })}
                            data-testid="select-all-tids"
                          >
                            Select all
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 text-xs"
                            onClick={() => updateTA({ disputeTids: new Set(), issueTids: new Set() })}
                            data-testid="clear-all-tids"
                          >
                            Clear all
                          </Button>
                        </div>
                      </div>

                      <div className="rounded-md border overflow-hidden">
                        {/* Table header */}
                        <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto_auto] items-center h-8 bg-muted/40 px-3 text-xs font-medium text-muted-foreground border-b gap-2">
                          <div>TID / Fulfillment</div>
                          <div className="w-12 text-center">BIDs</div>
                          <div className="w-20 text-right">SP Net</div>
                          <div className="w-28 text-right">Final Price</div>
                          <div className="w-10 text-center">Disp?</div>
                          <div className="w-24 text-right">Disp. Amt</div>
                          <div className="w-10 text-center">Issue?</div>
                          <div className="w-28">DRI</div>
                        </div>

                        {selectedTids.map(tid => {
                          const isPaxExpanded = takeAction.expandedPaxTids.has(tid.tid);
                          const isBidExpanded = takeAction.expandedBidTids.has(tid.tid);
                          const disputeChecked = takeAction.disputeTids.has(tid.tid);
                          const issueChecked = takeAction.issueTids.has(tid.tid);
                          const paxTotal = tid.hasPax ? computePaxTotal(tid, takeAction.paxPrices) : 0;
                          const rowBg = disputeChecked && issueChecked
                            ? "bg-orange-50/40 dark:bg-orange-950/20"
                            : disputeChecked
                            ? "bg-amber-50/30 dark:bg-amber-950/20"
                            : issueChecked
                            ? "bg-orange-50/20 dark:bg-orange-950/10"
                            : "bg-background";
                          return (
                            <div key={tid.tid} className="border-b last:border-0">
                              {/* Main TID row */}
                              <div className={`grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto_auto] items-center px-3 h-11 gap-2 transition-colors ${rowBg}`} data-testid={`tid-row-${tid.tid}`}>
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="font-mono text-sm font-medium text-primary truncate">{tid.tid}</span>
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">{tid.fulfillment}</Badge>
                                </div>
                                {/* BID expand chip */}
                                <button
                                  className="w-12 h-6 text-xs font-mono rounded bg-muted/60 hover:bg-muted flex items-center justify-center gap-0.5 shrink-0 transition-colors"
                                  onClick={() => {
                                    const next = new Set(takeAction.expandedBidTids);
                                    isBidExpanded ? next.delete(tid.tid) : next.add(tid.tid);
                                    updateTA({ expandedBidTids: next });
                                  }}
                                  title={isBidExpanded ? "Collapse BIDs" : "Show BIDs"}
                                  data-testid={`bid-expand-${tid.tid}`}
                                >
                                  {tid.bidCount}
                                  <ChevronRight className={`h-2.5 w-2.5 transition-transform duration-150 ${isBidExpanded ? "rotate-90" : ""}`} />
                                </button>
                                {/* SP Net */}
                                <div className="w-20 text-right font-mono text-xs text-blue-700 dark:text-blue-400">{fmt(Math.abs(tid.spNetLc))}</div>
                                {/* Final Price */}
                                <div className="w-28 flex items-center justify-end gap-1">
                                  {tid.hasPax ? (
                                    <>
                                      <span className={`font-mono text-xs font-semibold ${paxTotal > 0 ? "text-violet-700 dark:text-violet-400" : "text-muted-foreground"}`}>
                                        {paxTotal > 0 ? fmt(paxTotal) : "—"}
                                      </span>
                                      <button
                                        onClick={() => {
                                          const next = new Set(takeAction.expandedPaxTids);
                                          isPaxExpanded ? next.delete(tid.tid) : next.add(tid.tid);
                                          updateTA({ expandedPaxTids: next });
                                        }}
                                        className="h-5 px-1.5 text-[10px] font-medium rounded bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-900 dark:text-violet-300 dark:hover:bg-violet-800 flex items-center gap-0.5 shrink-0 transition-colors"
                                        data-testid={`pax-toggle-${tid.tid}`}
                                      >
                                        Pax <ChevronRight className={`h-2.5 w-2.5 transition-transform duration-150 ${isPaxExpanded ? "rotate-90" : ""}`} />
                                      </button>
                                    </>
                                  ) : (
                                    <Input
                                      className="h-7 w-28 text-xs text-right font-mono border-dashed"
                                      value={takeAction.tidFinalPrices[tid.tid] ?? ""}
                                      onChange={e => updateTA({ tidFinalPrices: { ...takeAction.tidFinalPrices, [tid.tid]: e.target.value } })}
                                      placeholder={fmt(Math.abs(tid.spNetLc))}
                                      data-testid={`final-price-${tid.tid}`}
                                    />
                                  )}
                                </div>
                                {/* Dispute checkbox */}
                                <div className="w-10 flex justify-center">
                                  <Checkbox
                                    checked={disputeChecked}
                                    onCheckedChange={v => {
                                      const next = new Set(takeAction.disputeTids);
                                      v ? next.add(tid.tid) : next.delete(tid.tid);
                                      updateTA({ disputeTids: next });
                                    }}
                                    className="h-3.5 w-3.5"
                                    data-testid={`dispute-check-${tid.tid}`}
                                  />
                                </div>
                                {/* Dispute amount */}
                                <div className="w-24">
                                  <Input
                                    disabled={!disputeChecked}
                                    className="h-7 text-xs text-right font-mono border-dashed"
                                    value={takeAction.disputeAmounts[tid.tid] ?? ""}
                                    onChange={e => updateTA({ disputeAmounts: { ...takeAction.disputeAmounts, [tid.tid]: e.target.value } })}
                                    placeholder="0.00"
                                    data-testid={`dispute-amt-${tid.tid}`}
                                  />
                                </div>
                                {/* Issue checkbox */}
                                <div className="w-10 flex justify-center">
                                  <Checkbox
                                    checked={issueChecked}
                                    onCheckedChange={v => {
                                      const next = new Set(takeAction.issueTids);
                                      v ? next.add(tid.tid) : next.delete(tid.tid);
                                      updateTA({ issueTids: next });
                                    }}
                                    className="h-3.5 w-3.5"
                                    data-testid={`issue-check-${tid.tid}`}
                                  />
                                </div>
                                {/* DRI Team */}
                                <div className="w-28">
                                  <Badge variant="outline" className={`text-[10px] ${tid.driTeam !== "N/A" ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800" : "text-muted-foreground"}`}>
                                    {tid.driTeam}
                                  </Badge>
                                </div>
                              </div>
                              {/* BID sub-row */}
                              {isBidExpanded && (
                                <div className="px-4 py-2.5 bg-muted/20 border-t flex flex-wrap gap-1.5" data-testid={`bid-list-${tid.tid}`}>
                                  <span className="text-[10px] font-medium text-muted-foreground mr-1 self-center">Booking IDs:</span>
                                  {tid.bookingIds.map(bid => (
                                    <span key={bid} className="font-mono text-[10px] bg-background border rounded px-1.5 py-0.5">{bid}</span>
                                  ))}
                                </div>
                              )}
                              {/* Pax pricing sub-panel */}
                              {isPaxExpanded && (
                                <div className="px-4 py-3 bg-violet-50/40 dark:bg-violet-950/20 border-t border-violet-100 dark:border-violet-900 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-violet-700 dark:text-violet-300">Pax Pricing — {tid.tid}</span>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-muted-foreground">
                                        Total: <span className="font-mono font-semibold text-violet-700 dark:text-violet-300">{fmt(paxTotal)}</span>
                                      </span>
                                      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => {
                                        const next = new Set(takeAction.expandedPaxTids);
                                        next.delete(tid.tid);
                                        updateTA({ expandedPaxTids: next });
                                      }}>
                                        <Check className="h-3 w-3 mr-1" /> Done
                                      </Button>
                                    </div>
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
                                          <TableHead className="py-1 text-xs text-right pr-3">Final Unit Price</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {tid.paxRows.map(pr => {
                                          const key = `${tid.tid}__${pr.paxType}__${pr.dateRange}`;
                                          const unitVal = takeAction.paxPrices[key] ?? "";
                                          const computed = (parseFloat(unitVal) || pr.spUnit) * pr.count;
                                          return (
                                            <TableRow key={key} className="h-8">
                                              <TableCell className="py-1 pl-3 text-xs font-medium">{pr.paxType}</TableCell>
                                              <TableCell className="py-1 text-xs text-muted-foreground">{pr.dateRange}</TableCell>
                                              <TableCell className="py-1 text-right text-xs">{pr.count}</TableCell>
                                              <TableCell className="py-1 text-right font-mono text-xs text-blue-600">{fmt(pr.spUnit)}</TableCell>
                                              <TableCell className="py-1 text-right font-mono text-xs text-green-600">{fmt(pr.hoUnit)}</TableCell>
                                              <TableCell className="py-1 text-right pr-3">
                                                <div className="flex items-center justify-end gap-1.5">
                                                  <span className="text-[10px] text-muted-foreground font-mono">= {fmt(computed)}</span>
                                                  <Input
                                                    className="h-6 w-20 text-xs text-right font-mono ml-auto border-dashed"
                                                    value={unitVal}
                                                    onChange={e => updateTA({ paxPrices: { ...takeAction.paxPrices, [key]: e.target.value } })}
                                                    placeholder={String(pr.spUnit)}
                                                    data-testid={`pax-price-${key}`}
                                                  />
                                                </div>
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
                    </div>
                  </div>
                </div>

                {/* Bottom bar */}
                <div className="border-t bg-card px-5 py-3 shrink-0 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Pay:</span>
                      <span className="font-mono font-semibold text-blue-700 dark:text-blue-400" data-testid="total-pay">
                        {fmt(totalPayable)} {currency}
                      </span>
                    </div>
                    <div className="h-3 w-px bg-border" />
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Disputes:</span>
                      <span className={`font-mono font-semibold ${disputeCount > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                        {disputeCount > 0 ? `${disputeCount} TIDs · ${fmt(totalDisputeAmt)} ${currency}` : "none"}
                      </span>
                    </div>
                    <div className="h-3 w-px bg-border" />
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Issues:</span>
                      <span className={`font-mono font-semibold ${issueCount > 0 ? "text-orange-700 dark:text-orange-400" : "text-muted-foreground"}`}>
                        {issueCount > 0 ? `${issueCount} TIDs` : "none"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setTakeAction(null)} data-testid="cancel-action">Cancel</Button>
                    <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={confirmAction} data-testid="confirm-action">
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Confirm & Apply
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Idle: Amount Payable Summary Table */}
            {!takeAction && (
              <div className="flex-1 overflow-auto">
                <div className="px-5 pt-2.5 pb-1.5 flex items-center gap-2 sticky top-0 bg-background z-10 border-b">
                  <span className="text-xs font-semibold uppercase tracking-wide">Amount Payable</span>
                  <Badge variant="secondary" className="text-xs">{breakupRows.length} rows</Badge>
                  <span className="ml-auto text-xs text-muted-foreground">Confirm payable amount · click ⚡ to raise disputes &amp; log issues</span>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow className="h-7 bg-muted/50">
                      {[
                        { label: "Sub Category", cls: "pl-3 min-w-[200px]", align: "" },
                        { label: "BID Count", cls: "", align: "text-right" },
                        { label: "SP Net LC", cls: "", align: "text-right" },
                        { label: "HO Net LC", cls: "", align: "text-right" },
                        { label: "Disc. LC", cls: "", align: "text-right" },
                        { label: "Disc. USD", cls: "", align: "text-right" },
                        { label: "Dispute Raised", cls: "", align: "text-right" },
                        { label: "Total Amount Payable", cls: "min-w-[200px]", align: "text-right" },
                        { label: "Action", cls: "pr-3 text-center", align: "" },
                      ].map(col => (
                        <TableHead key={col.label} className={`py-1 text-xs font-medium bg-muted/50 whitespace-nowrap ${col.align} ${col.cls}`}>
                          {col.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {breakupRows.map(row => {
                      const disputeAmt = liveDispute(row.rowKey);
                      const absSpNet = Math.abs(row.spNetLc);
                      const defaultTap = Math.max(0, absSpNet - disputeAmt);
                      const tapStr = tapOverrides[row.rowKey] !== undefined
                        ? tapOverrides[row.rowKey]
                        : defaultTap.toFixed(2);
                      const isConfirmed = tapConfirmedRows.has(row.rowKey);
                      const isDone = doneRows.has(row.rowKey);
                      return (
                        <TableRow
                          key={row.rowKey}
                          className={`h-8 text-xs ${isConfirmed ? "bg-green-50/70 dark:bg-green-950/20" : ""}`}
                          data-testid={`payable-row-${row.rowKey}`}
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
                                data-testid={`tap-input-${row.rowKey}`}
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
                                data-testid={`tap-confirm-${row.rowKey}`}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                          {/* Action cell */}
                          <TableCell className="py-1 pr-3 text-center">
                            {isDone ? (
                              <Badge className="gap-1 bg-green-50 text-green-700 border-green-200 hover:bg-green-50 dark:bg-green-950 dark:text-green-300 dark:border-green-800 text-[11px] font-medium px-2 py-0.5" data-testid={`done-badge-${row.rowKey}`}>
                                <CheckCircle2 className="h-3 w-3" /> Done
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                className="h-7 text-xs gap-1 bg-primary hover:bg-primary/90 text-primary-foreground"
                                onClick={() => openTakeAction(row.rowKey)}
                                data-testid={`take-action-${row.rowKey}`}
                              >
                                <Zap className="h-3 w-3" /> Take Action
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>

                  {/* Totals footer */}
                  <tfoot>
                    <tr className="border-t-2 bg-muted/40 text-xs font-semibold">
                      <td className="py-2 pl-3">Totals</td>
                      <td className="py-2 text-right font-mono pr-2">{breakupRows.reduce((s, r) => s + r.bidCount, 0)}</td>
                      <td className="py-2 text-right font-mono pr-2 text-red-600">
                        {fmt(breakupRows.reduce((s, r) => s + r.spNetLc, 0))}
                      </td>
                      <td className="py-2 text-right font-mono pr-2">
                        {fmt(breakupRows.reduce((s, r) => s + r.hoNetLc, 0))}
                      </td>
                      <td className={`py-2 text-right font-mono pr-2 ${totalDiscLc < 0 ? "text-red-600" : ""}`}>
                        {fmt(totalDiscLc)}
                      </td>
                      <td className={`py-2 text-right font-mono pr-2 ${totalDiscUsd < 0 ? "text-red-600" : ""}`}>
                        {fmt(totalDiscUsd)}
                      </td>
                      <td className="py-2 text-right font-mono pr-2 text-amber-600">
                        {(() => {
                          const tot = breakupRows.reduce((s, r) => s + liveDispute(r.rowKey), 0);
                          return tot > 0 ? fmt(tot) : "—";
                        })()}
                      </td>
                      <td className="py-2 text-right font-mono pr-2">
                        {fmt(breakupRows.reduce((s, r) => {
                          const d = liveDispute(r.rowKey);
                          const def = Math.max(0, Math.abs(r.spNetLc) - d);
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

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-4 right-4 flex items-center gap-2 bg-foreground text-background text-xs px-3 py-2 rounded shadow-lg z-50" data-testid="toast-notification">
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
