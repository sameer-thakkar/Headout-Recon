import { useState, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { TrendingUp, FileWarning, AlertTriangle, Check, X, ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BookingForPayable } from "./amount-payable-modal";
import type { PrimaryRow } from "@shared/schema";
import { driTeams } from "@shared/schema";

function formatNumberModal(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSignedDisc(value: number): string {
  const formatted = formatNumberModal(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function discColor(value: number): string {
  if (value > 0) return "text-green-700 dark:text-green-300";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

interface TidAggregate {
  tid: string;
  bookings: BookingForPayable[];
  bookingCount: number;
  totalSpNet: number;
  totalHoNet: number;
  discrepancy: number;
  fulfillmentMethods: string[];
  hasMixedFulfillment: boolean;
}

function buildTidAggregates(bookings: BookingForPayable[], allRows: PrimaryRow[]): TidAggregate[] {
  const tidMap = new Map<string, BookingForPayable[]>();
  for (const b of bookings) {
    const tid = b.tid || "UNKNOWN";
    if (!tidMap.has(tid)) tidMap.set(tid, []);
    tidMap.get(tid)!.push(b);
  }

  const aggregates: TidAggregate[] = [];
  Array.from(tidMap.entries()).forEach(([tid, tidBookings]) => {
    const totalSpNet = Math.round(tidBookings.reduce((s: number, b: BookingForPayable) => s + b.spNet, 0) * 100) / 100;
    const totalHoNet = Math.round(tidBookings.reduce((s: number, b: BookingForPayable) => s + b.hoNet, 0) * 100) / 100;
    const disc = Math.round((totalHoNet - totalSpNet) * 100) / 100;

    const fmSet = new Set<string>();
    tidBookings.forEach((b) => {
      const row = allRows.find(r => r.bookingId === b.bookingId);
      if (row?.fulfillmentMethod) fmSet.add(row.fulfillmentMethod);
    });
    const fulfillmentMethods = Array.from(fmSet);

    aggregates.push({
      tid,
      bookings: tidBookings,
      bookingCount: tidBookings.length,
      totalSpNet,
      totalHoNet,
      discrepancy: disc,
      fulfillmentMethods,
      hasMixedFulfillment: fulfillmentMethods.length > 1,
    });
  });

  return aggregates.sort((a, b) => Math.abs(b.discrepancy) - Math.abs(a.discrepancy));
}

interface PredictiveInsight {
  tid: string;
  indicator: string;
  detail: string;
}

interface ScoredInsight {
  indicator: string;
  detail: string;
  confidence: number;
}

function analyzeTakeRate(bookings: BookingForPayable[], rows: PrimaryRow[]): ScoredInsight | null {
  const takeRateData: { bookingId: string; hsp: number; hoTake: number; actualTake: number; gap: number }[] = [];

  for (const b of bookings) {
    const row = rows.find(r => r.bookingId === b.bookingId);
    const hsp = row?.headoutSellingPrice;
    if (!hsp || hsp <= 0) continue;

    const hoTake = ((hsp - b.hoNet) / hsp) * 100;
    const actualTake = ((hsp - b.spNet) / hsp) * 100;
    const gap = hoTake - actualTake;
    takeRateData.push({ bookingId: b.bookingId, hsp, hoTake, actualTake, gap });
  }

  if (takeRateData.length === 0) return null;
  const coverageRatio = takeRateData.length / bookings.length;
  if (coverageRatio < 0.3) return null;

  const avgHoTake = takeRateData.reduce((s, d) => s + d.hoTake, 0) / takeRateData.length;
  const avgActualTake = takeRateData.reduce((s, d) => s + d.actualTake, 0) / takeRateData.length;
  const avgGap = avgHoTake - avgActualTake;
  const absGap = Math.abs(avgGap);

  if (absGap < 0.5) return null;

  const gaps = takeRateData.map(d => d.gap);
  const meanGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const variance = gaps.reduce((s, g) => s + Math.pow(g - meanGap, 2), 0) / gaps.length;
  const stdDev = Math.sqrt(variance);
  const isConsistent = stdDev < absGap * 0.5;

  const negativeActualCount = takeRateData.filter(d => d.actualTake < 0).length;
  const soldAtLoss = negativeActualCount > 0;

  let detail: string;
  const hoStr = avgHoTake.toFixed(1);
  const actualStr = avgActualTake.toFixed(1);
  const gapStr = absGap.toFixed(1);

  if (soldAtLoss) {
    const lossRatio = negativeActualCount / takeRateData.length;
    detail = `Margin erosion: HO expected ${hoStr}% take rate but actual is ${actualStr}% — a ${gapStr}pp shortfall. ` +
      `${negativeActualCount} of ${takeRateData.length} bookings have negative actual take rate (SP cost exceeds selling price). ` +
      `${lossRatio >= 0.5 ? "Systematic loss on this TID — likely a rate configuration issue." : "Selective loss on some bookings — check for rate overrides or special pricing."}`;
  } else if (avgGap > 0 && isConsistent) {
    detail = `Consistent margin gap: HO expected ${hoStr}% take rate but actual is ${actualStr}%, ` +
      `resulting in a uniform ${gapStr}pp shortfall across ${takeRateData.length} bookings. ` +
      `SP is charging more than HO's agreed rate — likely a systematic rate mismatch that needs correction.`;
  } else if (avgGap > 0) {
    detail = `Variable margin gap: HO expected ${hoStr}% take rate vs ${actualStr}% actual (${gapStr}pp avg shortfall). ` +
      `Gap varies across bookings (std dev: ${stdDev.toFixed(1)}pp) — suggests rate changed during the period or mixed pricing applies.`;
  } else if (avgGap < 0 && isConsistent) {
    detail = `SP charging below agreed rate: HO expected ${hoStr}% take rate but actual is ${actualStr}% ` +
      `(${gapStr}pp higher margin than expected across ${takeRateData.length} bookings). ` +
      `SP may have applied a lower rate — verify if this is intentional before reconciling.`;
  } else {
    detail = `Take rate variance: HO expected ${hoStr}% vs ${actualStr}% actual. ` +
      `${gapStr}pp average gap with high variability (std dev: ${stdDev.toFixed(1)}pp) — multiple rate tiers may be in play.`;
  }

  let confidence: number;
  if (soldAtLoss) {
    confidence = 0.9 + (coverageRatio * 0.05);
  } else if (isConsistent && absGap >= 2) {
    confidence = 0.8 + (coverageRatio * 0.1);
  } else if (absGap >= 2) {
    confidence = 0.65 + (coverageRatio * 0.1);
  } else {
    confidence = 0.45 + (absGap / 10) + (coverageRatio * 0.05);
  }
  confidence = Math.min(confidence, 0.95);

  return {
    indicator: soldAtLoss ? "Sold at Loss" : (avgGap > 0 ? "Take Rate Compressed" : "Take Rate Surplus"),
    detail,
    confidence,
  };
}

function generatePredictiveInsights(topTids: TidAggregate[], allRows: PrimaryRow[]): PredictiveInsight[] {
  const insights: PredictiveInsight[] = [];

  for (const tidAgg of topTids) {
    const tidRows = allRows.filter(r => r.tid === tidAgg.tid);
    const candidates: ScoredInsight[] = [];

    const paxResult = analyzePaxIssues(tidAgg.bookings, tidRows);
    if (paxResult) candidates.push(paxResult);

    const priceResult = analyzePriceChanges(tidAgg.bookings, tidRows);
    if (priceResult) candidates.push(priceResult);

    const takeRateResult = analyzeTakeRate(tidAgg.bookings, tidRows);
    if (takeRateResult) candidates.push(takeRateResult);

    if (tidAgg.hasMixedFulfillment) {
      candidates.push({
        indicator: "Mixed Fulfillment",
        detail: `Multiple fulfillment methods (${tidAgg.fulfillmentMethods.join(", ")}) within the same TID — ` +
          `different methods may carry different cost structures, contributing to the price discrepancy.`,
        confidence: 0.5,
      });
    }

    const dateResult = analyzeDateSpecificIssues(tidAgg.bookings, tidRows);
    if (dateResult) candidates.push(dateResult);

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.confidence - a.confidence);
      const best = candidates[0];
      insights.push({ tid: tidAgg.tid, indicator: best.indicator, detail: best.detail });
    }
  }

  return insights;
}

function analyzePaxIssues(bookings: BookingForPayable[], rows: PrimaryRow[]): ScoredInsight | null {
  let missingPaxCount = 0;
  let mismatchedPaxCount = 0;

  for (const b of bookings) {
    if (!b.paxBreakdown || b.paxBreakdown.length === 0) {
      missingPaxCount++;
      continue;
    }

    const paxTotal = Math.round(b.paxBreakdown.reduce((s, p) => s + p.priceNet, 0) * 100) / 100;
    const hoNet = Math.round(b.hoNet * 100) / 100;
    if (Math.abs(paxTotal - hoNet) > 1) {
      mismatchedPaxCount++;
    }
  }

  if (mismatchedPaxCount > 0) {
    const ratio = mismatchedPaxCount / bookings.length;
    const scope = ratio >= 0.8 ? "nearly all" : ratio >= 0.5 ? "most" : "some";
    return {
      indicator: "Pax Price Mismatch",
      detail: `Pax breakdown totals don't match HO Net in ${mismatchedPaxCount} of ${bookings.length} bookings (${scope}). ` +
        `${ratio >= 0.5 ? "This points to a systematic unit price discrepancy — HO and SP are using different per-pax rates." : "Selective mismatch suggests rate overrides or mixed pricing on certain bookings."}`,
      confidence: 0.7 + (ratio * 0.2),
    };
  }

  const paxPricesByTypeAndDate = new Map<string, { unitPrice: number; date: string }[]>();
  for (const b of bookings) {
    if (!b.paxBreakdown) continue;
    const row = rows.find(r => r.bookingId === b.bookingId);
    const dateStr = b.experienceDate || row?.experienceDate || b.bookingCreationDate || row?.bookingCreationDate || "";
    for (const p of b.paxBreakdown) {
      if (!paxPricesByTypeAndDate.has(p.paxType)) paxPricesByTypeAndDate.set(p.paxType, []);
      paxPricesByTypeAndDate.get(p.paxType)!.push({ unitPrice: p.unitPrice, date: dateStr });
    }
  }

  const paxEntries = Array.from(paxPricesByTypeAndDate.entries());
  for (let i = 0; i < paxEntries.length; i++) {
    const [paxType, entries] = paxEntries[i];
    const uniquePrices = Array.from(new Set(entries.map(e => e.unitPrice)));
    if (uniquePrices.length > 1) {
      const sorted = uniquePrices.sort((a: number, b: number) => a - b);
      const datedEntries = entries.filter(e => e.date).sort((a, b) => a.date.localeCompare(b.date));
      let changeDate = "";
      if (datedEntries.length >= 2) {
        for (let j = 1; j < datedEntries.length; j++) {
          if (datedEntries[j].unitPrice !== datedEntries[j - 1].unitPrice) {
            changeDate = datedEntries[j].date;
            break;
          }
        }
      }
      let formattedChangeDate = "";
      if (changeDate) {
        try {
          const d = new Date(changeDate);
          if (!isNaN(d.getTime())) {
            formattedChangeDate = d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
          } else {
            formattedChangeDate = changeDate;
          }
        } catch { formattedChangeDate = changeDate; }
      }
      const datePart = formattedChangeDate ? ` around ${formattedChangeDate}` : " during the period";
      return {
        indicator: "Pax Price Changed",
        detail: `${paxType} unit price shifted from ${formatNumberModal(sorted[0])} to ${formatNumberModal(sorted[sorted.length - 1])}${datePart}. ` +
          `This rate change${sorted.length > 2 ? ` (${sorted.length} distinct rates observed)` : ""} is likely the root cause — ` +
          `HO and SP may be referencing different rate cards or the rate update wasn't applied consistently.`,
        confidence: 0.85,
      };
    }
  }

  if (missingPaxCount > 0 && missingPaxCount === bookings.length) {
    return {
      indicator: "Missing Pax Data",
      detail: `All ${bookings.length} bookings lack pax type breakdown. Unable to verify unit pricing.`,
      confidence: 0.15,
    };
  }

  return null;
}

function analyzePriceChanges(bookings: BookingForPayable[], rows: PrimaryRow[]): ScoredInsight | null {
  const dated: { date: string; hoNet: number; spNet: number; bookingId: string }[] = [];

  for (const b of bookings) {
    const row = rows.find(r => r.bookingId === b.bookingId);
    const dateStr = b.experienceDate || row?.experienceDate || b.bookingCreationDate || row?.bookingCreationDate;
    if (dateStr) {
      dated.push({ date: dateStr, hoNet: b.hoNet, spNet: b.spNet, bookingId: b.bookingId });
    }
  }

  if (dated.length < 2) return null;

  dated.sort((a, b) => a.date.localeCompare(b.date));

  let maxShift = 0;
  let shiftDate = "";
  for (let i = 1; i < dated.length; i++) {
    const prevDisc = dated[i - 1].hoNet - dated[i - 1].spNet;
    const currDisc = dated[i].hoNet - dated[i].spNet;
    const shift = Math.abs(currDisc - prevDisc);
    if (shift > maxShift) {
      maxShift = shift;
      shiftDate = dated[i].date;
    }
  }

  if (maxShift > 1 && shiftDate) {
    let formattedDate = shiftDate;
    try {
      const d = new Date(shiftDate);
      if (!isNaN(d.getTime())) {
        formattedDate = d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
      }
    } catch {}
    const totalDisc = Math.abs(bookings.reduce((s, b) => s + (b.hoNet - b.spNet), 0));
    const shiftRatio = totalDisc > 0 ? Math.min(maxShift / totalDisc, 1) : 0.5;
    return {
      indicator: "Rate Shift Detected",
      detail: `Discrepancy pattern changes sharply around ${formattedDate} (${formatNumberModal(maxShift)} swing). ` +
        `${shiftRatio >= 0.5 ? "This single date explains most of the total discrepancy — a rate or configuration change likely took effect here." : "A rate adjustment or pricing update may have been applied on this date, partially explaining the discrepancy."}`,
      confidence: 0.55 + (shiftRatio * 0.25),
    };
  }

  return null;
}

function analyzeDateSpecificIssues(bookings: BookingForPayable[], rows: PrimaryRow[]): ScoredInsight | null {
  const discByDate = new Map<string, { total: number; count: number }>();

  for (const b of bookings) {
    const row = rows.find(r => r.bookingId === b.bookingId);
    const dateStr = b.experienceDate || row?.experienceDate || b.bookingCreationDate || row?.bookingCreationDate;
    if (!dateStr) continue;

    const disc = b.hoNet - b.spNet;
    const entry = discByDate.get(dateStr) || { total: 0, count: 0 };
    entry.total += disc;
    entry.count++;
    discByDate.set(dateStr, entry);
  }

  if (discByDate.size < 2) return null;

  let worstDate = "";
  let worstAvg = 0;
  let totalAbsDisc = 0;
  Array.from(discByDate.entries()).forEach(([date, entry]) => {
    const avg = Math.abs(entry.total / entry.count);
    totalAbsDisc += Math.abs(entry.total);
    if (avg > worstAvg) {
      worstAvg = avg;
      worstDate = date;
    }
  });

  if (worstDate && worstAvg > 1) {
    const entry = discByDate.get(worstDate)!;
    let formattedDate = worstDate;
    try {
      const d = new Date(worstDate);
      if (!isNaN(d.getTime())) {
        formattedDate = d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
      }
    } catch {}
    const concentration = totalAbsDisc > 0 ? Math.abs(entry.total) / totalAbsDisc : 0;
    const avgDisc = entry.total / entry.count;
    const direction = avgDisc > 0 ? "underpaying" : "overpaying";
    return {
      indicator: "Date-Specific Issue",
      detail: `${formattedDate} stands out with avg ${formatSignedDisc(avgDisc)} discrepancy across ${entry.count} bookings — SP appears to be ${direction} on this date. ` +
        `${concentration >= 0.5 ? "This date accounts for the majority of the total discrepancy — investigate if a one-off rate or pricing error occurred." : "Consider checking if a special rate or promotion was active on this date."}`,
      confidence: 0.4 + (concentration * 0.3),
    };
  }

  return null;
}

export interface ReasonLevelModalHandle {
  open: (reason: string, section: "discrepancy" | "cancellation" | "secondary_vendor") => void;
}

export interface ReasonLevelModalProps {
  currency: string;
  runId?: string | null;
  allRows: PrimaryRow[];
  bookingsByReason: Record<string, BookingForPayable[]>;
  cancellationsByReason: Record<string, BookingForPayable[]>;
  secondaryVendorByReason: Record<string, BookingForPayable[]>;
  localSelections: Record<string, "ho" | "sp">;
  activeDisputes: Set<string>;
  disputeAmounts: Map<string, number>;
  onApplyBulkSelection: (bookingIds: string[], value: "ho" | "sp") => void;
  onApplyFlatAdjustment: (bookingIds: string[], adjustment: number) => void;
  onRaiseDispute: (bookings: BookingForPayable[]) => void;
  onClearDisputes: (bookingIds: string[]) => void;
  onLogIssue: (reason: string, description: string, priority: "low" | "medium" | "high", driTeam: string, bookingIds: string[]) => void;
}

export const ReasonLevelModal = forwardRef<ReasonLevelModalHandle, ReasonLevelModalProps>(
  function ReasonLevelModal(props, ref) {
    const {
      currency,
      allRows,
      bookingsByReason,
      cancellationsByReason,
      secondaryVendorByReason,
      localSelections,
      activeDisputes,
      disputeAmounts,
      onApplyBulkSelection,
      onApplyFlatAdjustment,
      onRaiseDispute,
      onClearDisputes,
      onLogIssue,
    } = props;

    const [isOpen, setIsOpen] = useState(false);
    const [reason, setReason] = useState("");
    const [section, setSection] = useState<"discrepancy" | "cancellation" | "secondary_vendor">("discrepancy");
    const [issueOpen, setIssueOpen] = useState(false);
    const [disputeOpen, setDisputeOpen] = useState(false);
    const [issuePriority, setIssuePriority] = useState<"low" | "medium" | "high">("medium");
    const [issueDescription, setIssueDescription] = useState("");
    const [driTeamOverride, setDriTeamOverride] = useState<string>("");
    const [showAllTids, setShowAllTids] = useState(false);

    useImperativeHandle(ref, () => ({
      open: (r: string, s: "discrepancy" | "cancellation" | "secondary_vendor") => {
        setReason(r);
        setSection(s);
        setIssueOpen(false);
        setDisputeOpen(false);
        setIssuePriority("medium");
        setIssueDescription("");
        setDriTeamOverride("");
        setShowAllTids(false);
        setIsOpen(true);
      },
    }));

    const bookings = useMemo(() => {
      const source =
        section === "discrepancy"
          ? bookingsByReason
          : section === "cancellation"
            ? cancellationsByReason
            : secondaryVendorByReason;
      return source[reason] || [];
    }, [reason, section, bookingsByReason, cancellationsByReason, secondaryVendorByReason]);

    const tidAggregates = useMemo(() => {
      return buildTidAggregates(bookings, allRows);
    }, [bookings, allRows]);

    const totalSpNet = useMemo(
      () => Math.round(bookings.reduce((s, b) => s + b.spNet, 0) * 100) / 100,
      [bookings]
    );

    const totalHoNet = useMemo(
      () => Math.round(bookings.reduce((s, b) => s + b.hoNet, 0) * 100) / 100,
      [bookings]
    );

    const totalDiscrepancy = useMemo(
      () => Math.round((totalHoNet - totalSpNet) * 100) / 100,
      [totalHoNet, totalSpNet]
    );

    const detectedDriTeam = useMemo(() => {
      const match = allRows.find((r) => r.reason === reason && r.driTeam);
      return match?.driTeam || "";
    }, [allRows, reason]);

    const effectiveDriTeam = driTeamOverride || detectedDriTeam || "Tech";

    const topPositiveTid = useMemo(() => {
      return tidAggregates.find(t => t.discrepancy > 0) || null;
    }, [tidAggregates]);

    const topNegativeTid = useMemo(() => {
      return tidAggregates.find(t => t.discrepancy < 0) || null;
    }, [tidAggregates]);

    const pinnedTidIds = useMemo(() => {
      const ids = new Set<string>();
      if (topPositiveTid) ids.add(topPositiveTid.tid);
      if (topNegativeTid) ids.add(topNegativeTid.tid);
      return ids;
    }, [topPositiveTid, topNegativeTid]);

    const pinnedTids = useMemo(() => {
      return tidAggregates.filter(t => pinnedTidIds.has(t.tid));
    }, [tidAggregates, pinnedTidIds]);

    const collapsedTids = useMemo(() => {
      return tidAggregates.filter(t => !pinnedTidIds.has(t.tid));
    }, [tidAggregates, pinnedTidIds]);

    const predictiveInsights = useMemo(() => {
      return generatePredictiveInsights(pinnedTids, allRows);
    }, [pinnedTids, allRows]);

    const isCancellationType = reason.toLowerCase().includes("cancel");
    const isReconciled = reason === "Reconciled";
    const isUnmapped = reason === "Unmapped";
    const isNegativeSp = reason.toLowerCase().includes("negative sp");

    const handleUseHoAll = useCallback(() => {
      onApplyBulkSelection(bookings.map((b) => b.bookingId), "ho");
    }, [bookings, onApplyBulkSelection]);

    const handleUseSpAll = useCallback(() => {
      onApplyBulkSelection(bookings.map((b) => b.bookingId), "sp");
    }, [bookings, onApplyBulkSelection]);

    const handleSetZeroAll = useCallback(() => {
      onApplyFlatAdjustment(bookings.map((b) => b.bookingId), 0);
    }, [bookings, onApplyFlatAdjustment]);

    const handleFlagIssue = useCallback(() => {
      onLogIssue(
        reason,
        issueDescription,
        issuePriority,
        effectiveDriTeam,
        bookings.map((b) => b.bookingId)
      );
      setIssueOpen(false);
      setIssueDescription("");
    }, [reason, issueDescription, issuePriority, effectiveDriTeam, bookings, onLogIssue]);

    const handleGeneratePredictiveText = useCallback(() => {
      if (predictiveInsights.length === 0) return;
      const lines = predictiveInsights.map(
        (ins) => `TID ${ins.tid} [${ins.indicator}]: ${ins.detail}`
      );
      setIssueDescription((prev) => {
        if (prev.trim()) return prev + "\n\n" + lines.join("\n");
        return lines.join("\n");
      });
    }, [predictiveInsights]);

    const disputableBookings = useMemo(() => {
      return bookings.filter(
        (b) => {
          const sel = localSelections[b.bookingId] || "sp";
          return sel === "sp" || reason === "Unmapped";
        }
      );
    }, [bookings, localSelections, reason]);

    const totalDisputeAmount = useMemo(() => {
      return Math.round(
        disputableBookings.reduce((s, b) => s + Math.abs(b.spNet - b.hoNet), 0) * 100
      ) / 100;
    }, [disputableBookings]);

    const handleDisputeAllFiltered = useCallback(() => {
      onRaiseDispute(disputableBookings);
    }, [disputableBookings, onRaiseDispute]);

    const handleClearAllDisputes = useCallback(() => {
      onClearDisputes(bookings.map((b) => b.bookingId));
    }, [bookings, onClearDisputes]);

    const activeDisputeCount = useMemo(() => {
      return bookings.filter((b) => activeDisputes.has(b.bookingId)).length;
    }, [bookings, activeDisputes]);

    const activeDisputeTotal = useMemo(() => {
      let total = 0;
      bookings.forEach((b) => {
        const amt = disputeAmounts.get(b.bookingId);
        if (amt) total += amt;
      });
      return Math.round(total * 100) / 100;
    }, [bookings, disputeAmounts]);

    const getTidSelectionSummary = useCallback((tidAgg: TidAggregate): { label: string; variant: "default" | "secondary" | "outline" } => {
      let hoCount = 0;
      let spCount = 0;
      tidAgg.bookings.forEach((b) => {
        const sel = localSelections[b.bookingId] || "sp";
        if (sel === "ho") hoCount++;
        else spCount++;
      });
      if (hoCount === tidAgg.bookingCount) return { label: "HO", variant: "secondary" };
      if (spCount === tidAgg.bookingCount) return { label: "SP", variant: "default" };
      return { label: `${hoCount}HO/${spCount}SP`, variant: "outline" };
    }, [localSelections]);

    const renderTidRow = useCallback((tidAgg: TidAggregate, isPinned: boolean) => {
      const selSummary = getTidSelectionSummary(tidAgg);
      return (
        <TableRow
          key={tidAgg.tid}
          className={isPinned ? "bg-muted/20" : ""}
          data-testid={`row-tid-${tidAgg.tid}`}
        >
          <TableCell className="text-xs font-mono font-medium">{tidAgg.tid}</TableCell>
          <TableCell className="text-xs font-mono text-center">{tidAgg.bookingCount}</TableCell>
          <TableCell className="text-xs font-mono text-right text-blue-700 dark:text-blue-300">
            {formatNumberModal(tidAgg.totalSpNet)}
          </TableCell>
          <TableCell className="text-xs font-mono text-right text-green-700 dark:text-green-300">
            {formatNumberModal(tidAgg.totalHoNet)}
          </TableCell>
          <TableCell className={`text-xs font-mono text-right font-semibold ${discColor(tidAgg.discrepancy)}`}>
            {formatSignedDisc(tidAgg.discrepancy)}
          </TableCell>
          <TableCell className="text-xs text-center">
            <Badge variant={selSummary.variant} className="text-xs no-default-active-elevate">
              {selSummary.label}
            </Badge>
          </TableCell>
          <TableCell className="text-xs">
            {tidAgg.hasMixedFulfillment ? (
              <Badge variant="outline" className="text-xs no-default-active-elevate">Mixed</Badge>
            ) : tidAgg.fulfillmentMethods[0] ? (
              <span className="text-muted-foreground">{tidAgg.fulfillmentMethods[0]}</span>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </TableCell>
        </TableRow>
      );
    }, [getTidSelectionSummary]);

    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-5 w-5 text-primary" />
              Manage Reason: {reason}
            </DialogTitle>
            <DialogDescription>
              {tidAggregates.length} TIDs, {bookings.length} bookings in {section === "discrepancy" ? "discrepancy" : section === "cancellation" ? "cancellation" : "secondary vendor"} section
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1" data-testid="reason-modal-scroll-area">
            <div className="rounded-md border bg-background overflow-visible">
              <div className="px-4 py-3 border-b bg-blue-50 dark:bg-blue-900/20">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-8 w-8 rounded-md bg-blue-100 dark:bg-blue-900/30">
                    <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="text-sm font-medium">Price Update</div>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  <div className="rounded-md border p-2 bg-muted/30">
                    <div className="text-xs text-muted-foreground">TIDs / Bookings</div>
                    <div className="text-sm font-semibold font-mono" data-testid="stat-tid-count">
                      {tidAggregates.length} / {bookings.length}
                    </div>
                  </div>
                  <div className="rounded-md border p-2 bg-blue-50/50 dark:bg-blue-900/10">
                    <div className="text-xs text-muted-foreground">Total SP Net</div>
                    <div className="text-sm font-semibold font-mono text-blue-700 dark:text-blue-300" data-testid="stat-sp-net">
                      {formatNumberModal(totalSpNet)}
                    </div>
                  </div>
                  <div className="rounded-md border p-2 bg-green-50/50 dark:bg-green-900/10">
                    <div className="text-xs text-muted-foreground">Total HO Net</div>
                    <div className="text-sm font-semibold font-mono text-green-700 dark:text-green-300" data-testid="stat-ho-net">
                      {formatNumberModal(totalHoNet)}
                    </div>
                  </div>
                  <div className="rounded-md border p-2 bg-amber-50/50 dark:bg-amber-900/10">
                    <div className="text-xs text-muted-foreground">Discrepancy (HO-SP)</div>
                    <div className={`text-sm font-semibold font-mono ${discColor(totalDiscrepancy)}`} data-testid="stat-discrepancy">
                      {formatSignedDisc(totalDiscrepancy)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {isReconciled ? (
                    <Button
                      size="sm"
                      className="bg-green-600 text-white"
                      onClick={handleUseHoAll}
                      data-testid="btn-confirm-all-paid"
                    >
                      <Check className="h-3.5 w-3.5 mr-1.5" />
                      Confirm All as Paid
                    </Button>
                  ) : isUnmapped ? (
                    <Button
                      size="sm"
                      className="bg-blue-600 text-white"
                      onClick={handleUseSpAll}
                      data-testid="btn-use-sp-all"
                    >
                      Use SP Net for All
                    </Button>
                  ) : isCancellationType ? (
                    <Button
                      size="sm"
                      className="bg-green-600 text-white"
                      onClick={handleUseHoAll}
                      data-testid="btn-accept-cancellation"
                    >
                      Accept Cancellation Pricing
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        className="bg-green-600 text-white"
                        onClick={handleUseHoAll}
                        data-testid="btn-use-ho-all"
                      >
                        Use HO Net for All
                      </Button>
                      <Button
                        size="sm"
                        className="bg-blue-600 text-white"
                        onClick={handleUseSpAll}
                        data-testid="btn-use-sp-all"
                      >
                        Use SP Net for All
                      </Button>
                    </>
                  )}
                  {isNegativeSp && (
                    <Button
                      size="sm"
                      className="bg-red-600 text-white"
                      onClick={handleSetZeroAll}
                      data-testid="btn-set-zero-all"
                    >
                      Set Final Net = 0 for All
                    </Button>
                  )}
                </div>

                {pinnedTids.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground font-medium">
                      Top Discrepancies
                    </div>
                    <div className="overflow-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">TID</TableHead>
                            <TableHead className="text-xs text-center">Bookings</TableHead>
                            <TableHead className="text-xs text-right">SP Net</TableHead>
                            <TableHead className="text-xs text-right">HO Net</TableHead>
                            <TableHead className="text-xs text-right">Discrepancy</TableHead>
                            <TableHead className="text-xs text-center">Selection</TableHead>
                            <TableHead className="text-xs">Fulfillment</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pinnedTids.map((t) => renderTidRow(t, true))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {collapsedTids.length > 0 && (
                  <Collapsible open={showAllTids} onOpenChange={setShowAllTids}>
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-center text-xs text-muted-foreground"
                        data-testid="btn-show-all-tids"
                      >
                        {showAllTids ? (
                          <>
                            <ChevronDown className="h-3.5 w-3.5 mr-1" />
                            Hide {collapsedTids.length} more TIDs
                          </>
                        ) : (
                          <>
                            <ChevronRight className="h-3.5 w-3.5 mr-1" />
                            Show {collapsedTids.length} more TIDs
                          </>
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="overflow-auto max-h-48 rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">TID</TableHead>
                              <TableHead className="text-xs text-center">Bookings</TableHead>
                              <TableHead className="text-xs text-right">SP Net</TableHead>
                              <TableHead className="text-xs text-right">HO Net</TableHead>
                              <TableHead className="text-xs text-right">Discrepancy</TableHead>
                              <TableHead className="text-xs text-center">Selection</TableHead>
                              <TableHead className="text-xs">Fulfillment</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {collapsedTids.map((t) => renderTidRow(t, false))}
                          </TableBody>
                        </Table>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {tidAggregates.length === 0 && (
                  <div className="text-center text-xs text-muted-foreground py-4">
                    No TIDs found for this reason
                  </div>
                )}
              </div>
            </div>

            <Collapsible open={issueOpen} onOpenChange={setIssueOpen}>
              <div className="rounded-md border bg-background overflow-visible">
                <CollapsibleTrigger asChild>
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover-elevate"
                    data-testid="trigger-flag-issue"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center h-8 w-8 rounded-md bg-orange-100 dark:bg-orange-900/30">
                        <FileWarning className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                      </div>
                      <div className="text-sm font-medium">Flag Issue</div>
                    </div>
                    {issueOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 pb-4 space-y-3 border-t pt-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">DRI Team:</span>
                      {detectedDriTeam && (
                        <Badge variant="secondary" className="no-default-active-elevate" data-testid="badge-dri-detected">
                          {detectedDriTeam}
                        </Badge>
                      )}
                      <Select
                        value={driTeamOverride || detectedDriTeam || ""}
                        onValueChange={(v) => setDriTeamOverride(v)}
                      >
                        <SelectTrigger className="w-40" data-testid="select-dri-team">
                          <SelectValue placeholder="Override DRI" />
                        </SelectTrigger>
                        <SelectContent>
                          {driTeams.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Priority:</span>
                      {(["low", "medium", "high"] as const).map((p) => (
                        <Badge
                          key={p}
                          variant={issuePriority === p ? "default" : "outline"}
                          className={`cursor-pointer toggle-elevate ${issuePriority === p ? "toggle-elevated" : ""}`}
                          onClick={() => setIssuePriority(p)}
                          data-testid={`badge-priority-${p}`}
                        >
                          {p.charAt(0).toUpperCase() + p.slice(1)}
                        </Badge>
                      ))}
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Description</span>
                        {predictiveInsights.length > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleGeneratePredictiveText}
                            data-testid="btn-generate-predictive"
                          >
                            <Sparkles className="h-3.5 w-3.5 mr-1.5 text-amber-500" />
                            Auto-analyze top TIDs
                          </Button>
                        )}
                      </div>
                      <Textarea
                        placeholder="Describe the issue... Use 'Auto-analyze' to generate insights from booking data."
                        value={issueDescription}
                        onChange={(e) => setIssueDescription(e.target.value)}
                        className="text-xs min-h-[80px]"
                        rows={4}
                        data-testid="textarea-issue-description"
                      />
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">Affected:</span>
                      <Badge variant="secondary" className="no-default-active-elevate" data-testid="badge-tid-count">
                        {tidAggregates.length} TIDs
                      </Badge>
                      <Badge variant="secondary" className="no-default-active-elevate" data-testid="badge-booking-count">
                        {bookings.length} Bookings
                      </Badge>
                    </div>

                    <Button
                      size="sm"
                      className="bg-orange-600 text-white"
                      onClick={handleFlagIssue}
                      disabled={!issueDescription.trim()}
                      data-testid="btn-flag-issue"
                    >
                      <FileWarning className="h-3.5 w-3.5 mr-1.5" />
                      Flag Issue
                    </Button>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            <Collapsible open={disputeOpen} onOpenChange={setDisputeOpen}>
              <div className="rounded-md border bg-background overflow-visible">
                <CollapsibleTrigger asChild>
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover-elevate"
                    data-testid="trigger-raise-dispute"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center h-8 w-8 rounded-md bg-amber-100 dark:bg-amber-900/30">
                        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      </div>
                      <div className="text-sm font-medium">Raise Dispute</div>
                    </div>
                    {disputeOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 pb-4 space-y-3 border-t pt-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs text-muted-foreground">Disputable bookings:</span>
                      <Badge variant="secondary" className="no-default-active-elevate" data-testid="badge-disputable-count">
                        {disputableBookings.length}
                      </Badge>
                      <span className="text-xs text-muted-foreground">Total dispute amount:</span>
                      <Badge variant="secondary" className={`font-mono no-default-active-elevate ${discColor(totalDisputeAmount)}`} data-testid="badge-dispute-total">
                        {formatSignedDisc(totalDisputeAmount)} {currency}
                      </Badge>
                    </div>

                    {activeDisputeCount > 0 && (
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs text-muted-foreground">Active disputes:</span>
                        <Badge variant="default" className="no-default-active-elevate" data-testid="badge-active-dispute-count">
                          {activeDisputeCount}
                        </Badge>
                        <span className={`text-xs font-mono ${discColor(activeDisputeTotal)}`} data-testid="text-active-dispute-total">
                          {formatSignedDisc(activeDisputeTotal)} {currency}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleDisputeAllFiltered}
                        disabled={disputableBookings.length === 0}
                        data-testid="btn-dispute-all-filtered"
                      >
                        <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
                        Dispute All
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleClearAllDisputes}
                        data-testid="btn-clear-all-disputes"
                      >
                        <X className="h-3.5 w-3.5 mr-1.5" />
                        Clear All Disputes
                      </Button>
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
);
