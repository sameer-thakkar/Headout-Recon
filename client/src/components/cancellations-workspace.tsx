import { useState, useMemo, useCallback, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  XCircle, AlertTriangle, ChevronRight, ChevronDown,
  CheckCircle2, X as XIcon, Check, Zap,
  TrendingUp, TrendingDown, Calculator, Gavel, FileWarning,
  Loader2, Save,
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

function normalizeDate(d: string): Date | null {
  const num = Number(d);
  if (!isNaN(num) && num > 10000 && num < 100000) {
    const epoch = new Date((num - 25569) * 86400000);
    if (!isNaN(epoch.getTime())) return epoch;
  }
  const ts = Date.parse(d);
  if (!isNaN(ts)) {
    const dt = new Date(ts);
    if (dt.getFullYear() > 1900 && dt.getFullYear() < 2200) return dt;
  }
  return null;
}

type PaxDateRow = {
  paxType: string;
  dateRange: string;
  dates: string[];
  count: number;
  spUnitPrice: number;
  hoUnitPrice: number;
  rowKey: string;
};

function buildPaxDateRows(bookings: PrimaryRow[]): { paxDateRows: PaxDateRow[]; dateToRowKeyMap: Map<string, string> } {
  const paymentBasis = bookings.find(b => b.paymentBasis)?.paymentBasis || "";
  const dateField: "experienceDate" | "bookingCreationDate" =
    paymentBasis.toUpperCase().includes("EXPERIENCE") ? "experienceDate" : "bookingCreationDate";

  const dateGroupKey = (b: PrimaryRow) => {
    const raw = dateField === "experienceDate" ? (b.experienceDate || "") : (b.bookingCreationDate || "");
    if (!raw) return "Unknown";
    const dt = normalizeDate(raw);
    return dt ? dt.toISOString() : "Unknown";
  };

  const byDateAndPax = new Map<string, {
    paxType: string;
    date: string;
    count: number;
    spTotal: number;
    hoUnitPrice: number;
  }>();

  for (const b of bookings) {
    if (!b.paxBreakdown) continue;
    const date = dateGroupKey(b);
    const bookingHoTotal = b.paxBreakdown.reduce((s: number, pb: { priceNet: number }) => s + pb.priceNet, 0);
    for (const pb of b.paxBreakdown) {
      const spContribution = bookingHoTotal > 0 ? (pb.priceNet / bookingHoTotal) * (b.spNetInHo || 0) : 0;
      const key = `${pb.paxType}||${date}`;
      const existing = byDateAndPax.get(key);
      if (existing) {
        existing.count += pb.count;
        existing.spTotal += spContribution;
      } else {
        byDateAndPax.set(key, {
          paxType: pb.paxType,
          date,
          count: pb.count,
          spTotal: spContribution,
          hoUnitPrice: pb.priceNet / (pb.count || 1),
        });
      }
    }
  }

  const entries = Array.from(byDateAndPax.values());
  entries.sort((a, b) => {
    if (a.paxType !== b.paxType) return a.paxType.localeCompare(b.paxType);
    return a.date.localeCompare(b.date);
  });

  const dateToRowKeyMap = new Map<string, string>();
  const grouped: PaxDateRow[] = [];
  let current: PaxDateRow | null = null;
  let currentSpUnit = 0;
  let currentHoUnit = 0;

  for (const e of entries) {
    const spUnit = e.count > 0 ? Math.round((e.spTotal / e.count) * 100) / 100 : 0;
    const hoUnit = Math.round(e.hoUnitPrice * 100) / 100;
    if (current && current.paxType === e.paxType && Math.abs(spUnit - currentSpUnit) < 0.01 && Math.abs(hoUnit - currentHoUnit) < 0.01) {
      current.dates.push(e.date);
      current.count += e.count;
      dateToRowKeyMap.set(`${e.paxType}||${e.date}`, current.rowKey);
    } else {
      const rowKey = `${e.paxType}__${e.date}`;
      current = { paxType: e.paxType, dateRange: "", dates: [e.date], count: e.count, spUnitPrice: spUnit, hoUnitPrice: hoUnit, rowKey };
      currentSpUnit = spUnit;
      currentHoUnit = hoUnit;
      grouped.push(current);
      dateToRowKeyMap.set(`${e.paxType}||${e.date}`, rowKey);
    }
  }

  const formatDateShort = (d: string) => {
    const dt = normalizeDate(d);
    if (!dt) return d;
    return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
  };

  for (const row of grouped) {
    if (row.dates.length === 1) {
      row.dateRange = formatDateShort(row.dates[0]);
    } else {
      const sorted = [...row.dates].sort();
      row.dateRange = `${formatDateShort(sorted[0])} – ${formatDateShort(sorted[sorted.length - 1])}`;
    }
  }

  return { paxDateRows: grouped, dateToRowKeyMap };
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

const CANCELLATION_TAP_RULES: Record<string, { source: "sp" | "zero"; hint: string }> = {
  "Cancelled-Check for Charge loss": { source: "sp", hint: "SP Net — verify charge loss" },
  "Cancelled-SP error": { source: "sp", hint: "SP Net — SP error, pay invoice amount" },
  "Cancelled-Insured Booking": { source: "sp", hint: "SP Net — covered by insurance" },
  "Cancelled-DSS policy": { source: "sp", hint: "SP Net — covered under DSS policy" },
  "Cancelled-OK": { source: "zero", hint: "Zero — cancellation accepted, no payment" },
  "Cancelled-Refund OK": { source: "zero", hint: "Zero — refund processed, no payment" },
};

function getRuleTap(subCategory: string, spNetLc: number, disputeAmt: number): number {
  const rule = CANCELLATION_TAP_RULES[subCategory];
  if (!rule) return Math.max(0, Math.abs(spNetLc) - disputeAmt);
  if (rule.source === "zero") return 0;
  return Math.abs(spNetLc);
}

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

interface TidGroup {
  tid: string;
  bookings: PrimaryRow[];
  spNet: number;
  hoNet: number;
  discLc: number;
  bidCount: number;
  fulfillmentMethods: string[];
  hasPax: boolean;
  cancellable: string;
  cancellationInsurance: string;
  chargeLoss: string;
}

function tidDominant(bkgs: PrimaryRow[], field: "cancellable" | "cancellationInsurance" | "chargedLoss"): string {
  const vals = bkgs.map(b => {
    if (field === "cancellable") return b.cancellable || "";
    if (field === "cancellationInsurance") return b.cancellationInsurance || "";
    if (field === "chargedLoss") return b.chargedLoss || "";
    return "";
  }).filter(Boolean);
  if (vals.length === 0) return "";
  const uniq = new Set(vals);
  if (uniq.size > 1) return "Mixed";
  return vals[0];
}

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

interface CancellationsWorkspaceProps {
  cancellationBookings: PrimaryRow[];
  allRows: PrimaryRow[];
  currency: string;
  beId: string;
  supplierName: string;
  onClose: () => void;
  fxData?: { usdToCcy?: Record<string, number> } | null;
  runId?: string | null;
}

export function CancellationsWorkspace({
  cancellationBookings,
  allRows,
  currency,
  beId,
  supplierName,
  onClose,
  fxData,
  runId,
}: CancellationsWorkspaceProps) {
  const { toast: shadToast } = useToast();
  const TID_GRID_COLUMNS = "1.75rem 1.25rem 2fr minmax(4.5rem,1fr) minmax(4rem,0.6fr) minmax(4rem,0.6fr) minmax(4rem,0.6fr) minmax(6.5rem,1fr) minmax(6.5rem,1fr) minmax(6.5rem,1fr) minmax(6.5rem,1fr) minmax(6.5rem,1fr) minmax(6.5rem,1fr) minmax(6.5rem,1fr) minmax(2.5rem,0.4fr)";
  const BID_GRID_COLUMNS = "2fr 1.2fr minmax(6rem,1fr) minmax(6rem,1fr) minmax(6rem,1fr) minmax(4rem,0.6fr) minmax(4rem,0.6fr) minmax(4rem,0.6fr) minmax(5rem,0.8fr) minmax(4rem,0.7fr) minmax(7rem,1.2fr) minmax(6rem,1fr) minmax(6rem,1fr) minmax(6.5rem,1fr) minmax(2rem,0.3fr)";

  const [activeRowKey, setActiveRowKey] = useState<string | null>(null);
  const [doneRows, setDoneRows] = useState<Set<string>>(new Set());
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [committedDisputes, setCommittedDisputes] = useState<Record<string, number>>({});
  const [tapOverrides, setTapOverrides] = useState<Record<string, string>>({});
  const [tapConfirmedRows, setTapConfirmedRows] = useState<Set<string>>(new Set());

  const [expandedTid, setExpandedTid] = useState<string | null>(null);
  const [selectedTids, setSelectedTids] = useState<Set<string>>(new Set());
  const [resolvedTids, setResolvedTids] = useState<Set<string>>(new Set());
  const [bookingSelections, setBookingSelections] = useState<Record<string, "sp" | "ho" | "custom">>({});
  const [bookingCustomPrices, setBookingCustomPrices] = useState<Record<string, string>>({});
  const [bookingEditMode, setBookingEditMode] = useState<Record<string, boolean>>({});
  const [savedBookings, setSavedBookings] = useState<Set<string>>(new Set());
  const [bidDisputeActive, setBidDisputeActive] = useState<Set<string>>(new Set());
  const [bidDisputeAmounts, setBidDisputeAmounts] = useState<Record<string, number>>({});
  const [bidTapOverrides, setBidTapOverrides] = useState<Record<string, string>>({});
  const [disputedBookings, setDisputedBookings] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<string | null>(null);

  const [paxOpen, setPaxOpen] = useState(false);
  const [paxTid, setPaxTid] = useState<TidGroup | null>(null);
  const [paxPrices, setPaxPrices] = useState<Record<string, string>>({});

  useEffect(() => {
    if (paxOpen && paxTid) {
      const { paxDateRows } = buildPaxDateRows(paxTid.bookings);
      if (paxDateRows.length > 0) {
        const filled: Record<string, string> = {};
        for (const row of paxDateRows) {
          filled[row.rowKey] = String(row.spUnitPrice);
        }
        setPaxPrices(filled);
      }
    }
  }, [paxOpen, paxTid]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  }, []);

  const flash = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 2500); };
  const resolve = (tid: string) => setResolvedTids(prev => new Set(prev).add(tid));

  const priceOverrideMutation = useMutation({
    mutationFn: async ({ bookingIds, selection, customPrices }: { bookingIds: string[]; selection: "ho" | "sp"; customPrices?: Record<string, number> }) => {
      if (!runId) throw new Error("No active run");
      const overrides: Record<string, { totalAmountPayable: number; selection: "ho" | "sp" }> = {};
      bookingIds.forEach(id => {
        if (customPrices && customPrices[id] !== undefined) {
          overrides[id] = { totalAmountPayable: Math.max(0, customPrices[id]), selection };
        } else {
          const row = allRows.find(r => r.bookingId === id);
          const amt = selection === "ho" ? (row?.hoNet || 0) : (row?.spNetInHo || 0);
          overrides[id] = { totalAmountPayable: Math.max(0, amt), selection };
        }
      });
      await apiRequest("POST", "/api/price-overrides", { runId, overrides });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/runs", runId] });
    },
  });

  const disputeMutation = useMutation({
    mutationFn: async ({ bookingIds }: { bookingIds: string[] }) => {
      if (!runId) throw new Error("No active run");
      const disputes = bookingIds.map(bookingId => {
        const row = allRows.find(r => r.bookingId === bookingId);
        return {
          bookingId,
          ticketId: row?.ticketId || "",
          tid: row?.tid || bookingId,
          disputeAmount: Math.abs((row?.spNetInHo || 0) - (row?.hoNet || 0)),
          reconciledNet: row?.spNetInHo || 0,
        };
      });
      await apiRequest("POST", `/api/disputes/${runId}`, { disputes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/disputes", runId] });
    },
  });

  const issueMutation = useMutation({
    mutationFn: async ({ bookingIds, description, priority, driTeam }: { bookingIds: string[]; description: string; priority: string; driTeam: string }) => {
      if (!runId) throw new Error("No active run");
      await apiRequest("POST", "/api/issues", {
        runId,
        billingEntityId: beId || "",
        billingEntityName: supplierName || "",
        currency: currency || "USD",
        discrepancyLocal: 0,
        discrepancyUsd: 0,
        reason: activeRowKey || "",
        driTeam,
        bookingIds,
        errorBucket: activeRowKey || "",
        rca: description || "",
        issueStatus: priority === "high" ? "urgent" : priority === "low" ? "low-priority" : "open",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/issues", runId] });
    },
  });

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

  const tidGroupsByRow = useMemo((): Record<string, TidGroup[]> => {
    const result: Record<string, TidGroup[]> = {};
    for (const row of breakupRows) {
      const byTid: Record<string, PrimaryRow[]> = {};
      for (const b of row.bookings) {
        const tid = b.tid || b.bookingId;
        if (!byTid[tid]) byTid[tid] = [];
        byTid[tid].push(b);
      }
      const groups: TidGroup[] = [];
      for (const [tid, bkgs] of Object.entries(byTid)) {
        const spNet = bkgs.reduce((s, b) => s + (b.spNetInHo || 0), 0);
        const hoNet = bkgs.reduce((s, b) => s + (b.hoNet || 0), 0);
        const fmSet = new Set<string>();
        let hasPax = false;
        bkgs.forEach(b => {
          if (b.fulfillmentMethod) fmSet.add(b.fulfillmentMethod);
          if (b.paxBreakdown && b.paxBreakdown.length > 0) hasPax = true;
        });
        groups.push({
          tid,
          bookings: bkgs,
          spNet: Math.round(spNet * 100) / 100,
          hoNet: Math.round(hoNet * 100) / 100,
          discLc: Math.round((hoNet - spNet) * 100) / 100,
          bidCount: bkgs.length,
          fulfillmentMethods: Array.from(fmSet),
          hasPax,
          cancellable: tidDominant(bkgs, "cancellable"),
          cancellationInsurance: tidDominant(bkgs, "cancellationInsurance"),
          chargeLoss: tidDominant(bkgs, "chargedLoss"),
        });
      }
      groups.sort((a, b) => Math.abs(b.discLc) - Math.abs(a.discLc));
      result[row.rowKey] = groups;
    }
    return result;
  }, [breakupRows]);

  const totalDiscLc = breakupRows.reduce((s, r) => s + r.discLc, 0);
  const totalDiscUsd = breakupRows.reduce((s, r) => s + r.discUsd, 0);
  const totalBidCount = breakupRows.reduce((s, r) => s + r.bidCount, 0);

  const activeRow = activeRowKey ? breakupRows.find(r => r.rowKey === activeRowKey) ?? null : null;
  const activeTids = activeRowKey ? (tidGroupsByRow[activeRowKey] ?? []) : [];
  const totalDisc = activeTids.reduce((s, t) => s + Math.abs(t.discLc), 0);

  const toggleSelect = (tid: string) => {
    setSelectedTids(prev => { const next = new Set(prev); if (next.has(tid)) next.delete(tid); else next.add(tid); return next; });
  };

  const toggleSelectAll = () => {
    const unresolved = activeTids.filter(t => !resolvedTids.has(t.tid));
    if (selectedTids.size === unresolved.length) setSelectedTids(new Set());
    else setSelectedTids(new Set(unresolved.map(t => t.tid)));
  };

  const getBookingFinalPrice = useCallback((b: PrimaryRow): number => {
    const sel = bookingSelections[b.bookingId];
    if (sel === "custom") {
      const v = parseFloat(bookingCustomPrices[b.bookingId] || "0");
      return isNaN(v) ? (b.spNetInHo || 0) : v;
    }
    if (sel === "ho") return b.hoNet || 0;
    return b.spNetInHo || 0;
  }, [bookingSelections, bookingCustomPrices]);

  const getBidSelection = useCallback((bookingId: string): "ho" | "sp" | "custom" => {
    const sel = bookingSelections[bookingId];
    if (sel === "ho") return "ho";
    if (sel === "custom") return "custom";
    return "sp";
  }, [bookingSelections]);

  const updateBidSelection = useCallback((bookingId: string, value: "ho" | "sp") => {
    setBookingSelections(prev => ({ ...prev, [bookingId]: value }));
    setBookingCustomPrices(prev => { const n = { ...prev }; delete n[bookingId]; return n; });
    setBookingEditMode(prev => { const n = { ...prev }; delete n[bookingId]; return n; });
    setSavedBookings(prev => { const n = new Set(prev); n.delete(bookingId); return n; });
    if (value === "ho") {
      setBidDisputeActive(prev => { const n = new Set(prev); n.delete(bookingId); return n; });
      setBidDisputeAmounts(prev => { const n = { ...prev }; delete n[bookingId]; return n; });
    }
  }, []);

  const getBidFinalNet = useCallback((b: PrimaryRow): number => {
    const rawSel = bookingSelections[b.bookingId];
    if (rawSel === "custom") {
      const v = parseFloat(bookingCustomPrices[b.bookingId] || "0");
      return isNaN(v) ? (b.spNetInHo || 0) : v;
    }
    const sel = getBidSelection(b.bookingId);
    return sel === "ho" ? (b.hoNet || 0) : (b.spNetInHo || 0);
  }, [getBidSelection, bookingSelections, bookingCustomPrices]);

  const getBidMaxDispute = useCallback((b: PrimaryRow): number => {
    return Math.round(Math.abs((b.hoNet || 0) - (b.spNetInHo || 0)) * 100) / 100;
  }, []);

  const getBidDisputeAmount = useCallback((bookingId: string): number => {
    return bidDisputeAmounts[bookingId] || 0;
  }, [bidDisputeAmounts]);

  const getEffectiveTap = useCallback((b: PrimaryRow): number => {
    const base = getBidFinalNet(b);
    const override = bidTapOverrides[b.bookingId];
    if (override === undefined || override === "") return base;
    const val = parseFloat(override);
    if (isNaN(val)) return base;
    const minTap = Math.round(base * 0.9 * 100) / 100;
    const maxTap = Math.round(base * 1.1 * 100) / 100;
    return Math.round(Math.min(Math.max(val, minTap), maxTap) * 100) / 100;
  }, [getBidFinalNet, bidTapOverrides]);

  const setBidDisputeAmountForBooking = useCallback((bookingId: string, amount: number, booking?: PrimaryRow) => {
    const rounded = Math.round(amount * 100) / 100;
    if (rounded <= 0) {
      setBidDisputeActive(prev => { const n = new Set(prev); n.delete(bookingId); return n; });
      setBidDisputeAmounts(prev => { const n = { ...prev }; delete n[bookingId]; return n; });
    } else {
      let clamped = rounded;
      if (booking) {
        const maxD = Math.round(Math.abs((booking.hoNet || 0) - (booking.spNetInHo || 0)) * 100) / 100;
        if (clamped > maxD) clamped = maxD;
      }
      setBidDisputeAmounts(prev => ({ ...prev, [bookingId]: clamped }));
    }
  }, []);

  const activateBidDispute = useCallback((bookingId: string, b: PrimaryRow) => {
    setBidDisputeActive(prev => { const n = new Set(prev); n.add(bookingId); return n; });
    const maxD = Math.round(Math.abs((b.hoNet || 0) - (b.spNetInHo || 0)) * 100) / 100;
    setBidDisputeAmounts(prev => ({ ...prev, [bookingId]: maxD }));
    setBookingSelections(prev => ({ ...prev, [bookingId]: "sp" }));
    setSavedBookings(prev => { const n = new Set(prev); n.delete(bookingId); return n; });
  }, []);

  const handleTidBulkDispute = useCallback((tid: TidGroup, action: "all" | "clear") => {
    tid.bookings.forEach(b => {
      const sel = getBidSelection(b.bookingId);
      if (action === "all" && (sel === "sp" || sel === "custom")) {
        setBidDisputeActive(prev => { const n = new Set(prev); n.add(b.bookingId); return n; });
        const maxD = Math.round(Math.abs((b.hoNet || 0) - (b.spNetInHo || 0)) * 100) / 100;
        setBidDisputeAmounts(prev => ({ ...prev, [b.bookingId]: maxD }));
      } else if (action === "clear") {
        setBidDisputeActive(prev => { const n = new Set(prev); n.delete(b.bookingId); return n; });
        setBidDisputeAmounts(prev => { const n = { ...prev }; delete n[b.bookingId]; return n; });
      }
    });
  }, [getBidSelection]);

  const handleBookingSave = useCallback((b: PrimaryRow) => {
    const sel = bookingSelections[b.bookingId] || "sp";
    const finalSel = sel === "custom" ? "sp" : sel;
    const customPrices: Record<string, number> = {};
    if (sel === "custom") {
      customPrices[b.bookingId] = getBookingFinalPrice(b);
    }
    priceOverrideMutation.mutate({ bookingIds: [b.bookingId], selection: finalSel, customPrices: Object.keys(customPrices).length > 0 ? customPrices : undefined }, {
      onSuccess: () => {
        setSavedBookings(prev => { const next = new Set(prev); next.add(b.bookingId); return next; });
        flash(`${b.bookingId} → price saved`);
      },
      onError: (err) => {
        shadToast({ title: "Failed", description: String(err), variant: "destructive" });
      },
    });
  }, [bookingSelections, getBookingFinalPrice, priceOverrideMutation, shadToast]);

  const handleTidSaveAll = useCallback((tid: TidGroup) => {
    const customPrices: Record<string, number> = {};
    const bookingIds = tid.bookings.map(b => b.bookingId);
    tid.bookings.forEach(b => {
      customPrices[b.bookingId] = getBookingFinalPrice(b);
    });
    priceOverrideMutation.mutate({ bookingIds, selection: "sp", customPrices }, {
      onSuccess: () => {
        setSavedBookings(prev => { const next = new Set(prev); bookingIds.forEach(id => next.add(id)); return next; });
        resolve(tid.tid);
        flash(`${tid.tid} → all booking prices saved`);
      },
      onError: (err) => {
        shadToast({ title: "Failed", description: String(err), variant: "destructive" });
      },
    });
  }, [getBookingFinalPrice, priceOverrideMutation, shadToast]);

  const handleTidAction = useCallback((tid: TidGroup, action: "sp" | "ho") => {
    const bookingIds = tid.bookings.map(b => b.bookingId);
    setBookingSelections(prev => {
      const next = { ...prev };
      bookingIds.forEach(id => { next[id] = action; });
      return next;
    });
    setBookingCustomPrices(prev => {
      const next = { ...prev };
      bookingIds.forEach(id => { delete next[id]; });
      return next;
    });
    setBookingEditMode(prev => {
      const next = { ...prev };
      bookingIds.forEach(id => { delete next[id]; });
      return next;
    });
    if (action === "ho") {
      setBidDisputeActive(prev => { const n = new Set(prev); bookingIds.forEach(id => n.delete(id)); return n; });
      setBidDisputeAmounts(prev => { const n = { ...prev }; bookingIds.forEach(id => { delete n[id]; }); return n; });
    }
    priceOverrideMutation.mutate({ bookingIds, selection: action }, {
      onSuccess: () => {
        setSavedBookings(prev => { const next = new Set(prev); bookingIds.forEach(id => next.add(id)); return next; });
        resolve(tid.tid);
        setExpandedTid(null);
        flash(`${tid.tid} → ${action === "sp" ? "SP" : "HO"} Net applied`);
      },
      onError: (err) => {
        shadToast({ title: "Failed", description: String(err), variant: "destructive" });
      },
    });
  }, [priceOverrideMutation, shadToast]);

  const handleTidDispute = useCallback((tid: TidGroup) => {
    const bookingIds = tid.bookings.map(b => b.bookingId);
    disputeMutation.mutate({ bookingIds }, {
      onSuccess: () => {
        setDisputedBookings(prev => { const next = new Set(prev); bookingIds.forEach(id => next.add(id)); return next; });
        flash(`Dispute raised for ${tid.tid} (${bookingIds.length} bookings)`);
      },
      onError: (err) => {
        shadToast({ title: "Dispute failed", description: String(err), variant: "destructive" });
      },
    });
  }, [disputeMutation, shadToast]);

  const handleTidIssue = useCallback((tid: TidGroup) => {
    const bookingIds = tid.bookings.map(b => b.bookingId);
    const driTeam = getCancellationDriTeam(activeRow?.subCategory || "", tid.fulfillmentMethods[0] || "");
    issueMutation.mutate({ bookingIds, description: "", priority: "medium", driTeam }, {
      onSuccess: () => {
        flash(`Issue logged for ${tid.tid}`);
        shadToast({ title: "Issue created", description: `Issue logged for ${tid.tid}` });
      },
      onError: (err) => {
        shadToast({ title: "Issue creation failed", description: String(err), variant: "destructive" });
      },
    });
  }, [issueMutation, shadToast, activeRow]);

  const openTakeAction = useCallback((rowKey: string) => {
    setActiveRowKey(rowKey);
    setExpandedTid(null);
    setSelectedTids(new Set());
    setBookingSelections({});
    setBookingCustomPrices({});
    setBookingEditMode({});
    setSavedBookings(new Set());
    setBidDisputeActive(new Set());
    setBidDisputeAmounts({});
    setBidTapOverrides({});
    setResolvedTids(new Set());
    setDisputedBookings(new Set());
  }, []);

  const confirmAction = useCallback(() => {
    if (!activeRowKey || !activeRow) return;
    const savedCount = savedBookings.size;
    const disputeCount = disputedBookings.size;
    showToast(`Applied — ${activeRow.bidCount} bookings · ${savedCount} saved · ${disputeCount} disputed`);
    setDoneRows(prev => new Set(prev).add(activeRowKey));
    setActiveRowKey(null);
  }, [activeRowKey, activeRow, savedBookings, disputedBookings, showToast]);

  const liveDispute = useCallback((rowKey: string): number => {
    return committedDisputes[rowKey] ?? 0;
  }, [committedDisputes]);

  const handlePaxSave = useCallback(() => {
    if (!paxTid) return;
    const { paxDateRows, dateToRowKeyMap } = buildPaxDateRows(paxTid.bookings);
    const paymentBasisVal = paxTid.bookings.find(b => b.paymentBasis)?.paymentBasis || "";
    const dateField: "experienceDate" | "bookingCreationDate" =
      paymentBasisVal.toUpperCase().includes("EXPERIENCE") ? "experienceDate" : "bookingCreationDate";

    const customPrices: Record<string, number> = {};
    for (const b of paxTid.bookings) {
      if (!b.paxBreakdown || b.paxBreakdown.length === 0) {
        customPrices[b.bookingId] = b.spNetInHo || 0;
        continue;
      }
      const raw = dateField === "experienceDate" ? (b.experienceDate || "") : (b.bookingCreationDate || "");
      const dateKey = raw ? (normalizeDate(raw)?.toISOString() || "Unknown") : "Unknown";
      let bookingTotal = 0;
      for (const pb of b.paxBreakdown) {
        const rowKey = dateToRowKeyMap.get(`${pb.paxType}||${dateKey}`);
        if (rowKey) {
          const priceStr = paxPrices[rowKey];
          const finalPrice = priceStr !== undefined && priceStr !== "" ? parseFloat(priceStr) || 0 : (paxDateRows.find(r => r.rowKey === rowKey)?.spUnitPrice || 0);
          bookingTotal += finalPrice * pb.count;
        } else {
          bookingTotal += pb.priceNet;
        }
      }
      customPrices[b.bookingId] = Math.round(bookingTotal * 100) / 100;
    }

    const bookingIds = paxTid.bookings.map(b => b.bookingId);
    bookingIds.forEach(id => {
      setBookingSelections(prev => ({ ...prev, [id]: "custom" }));
      setBookingCustomPrices(prev => ({ ...prev, [id]: String(customPrices[id] || 0) }));
    });

    priceOverrideMutation.mutate({ bookingIds, selection: "sp", customPrices }, {
      onSuccess: () => {
        setSavedBookings(prev => { const next = new Set(prev); bookingIds.forEach(id => next.add(id)); return next; });
        resolve(paxTid.tid);
        flash(`${paxTid.tid} → pax pricing applied`);
        setPaxOpen(false);
        setPaxTid(null);
      },
      onError: (err) => {
        shadToast({ title: "Failed", description: String(err), variant: "destructive" });
      },
    });
  }, [paxTid, paxPrices, priceOverrideMutation, shadToast]);

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
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose} data-testid="close-workspace" aria-label="Close workspace">
              <XIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="flex flex-col flex-1 overflow-hidden">

          <div
            className="border-b overflow-auto shrink-0 motion-safe:transition-[max-height] motion-safe:duration-300"
            style={{ maxHeight: activeRowKey ? "40%" : "55%" }}
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
                        const isActive = activeRowKey === row.rowKey;
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

          <div className="flex-1 flex flex-col overflow-hidden">

            {activeRowKey && activeRow && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="px-5 py-2.5 border-b bg-card shrink-0 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 min-w-0">
                    {subCategoryBadge(activeRow.subCategory)}
                    {activeRow.actionPoint !== "No action needed" && (
                      <div className="hidden sm:flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded px-2 py-1 max-w-[320px]">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        <span className="truncate">{activeRow.actionPoint}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-muted-foreground">{activeTids.length} TIDs · {activeRow.bidCount} bookings</span>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setActiveRowKey(null)} data-testid="close-take-action" aria-label="Close take action panel">
                      <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                <div className="flex-1 overflow-auto">
                  <div className="px-5 py-4">
                    <div className="rounded-md border overflow-hidden">
                      <div className="grid items-center h-8 bg-muted/30 px-3 text-xs font-medium text-muted-foreground border-b gap-x-4" style={{ gridTemplateColumns: TID_GRID_COLUMNS }}>
                        <div
                          className="flex items-center justify-center cursor-pointer"
                          role="checkbox"
                          aria-checked={selectedTids.size > 0 && selectedTids.size === activeTids.filter(t => !resolvedTids.has(t.tid)).length}
                          aria-label="Select all TIDs"
                          tabIndex={0}
                          onClick={e => { e.stopPropagation(); toggleSelectAll(); }}
                          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSelectAll(); } }}
                        >
                          <Checkbox checked={selectedTids.size > 0 && selectedTids.size === activeTids.filter(t => !resolvedTids.has(t.tid)).length} className="h-3.5 w-3.5" tabIndex={-1} />
                        </div>
                        <div />
                        <div>TID</div>
                        <div className="text-center">Fulfillment</div>
                        <div className="text-center">Cancellable</div>
                        <div className="text-center">Canc. Insurance</div>
                        <div className="text-center">Charge Loss</div>
                        <div className="text-center">SP Net</div>
                        <div className="text-center">HO Net</div>
                        <div className="text-center">Difference LC</div>
                        <div className="text-center text-violet-600">Total Amount Payable</div>
                        <div className="text-center">Amount Paid</div>
                        <div className="text-center text-violet-600">Dispute</div>
                        <div className="text-center text-green-600">Balance Amt Payable</div>
                        <div className="text-center">BIDs</div>
                      </div>

                      {activeTids.map(tid => {
                        const isExpanded = expandedTid === tid.tid;
                        const isResolved = resolvedTids.has(tid.tid);
                        const isSelected = selectedTids.has(tid.tid);
                        const pct = totalDisc > 0 ? ((Math.abs(tid.discLc) / totalDisc) * 100).toFixed(0) : "0";

                        return (
                          <div key={tid.tid} className={`motion-safe:transition-[background-color] motion-safe:duration-500 ${isResolved ? "bg-green-50/40 dark:bg-green-950/10" : ""} ${isSelected && !isResolved ? "bg-primary/5" : ""}`} data-testid={`action-tid-${tid.tid}`}>
                            <div
                              role="button"
                              tabIndex={0}
                              aria-expanded={isExpanded}
                              className={`grid items-center px-3 min-h-[2.75rem] cursor-pointer transition-colors hover:bg-muted/30 border-b gap-x-4 ${isExpanded ? "bg-muted/20" : ""}`}
                              style={{ gridTemplateColumns: TID_GRID_COLUMNS }}
                              onClick={() => setExpandedTid(isExpanded ? null : tid.tid)}
                              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedTid(isExpanded ? null : tid.tid); } }}
                            >
                              <div
                                className="flex items-center justify-center cursor-pointer"
                                role="checkbox"
                                aria-checked={isSelected}
                                aria-label={`Select TID ${tid.tid}`}
                                tabIndex={isResolved ? -1 : 0}
                                onClick={e => { e.stopPropagation(); if (!isResolved) toggleSelect(tid.tid); }}
                                onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && !isResolved) { e.preventDefault(); e.stopPropagation(); toggleSelect(tid.tid); } }}
                              >
                                {!isResolved && <Checkbox checked={isSelected} className="h-3.5 w-3.5" tabIndex={-1} />}
                              </div>
                              <div className="flex items-center">
                                {isResolved ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-sm font-medium text-primary">{tid.tid}</span>
                                  {tid.hasPax && <Badge variant="outline" className="text-[10px] px-1 py-0 text-violet-600 border-violet-200">Pax</Badge>}
                                </div>
                                {tid.bookings[0]?.experienceName && (
                                  <div className="text-[10px] text-muted-foreground break-words">{tid.bookings[0]?.experienceName}</div>
                                )}
                              </div>
                              <div className="text-center">
                                {tid.fulfillmentMethods.length > 0 && (
                                  <span className="text-[10px] text-muted-foreground">{tid.fulfillmentMethods.length > 1 ? "Mixed" : tid.fulfillmentMethods[0]}</span>
                                )}
                              </div>
                              <div className="text-center">
                                {tid.cancellable && <Badge variant={tid.cancellable === "Yes" ? "outline" : "secondary"} className="text-[9px] px-1 py-0">{tid.cancellable}</Badge>}
                              </div>
                              <div className="text-center">
                                {tid.cancellationInsurance && <Badge variant="secondary" className={`text-[9px] px-1 py-0 ${tid.cancellationInsurance === "Yes" ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300" : ""}`}>{tid.cancellationInsurance}</Badge>}
                              </div>
                              <div className="text-center">
                                {tid.chargeLoss && <Badge variant="secondary" className={`text-[9px] px-1 py-0 ${tid.chargeLoss === "FALSE" ? "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300" : tid.chargeLoss === "Mixed" ? "" : "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300"}`}>{tid.chargeLoss}</Badge>}
                              </div>
                              <div className="text-center font-mono text-sm">{fmt(tid.spNet)}</div>
                              <div className="text-center font-mono text-sm">{fmt(tid.hoNet)}</div>
                              <div className="text-center">
                                <span className="font-mono text-sm text-red-600 dark:text-red-400 whitespace-nowrap">{fmt(tid.discLc)}</span>
                                <span className="text-[10px] text-muted-foreground ml-1">({pct}%)</span>
                              </div>
                              <div className="text-center font-mono text-sm text-violet-600 font-medium">{fmt(tid.bookings.reduce((s, b) => s + getEffectiveTap(b), 0))}</div>
                              <div className="text-center font-mono text-sm">{fmt(tid.bookings.reduce((s, b) => s + (b.amountPaid || 0), 0))}</div>
                              <div className="text-center font-mono text-sm text-violet-600 font-medium">{fmt((() => {
                                const bidSum = tid.bookings.reduce((s, b) => s + (bidDisputeActive.has(b.bookingId) ? Math.abs((b.spNetInHo || b.spNet || 0) - (b.hoNet || 0)) : 0), 0);
                                return bidSum;
                              })())}</div>
                              <div className="text-center font-mono text-sm text-green-600 font-medium">{fmt((() => {
                                const tidTap = tid.bookings.reduce((s, b) => s + getEffectiveTap(b), 0);
                                const tidAmtPaid = tid.bookings.reduce((s, b) => s + (b.amountPaid || 0), 0);
                                return tidTap - tidAmtPaid;
                              })())}</div>
                              <div className="text-center text-sm">{tid.bidCount}</div>
                            </div>

                            {isExpanded && (
                              <div className="border-b bg-muted/10 dark:bg-muted/5 px-4 py-3 space-y-3">
                                <div className="flex items-center gap-2 p-2 rounded-md bg-primary/5 border border-primary/10 flex-wrap">
                                  <Button size="sm" className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => handleTidAction(tid, "sp")} disabled={priceOverrideMutation.isPending} data-testid={`tid-sp-net-${tid.tid}`}>
                                    {priceOverrideMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />} Set SP Net
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-green-700 border-green-300 hover:bg-green-50" onClick={() => handleTidAction(tid, "ho")} disabled={priceOverrideMutation.isPending} data-testid={`tid-ho-net-${tid.tid}`}>
                                    <TrendingDown className="h-3.5 w-3.5" /> Set HO Net
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-violet-700 border-violet-300 hover:bg-violet-50" onClick={() => {
                                    setPaxTid(tid);
                                    setPaxOpen(true);
                                  }} data-testid={`tid-pax-${tid.tid}`}>
                                    <Calculator className="h-3.5 w-3.5" /> Pax Pricing
                                  </Button>
                                  <div className="flex-1" />
                                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => handleTidDispute(tid)} disabled={disputeMutation.isPending} data-testid={`tid-dispute-${tid.tid}`}>
                                    <Gavel className="h-3.5 w-3.5" /> Dispute
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-orange-700 border-orange-300 hover:bg-orange-50" onClick={() => handleTidIssue(tid)} data-testid={`tid-issue-${tid.tid}`}>
                                    <FileWarning className="h-3.5 w-3.5" /> Issue
                                  </Button>
                                </div>

                                <div className="rounded-md border overflow-hidden bg-background text-[11px]">
                                  <div className="grid items-center h-7 bg-muted/30 border-b gap-x-4 px-3" style={{ gridTemplateColumns: BID_GRID_COLUMNS }}>
                                    <div className="text-left font-medium text-muted-foreground whitespace-nowrap">Booking ID</div>
                                    <div className="text-center font-medium text-muted-foreground whitespace-nowrap">Ticket ID</div>
                                    <div className="text-center font-medium text-blue-600 whitespace-nowrap">SP Net</div>
                                    <div className="text-center font-medium text-muted-foreground whitespace-nowrap">HO Net</div>
                                    <div className="text-center font-medium text-red-600 whitespace-nowrap">Diff LC</div>
                                    <div className="text-center font-medium text-muted-foreground whitespace-nowrap">Cancellable</div>
                                    <div className="text-center font-medium text-muted-foreground whitespace-nowrap">Canc. Insurance</div>
                                    <div className="text-center font-medium text-muted-foreground whitespace-nowrap">Charge Loss</div>
                                    <div className="text-center font-medium text-muted-foreground whitespace-nowrap">Selection</div>
                                    <div className="text-center font-medium text-muted-foreground whitespace-nowrap">Dispute</div>
                                    <div className="text-center font-medium text-violet-600 whitespace-nowrap">Total Amount Payable</div>
                                    <div className="text-center font-medium text-muted-foreground whitespace-nowrap">Amount Paid</div>
                                    <div className="text-center font-medium text-orange-600 whitespace-nowrap">Dispute Amt</div>
                                    <div className="text-center font-medium text-green-600 whitespace-nowrap">Balance Amt Payable</div>
                                    <div className="text-center font-medium text-muted-foreground whitespace-nowrap"></div>
                                  </div>
                                  {tid.bookings.map(b => {
                                    const selection = getBidSelection(b.bookingId);
                                    const canDispute = selection === "sp" || selection === "custom";
                                    const finalNet = getBidFinalNet(b);
                                    const effectiveTap = getEffectiveTap(b);
                                    const tapBase = finalNet;
                                    const tapMin = Math.round(tapBase * 0.9 * 100) / 100;
                                    const tapMax = Math.round(tapBase * 1.1 * 100) / 100;
                                    const hasTapOverride = bidTapOverrides[b.bookingId] !== undefined && bidTapOverrides[b.bookingId] !== "";
                                    const maxDispute = getBidMaxDispute(b);
                                    const currentDispute = canDispute ? getBidDisputeAmount(b.bookingId) : 0;
                                    const exceedsMax = currentDispute > maxDispute;
                                    const bookingAmountPaid = b.amountPaid || 0;
                                    const balanceAmountPayable = effectiveTap - bookingAmountPaid;
                                    const isSaved = savedBookings.has(b.bookingId);
                                    const hasOverride = !!bookingSelections[b.bookingId];
                                    const hasDisp = disputedBookings.has(b.bookingId);
                                    return (
                                      <div key={b.bookingId} className={`grid items-center min-h-[2.25rem] border-b last:border-0 hover:bg-muted/20 gap-x-4 px-3 ${hasDisp ? "bg-amber-50/50 dark:bg-amber-950/10" : ""} ${bidDisputeActive.has(b.bookingId) ? "bg-orange-50/30 dark:bg-orange-950/10" : ""}`} style={{ gridTemplateColumns: BID_GRID_COLUMNS }} data-testid={`booking-row-${b.bookingId}`}>
                                        <div className="text-left py-1 min-w-0">
                                          <div className="flex items-center gap-1">
                                            <span className="font-mono text-primary font-medium">{b.bookingId}</span>
                                            {hasDisp && <Badge className="text-[9px] px-1 py-0 bg-amber-100 text-amber-700 border-amber-200">Disputed</Badge>}
                                            {isSaved && <CheckCircle2 className="h-3 w-3 text-green-600 flex-shrink-0" />}
                                          </div>
                                        </div>
                                        <div className="text-center py-1 text-muted-foreground truncate" title={b.ticketId || ""} data-testid={`cell-ticketid-${b.bookingId}`}>
                                          {b.ticketId || "—"}
                                        </div>
                                        <div className="text-center py-1 font-mono text-blue-600" data-testid={`booking-sp-${b.bookingId}`}>
                                          {fmt(b.spNetInHo || 0)}
                                        </div>
                                        <div className="text-center py-1 font-mono text-green-600" data-testid={`booking-ho-${b.bookingId}`}>
                                          {fmt(b.hoNet || 0)}
                                        </div>
                                        <div className="text-center py-1 font-mono text-red-600 dark:text-red-400" data-testid={`booking-diff-${b.bookingId}`}>
                                          {fmt(Math.round(((b.hoNet || 0) - (b.spNetInHo || 0)) * 100) / 100)}
                                        </div>
                                        <div className="text-center py-1">
                                          {b.cancellable && <Badge variant={b.cancellable === "Yes" ? "outline" : "secondary"} className="text-[9px] px-1 py-0">{b.cancellable}</Badge>}
                                        </div>
                                        <div className="text-center py-1">
                                          {b.cancellationInsurance && <Badge variant="secondary" className={`text-[9px] px-1 py-0 ${b.cancellationInsurance === "Yes" ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300" : ""}`}>{b.cancellationInsurance}</Badge>}
                                        </div>
                                        <div className="text-center py-1">
                                          {b.chargedLoss && <Badge variant="secondary" className={`text-[9px] px-1 py-0 ${b.chargedLoss === "FALSE" ? "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300" : "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300"}`}>{b.chargedLoss}</Badge>}
                                        </div>
                                        <div className="text-center py-1">
                                          {selection === "custom" ? (
                                            <div className="flex items-center justify-center gap-1">
                                              <Badge variant="outline" className="text-[9px] px-1 py-0 text-violet-600 border-violet-200">Custom</Badge>
                                              <Button size="sm" variant="ghost" className="h-4 px-0.5 text-[9px] text-muted-foreground" onClick={() => updateBidSelection(b.bookingId, "sp")} data-testid={`clear-custom-${b.bookingId}`}>
                                                <XIcon className="h-2.5 w-2.5" />
                                              </Button>
                                            </div>
                                          ) : (
                                            <Select value={selection} onValueChange={(v) => updateBidSelection(b.bookingId, v as "ho" | "sp")}>
                                              <SelectTrigger className="w-[4.5rem] h-5 text-xs mx-auto" data-testid={`select-booking-${b.bookingId}`}>
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="ho">HO</SelectItem>
                                                <SelectItem value="sp">SP</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          )}
                                        </div>
                                        <div className="text-center py-1">
                                          {canDispute ? (
                                            bidDisputeActive.has(b.bookingId) ? (
                                              <Button size="sm" variant="ghost" className="h-4 px-1 text-[9px] text-muted-foreground hover:text-foreground" onClick={() => setBidDisputeAmountForBooking(b.bookingId, 0)} data-testid={`button-clear-dispute-${b.bookingId}`}>
                                                Clear
                                              </Button>
                                            ) : (
                                              <Button size="sm" variant="outline" className="h-5 px-1.5 text-[9px]" onClick={() => activateBidDispute(b.bookingId, b)} data-testid={`button-dispute-${b.bookingId}`}>
                                                Dispute
                                              </Button>
                                            )
                                          ) : null}
                                        </div>
                                        <div className="text-center py-1 font-mono font-medium" data-testid={`booking-final-${b.bookingId}`}>
                                          <div className="relative flex justify-center items-center gap-1">
                                            {hasTapOverride ? (
                                              <>
                                                <input
                                                  type="number"
                                                  step="0.01"
                                                  value={bidTapOverrides[b.bookingId] ?? ""}
                                                  onChange={e => setBidTapOverrides(prev => ({ ...prev, [b.bookingId]: e.target.value }))}
                                                  className="w-28 h-5 text-xs text-center font-mono px-1.5 bg-transparent border-0 border-b border-violet-400 text-violet-700 dark:text-violet-300 font-medium focus-visible:outline-none focus-visible:border-violet-500"
                                                  data-testid={`input-tap-${b.bookingId}`}
                                                />
                                                <button className="p-0 text-muted-foreground/50 hover:text-foreground transition-colors flex-shrink-0" onClick={() => setBidTapOverrides(prev => { const n = { ...prev }; delete n[b.bookingId]; return n; })} data-testid={`clear-tap-${b.bookingId}`} aria-label={`Clear TAP override for booking ${b.bookingId}`}>
                                                  <XIcon className="h-2.5 w-2.5" aria-hidden="true" />
                                                </button>
                                              </>
                                            ) : (
                                              <input
                                                type="number"
                                                step="0.01"
                                                value={finalNet.toFixed(2)}
                                                readOnly
                                                className="w-28 h-5 text-xs text-center font-mono bg-transparent border-0 cursor-default"
                                                onClick={() => setBidTapOverrides(prev => ({ ...prev, [b.bookingId]: String(finalNet) }))}
                                                data-testid={`input-tap-${b.bookingId}`}
                                              />
                                            )}
                                          </div>
                                        </div>
                                        <div className="text-center py-1 font-mono text-muted-foreground" data-testid={`booking-amtpaid-${b.bookingId}`}>
                                          {bookingAmountPaid > 0 ? fmt(bookingAmountPaid) : "—"}
                                        </div>
                                        <div className="text-center py-1">
                                          {bidDisputeActive.has(b.bookingId) ? (
                                            <div className="relative group flex justify-center">
                                              <Input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={currentDispute || ""}
                                                onChange={(e) => setBidDisputeAmountForBooking(b.bookingId, parseFloat(e.target.value) || 0, b)}
                                                className={`w-20 h-5 text-xs text-center font-mono px-1 ${exceedsMax ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/30' : ''}`}
                                                placeholder="0"
                                                data-testid={`input-dispute-booking-${b.bookingId}`}
                                              />
                                              {exceedsMax && (
                                                <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover:block">
                                                  <div className="bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 text-[10px] px-2 py-1 rounded shadow-lg whitespace-nowrap border border-orange-300 dark:border-orange-700">
                                                    Max: {fmt(maxDispute)}
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          ) : null}
                                        </div>
                                        <div className="text-center py-1 font-mono font-medium text-green-600 dark:text-green-400" data-testid={`booking-balance-${b.bookingId}`}>
                                          {fmt(balanceAmountPayable)}
                                        </div>
                                        <div className="text-center py-1">
                                          {hasOverride && !isSaved && (
                                            <button className="p-1 rounded-md bg-violet-100 hover:bg-violet-200 text-violet-700 transition-colors" onClick={() => handleBookingSave(b)} disabled={priceOverrideMutation.isPending} data-testid={`booking-save-${b.bookingId}`}>
                                              {priceOverrideMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                  <div className="grid items-center h-8 bg-muted/40 border-t font-semibold gap-x-4 px-3" style={{ gridTemplateColumns: BID_GRID_COLUMNS }}>
                                    <div className="py-1 text-muted-foreground" style={{ gridColumn: "span 2" }}>Total ({tid.bookings.length})</div>
                                    <div className="text-center py-1 font-mono text-blue-600">{fmt(tid.spNet)}</div>
                                    <div className="text-center py-1 font-mono text-green-600">{fmt(tid.hoNet)}</div>
                                    <div className="text-center py-1 font-mono text-red-600 dark:text-red-400 font-bold">{fmt(Math.round((tid.hoNet - tid.spNet) * 100) / 100)}</div>
                                    <div className="text-center py-1" style={{ gridColumn: "span 5" }}>
                                      {(() => {
                                        const disputed = tid.bookings.filter(b => bidDisputeActive.has(b.bookingId)).length;
                                        const disputable = tid.bookings.filter(b => { const s = getBidSelection(b.bookingId); return s === "sp" || s === "custom"; }).length;
                                        if (disputable === 0) return null;
                                        if (disputed > 0) {
                                          return (
                                            <Button size="sm" variant="ghost" className="h-4 px-1 text-[9px] text-muted-foreground hover:text-foreground" onClick={() => handleTidBulkDispute(tid, "clear")} data-testid={`tid-clear-dispute-${tid.tid}`}>
                                              Clear All
                                            </Button>
                                          );
                                        }
                                        return (
                                          <Button size="sm" variant="outline" className="h-5 px-1 text-[9px]" onClick={() => handleTidBulkDispute(tid, "all")} data-testid={`tid-dispute-all-${tid.tid}`}>
                                            Dispute All
                                          </Button>
                                        );
                                      })()}
                                    </div>
                                    <div className="text-center py-1 font-mono text-violet-700 font-bold">{fmt(tid.bookings.reduce((s, b) => s + getEffectiveTap(b), 0))}</div>
                                    <div className="text-center py-1 font-mono text-muted-foreground">{fmt(tid.bookings.reduce((s, b) => s + (b.amountPaid || 0), 0))}</div>
                                    <div className="text-center py-1 font-mono text-orange-600">
                                      {(() => {
                                        const totalDisp = tid.bookings.reduce((s, b) => { const sel = getBidSelection(b.bookingId); return s + (sel === "sp" || sel === "custom" ? getBidDisputeAmount(b.bookingId) : 0); }, 0);
                                        return totalDisp > 0 ? fmt(totalDisp) : null;
                                      })()}
                                    </div>
                                    <div className="text-center py-1 font-mono text-green-600 dark:text-green-400 font-bold">
                                      {fmt(tid.bookings.reduce((s, b) => {
                                        const tap = getEffectiveTap(b);
                                        const ap = b.amountPaid || 0;
                                        return s + tap - ap;
                                      }, 0))}
                                    </div>
                                    <div className="text-center py-1">
                                      {tid.bookings.some(b => bookingSelections[b.bookingId] && !savedBookings.has(b.bookingId)) && (
                                        <button className="p-1 rounded-md bg-violet-600 hover:bg-violet-700 text-white transition-colors" onClick={() => handleTidSaveAll(tid)} disabled={priceOverrideMutation.isPending} data-testid={`tid-save-all-${tid.tid}`}>
                                          {priceOverrideMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="border-t bg-card px-5 py-3 shrink-0 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">TIDs:</span>
                      <span className="font-mono font-semibold">{activeTids.length}</span>
                    </div>
                    <div className="h-3 w-px bg-border" />
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Resolved:</span>
                      <span className={`font-mono font-semibold ${resolvedTids.size > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                        {resolvedTids.size} / {activeTids.length}
                      </span>
                    </div>
                    <div className="h-3 w-px bg-border" />
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Saved:</span>
                      <span className={`font-mono font-semibold ${savedBookings.size > 0 ? "text-blue-600" : "text-muted-foreground"}`}>
                        {savedBookings.size} bookings
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setActiveRowKey(null)} data-testid="cancel-action">Cancel</Button>
                    <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={confirmAction} data-testid="confirm-action">
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Confirm & Apply
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {!activeRowKey && (
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
                      const defaultTap = getRuleTap(row.subCategory, row.spNetLc, disputeAmt);
                      const tapRule = CANCELLATION_TAP_RULES[row.subCategory];
                      const tapStr = tapOverrides[row.rowKey] !== undefined
                        ? tapOverrides[row.rowKey]
                        : fmt(defaultTap);
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
                            <div className="flex flex-col items-end gap-0.5">
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
                                    const parsed = parseFloat(tapStr.replace(/,/g, ""));
                                    setTapOverrides(prev => ({ ...prev, [row.rowKey]: isNaN(parsed) ? "0.00" : fmt(parsed) }));
                                    setTapConfirmedRows(prev => new Set(prev).add(row.rowKey));
                                  }}
                                  title={isConfirmed ? "Confirmed" : "Confirm this amount"}
                                  data-testid={`tap-confirm-${row.rowKey}`}
                                >
                                  <Check className="h-3 w-3" />
                                </Button>
                              </div>
                              {tapRule && (
                                <span className="text-[9px] text-muted-foreground italic leading-tight" data-testid={`tap-hint-${row.rowKey}`}>
                                  {tapRule.hint}
                                </span>
                              )}
                            </div>
                          </TableCell>
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
                          const def = getRuleTap(r.subCategory, r.spNetLc, d);
                          const raw = tapOverrides[r.rowKey] !== undefined ? tapOverrides[r.rowKey].replace(/,/g, "") : def.toFixed(2);
                          return s + (parseFloat(raw) || 0);
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

        <Dialog open={paxOpen && !!paxTid} onOpenChange={open => { if (!open) { setPaxOpen(false); setPaxTid(null); setPaxPrices({}); } }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Calculator className="h-4 w-4 text-violet-600" />
                Pax Pricing — {paxTid?.tid}
              </DialogTitle>
            </DialogHeader>
            {paxTid && (() => {
              const { paxDateRows: paxRows } = buildPaxDateRows(paxTid.bookings);
              const hasPaxRows = paxRows.length > 0;
              const spTotal = paxTid.bookings.reduce((s, b) => s + (b.spNetInHo || 0), 0);
              const hoTotal = paxTid.bookings.reduce((s, b) => s + (b.hoNet || 0), 0);
              const computeGrandTotal = () => {
                return paxRows.reduce((s, row) => {
                  const priceStr = paxPrices[row.rowKey];
                  const finalPrice = priceStr !== undefined && priceStr !== "" ? parseFloat(priceStr) || 0 : row.spUnitPrice;
                  return s + finalPrice * row.count;
                }, 0);
              };
              const grandTotal = computeGrandTotal();

              return (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 text-sm">
                    <div>SP Total: <span className="font-mono font-semibold text-blue-600">{fmt(spTotal)}</span></div>
                    <div>HO Total: <span className="font-mono font-semibold text-green-600">{fmt(hoTotal)}</span></div>
                    <div className="ml-auto">New Total: <span className="font-mono font-semibold text-violet-600">{fmt(grandTotal)}</span></div>
                  </div>
                  {hasPaxRows ? (
                    <div className="rounded-md border overflow-hidden">
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
                          {paxRows.map(pr => {
                            const unitVal = paxPrices[pr.rowKey] ?? "";
                            const computed = (parseFloat(unitVal) || pr.spUnitPrice) * pr.count;
                            return (
                              <TableRow key={pr.rowKey} className="h-8">
                                <TableCell className="py-1 pl-3 text-xs font-medium">{pr.paxType}</TableCell>
                                <TableCell className="py-1 text-xs text-muted-foreground">{pr.dateRange}</TableCell>
                                <TableCell className="py-1 text-right text-xs">{pr.count}</TableCell>
                                <TableCell className="py-1 text-right font-mono text-xs text-blue-600">{fmt(pr.spUnitPrice)}</TableCell>
                                <TableCell className="py-1 text-right font-mono text-xs text-green-600">{fmt(pr.hoUnitPrice)}</TableCell>
                                <TableCell className="py-1 text-right pr-3">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <span className="text-[10px] text-muted-foreground font-mono">= {fmt(computed)}</span>
                                    <Input
                                      className="h-6 w-20 text-xs text-right font-mono ml-auto border-dashed"
                                      value={unitVal}
                                      onChange={e => setPaxPrices(prev => ({ ...prev, [pr.rowKey]: e.target.value }))}
                                      placeholder={String(pr.spUnitPrice)}
                                      data-testid={`pax-price-${pr.rowKey}`}
                                    />
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="text-center py-6 text-muted-foreground text-sm">No pax breakdown available for this TID</div>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => { setPaxOpen(false); setPaxTid(null); }}>Cancel</Button>
                    <Button onClick={handlePaxSave} disabled={priceOverrideMutation.isPending} className="bg-violet-600 hover:bg-violet-700 text-white">
                      {priceOverrideMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                      Apply Pax Pricing
                    </Button>
                  </div>
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>

        {feedback && (
          <div className="fixed bottom-14 right-4 flex items-center gap-2 bg-violet-600 text-white text-xs px-3 py-2 rounded shadow-lg z-50">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {feedback}
          </div>
        )}

        {toastMsg && (
          <div className="fixed bottom-4 right-4 flex items-center gap-2 bg-foreground text-background text-xs px-3 py-2 rounded shadow-lg z-50" data-testid="toast-notification">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
            {toastMsg}
            <button onClick={() => setToastMsg(null)} className="ml-1 opacity-60 hover:opacity-100">
              <XIcon className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export default CancellationsWorkspace;
