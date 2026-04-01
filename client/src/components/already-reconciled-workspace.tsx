import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Info, ChevronRight, ChevronDown, CheckCircle2, Gavel,
  X as XIcon, FileWarning, TrendingUp, TrendingDown, AlertTriangle,
} from "lucide-react";

const fmt = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface ArWorkspaceBooking {
  bookingId: string;
  tid?: string;
  reason: string;
  hoNet: number;
  spNet: number;
  amountPaid?: number;
  paymentMethod?: string;
  spPaymentMethod?: string;
  hoBeId?: string;
  beId?: string;
  ticketId?: string;
}

export type ARDecision = {
  decision: "pay" | "dont_pay";
  reason: string;
  customReason: string;
  finalAmount: number;
};

interface AlreadyReconciledWorkspaceProps {
  bookings: ArWorkspaceBooking[];
  runId?: string | null;
  currency: string;
  fxData?: { usdToCcy?: Record<string, number> } | null;
  decisions: Map<string, ARDecision>;
  onDecisionChange: (newDecisions: Map<string, ARDecision>) => void;
  activeDisputes: Set<string>;
  disputeAmounts: Map<string, number>;
  onDisputeChange: (newActive: Set<string>, newAmounts: Map<string, number>) => void;
  billingEntityId?: string;
  billingEntityName?: string;
  hasPaymentMismatchFn?: (b: ArWorkspaceBooking) => boolean;
  finalVendorIds?: Map<string, string>;
  onVendorIdChange?: (bookingId: string, value: string) => void;
  onVendorIdSave?: (bookingId: string, value: string) => void;
  dominantPaymentMethod?: string;
  onClose?: () => void;
  showApplyConfirm?: boolean;
}

interface ArTidGroup {
  tid: string;
  bookings: ArWorkspaceBooking[];
  spNet: number;
  hoNet: number;
  discLc: number;
}

interface ArSection {
  id: string;
  label: string;
  type: "same_be" | "different_be";
  hoBeId?: string;
  bookings: ArWorkspaceBooking[];
  tidGroups: ArTidGroup[];
}

const REASON_OPTIONS = [
  { value: "Cancellations", label: "Cancellations" },
  { value: "Multiple tickets booked", label: "Multiple tickets" },
  { value: "Manual Error", label: "Manual Error" },
  { value: "Partial Fulfillment", label: "Partial Fulfillment" },
];
const REASON_VALUES = new Set(REASON_OPTIONS.map(o => o.value));

function buildTidGroups(bks: ArWorkspaceBooking[]): ArTidGroup[] {
  const byTid = new Map<string, ArWorkspaceBooking[]>();
  for (const b of bks) {
    const tid = b.tid || b.bookingId;
    if (!byTid.has(tid)) byTid.set(tid, []);
    byTid.get(tid)!.push(b);
  }
  return Array.from(byTid.entries()).map(([tid, tBks]) => ({
    tid,
    bookings: tBks,
    spNet: tBks.reduce((s, b) => s + b.spNet, 0),
    hoNet: tBks.reduce((s, b) => s + b.hoNet, 0),
    discLc: tBks.reduce((s, b) => s + (b.hoNet - b.spNet), 0),
  }));
}

export function AlreadyReconciledWorkspace({
  bookings,
  runId,
  currency,
  decisions,
  onDecisionChange,
  activeDisputes,
  disputeAmounts,
  onDisputeChange,
  billingEntityId = "",
  billingEntityName = "",
  hasPaymentMismatchFn,
  finalVendorIds,
  onVendorIdChange,
  onVendorIdSave,
  dominantPaymentMethod = "",
  onClose,
  showApplyConfirm = false,
}: AlreadyReconciledWorkspaceProps) {
  const { toast } = useToast();

  const [expandedTids, setExpandedTids] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<string | null>(null);
  const initializedRef = useRef(false);

  const sections = useMemo((): ArSection[] => {
    const sameBE = bookings.filter(b => b.reason === "Already Reconciled-Same BE");
    const diffBE = bookings.filter(b => b.reason === "Already Reconciled-Different BE");
    const result: ArSection[] = [];

    if (sameBE.length > 0) {
      result.push({
        id: "same_be",
        label: "Same Billing Entity",
        type: "same_be",
        bookings: sameBE,
        tidGroups: buildTidGroups(sameBE),
      });
    }

    if (diffBE.length > 0) {
      const byHoBe = new Map<string, ArWorkspaceBooking[]>();
      for (const b of diffBE) {
        const key = b.hoBeId || "unknown";
        if (!byHoBe.has(key)) byHoBe.set(key, []);
        byHoBe.get(key)!.push(b);
      }
      for (const [hoBeId, bks] of byHoBe) {
        const label = hoBeId === "unknown" ? "Different BE · —" : `Different BE · ${hoBeId}`;
        result.push({
          id: `diff_be_${hoBeId}`,
          label,
          type: "different_be",
          hoBeId: hoBeId === "unknown" ? undefined : hoBeId,
          bookings: bks,
          tidGroups: buildTidGroups(bks),
        });
      }
    }
    return result;
  }, [bookings]);

  useEffect(() => {
    if (!initializedRef.current && sections.length > 0) {
      setExpandedSections(new Set(sections.map(s => s.id)));
      initializedRef.current = true;
    }
  }, [sections]);

  useEffect(() => {
    if (feedback) {
      const t = setTimeout(() => setFeedback(null), 2500);
      return () => clearTimeout(t);
    }
  }, [feedback]);

  const issueMutation = useMutation({
    mutationFn: async ({ bookingIds, sectionLabel }: { bookingIds: string[]; sectionLabel: string }) => {
      if (!runId) throw new Error("No active run");
      const totalDisc = bookingIds.reduce((s, id) => {
        const b = bookings.find(bk => bk.bookingId === id);
        return s + (b ? Math.abs(b.spNet - b.hoNet) : 0);
      }, 0);
      const errorBucket = sectionLabel.toLowerCase().includes("different") || sectionLabel.toLowerCase().includes("diff")
        ? "Already Reconciled-Different BE"
        : "Already Reconciled-Same BE";
      await apiRequest("POST", "/api/issues", {
        runId,
        billingEntityId,
        billingEntityName,
        currency,
        discrepancyLocal: totalDisc,
        discrepancyUsd: 0,
        reason: sectionLabel,
        driTeam: "Finance",
        bookingIds,
        errorBucket,
        rca: "",
        issueStatus: "open",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/issues", runId] });
      toast({ title: "Issue logged", description: "Issue created in tracker." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to log issue.", variant: "destructive" });
    },
  });

  const getDecision = useCallback((bookingId: string): ARDecision => {
    return decisions.get(bookingId) ?? { decision: "pay", reason: "", customReason: "", finalAmount: 0 };
  }, [decisions]);

  const setDecision = useCallback((bookingId: string, updates: Partial<ARDecision>) => {
    const current = getDecision(bookingId);
    const newDecisions = new Map(decisions);
    newDecisions.set(bookingId, { ...current, ...updates });
    onDecisionChange(newDecisions);
  }, [decisions, getDecision, onDecisionChange]);

  const setSpNetAllInTid = useCallback((tidGroup: ArTidGroup) => {
    const newDecisions = new Map(decisions);
    for (const b of tidGroup.bookings) {
      const current = newDecisions.get(b.bookingId) ?? { decision: "pay" as const, reason: "", customReason: "", finalAmount: 0 };
      newDecisions.set(b.bookingId, { ...current, decision: "pay", finalAmount: Math.round(Math.abs(b.spNet) * 100) / 100 });
    }
    onDecisionChange(newDecisions);
    setFeedback(`Final Amt set to SP Net for TID ${tidGroup.tid} (${tidGroup.bookings.length} booking${tidGroup.bookings.length > 1 ? "s" : ""})`);
  }, [decisions, onDecisionChange]);

  const setHoNetAllInTid = useCallback((tidGroup: ArTidGroup) => {
    const newDecisions = new Map(decisions);
    for (const b of tidGroup.bookings) {
      const current = newDecisions.get(b.bookingId) ?? { decision: "pay" as const, reason: "", customReason: "", finalAmount: 0 };
      newDecisions.set(b.bookingId, { ...current, decision: "pay", finalAmount: Math.round(Math.abs(b.hoNet) * 100) / 100 });
    }
    onDecisionChange(newDecisions);
    setFeedback(`Final Amt set to HO Net for TID ${tidGroup.tid} (${tidGroup.bookings.length} booking${tidGroup.bookings.length > 1 ? "s" : ""})`);
  }, [decisions, onDecisionChange]);

  const issueForTid = useCallback((tidGroup: ArTidGroup, sectionLabel: string) => {
    if (!runId) { setFeedback("No active run — cannot log issue"); return; }
    issueMutation.mutate({ bookingIds: tidGroup.bookings.map(b => b.bookingId), sectionLabel });
  }, [runId, issueMutation]);

  const disputeAllInTid = useCallback((tidGroup: ArTidGroup) => {
    const newActive = new Set(activeDisputes);
    const newAmounts = new Map(disputeAmounts);
    for (const b of tidGroup.bookings) {
      newActive.add(b.bookingId);
      if (!newAmounts.has(b.bookingId)) {
        newAmounts.set(b.bookingId, Math.round(Math.abs(b.spNet - b.hoNet) * 100) / 100);
      }
    }
    onDisputeChange(newActive, newAmounts);
    setFeedback(`Dispute opened for TID ${tidGroup.tid} (${tidGroup.bookings.length} booking${tidGroup.bookings.length > 1 ? "s" : ""})`);
  }, [activeDisputes, disputeAmounts, onDisputeChange]);

  const toggleTid = (key: string) => {
    setExpandedTids(prev => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key);
      else s.add(key);
      return s;
    });
  };

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  };

  const totalTap = useMemo(() =>
    bookings.reduce((s, b) => {
      const d = decisions.get(b.bookingId);
      if (d?.decision === "dont_pay") return s;
      return s + (d?.finalAmount ?? 0);
    }, 0),
  [bookings, decisions]);

  const totalZeroed = useMemo(() =>
    bookings.filter(b => {
      const d = decisions.get(b.bookingId);
      return !d || (d.decision === "pay" && d.finalAmount === 0);
    }).length,
  [bookings, decisions]);

  const totalKept = useMemo(() =>
    bookings.filter(b => {
      const d = decisions.get(b.bookingId);
      return d?.decision === "pay" && d.finalAmount > 0;
    }).length,
  [bookings, decisions]);

  const payMissingReason = useMemo(() =>
    bookings.filter(b => {
      const d = decisions.get(b.bookingId) ?? { decision: "pay" as const, reason: "", customReason: "", finalAmount: 0 };
      return d.decision === "pay" && !d.reason;
    }).length,
  [bookings, decisions]);

  const BID_GRID = "2fr 1.2fr minmax(6rem,1fr) minmax(6rem,1fr) minmax(6rem,1fr) minmax(5rem,0.8fr) minmax(4rem,0.7fr) minmax(7rem,1.2fr) minmax(6rem,1fr) minmax(6rem,1fr) minmax(6.5rem,1fr) minmax(2rem,0.3fr)";
  const TID_GRID = "1.75rem 2fr minmax(6.5rem,1fr) minmax(6.5rem,1fr) minmax(6.5rem,1fr) minmax(6.5rem,1fr) minmax(6.5rem,1fr) minmax(6.5rem,1fr) minmax(6.5rem,1fr) minmax(2.5rem,0.4fr)";

  if (bookings.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        No already reconciled bookings to review.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Scrollable section content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {sections.map(section => {
          const isExpanded = expandedSections.has(section.id);
          const sectionTap = section.bookings.reduce((s, b) => {
            const d = decisions.get(b.bookingId);
            if (d?.decision === "dont_pay") return s;
            return s + (d?.finalAmount ?? 0);
          }, 0);

          return (
            <div key={section.id} className="border rounded-lg overflow-hidden">
              {/* Section header */}
              <div
                className="flex items-center gap-2 px-3 py-2 bg-muted/20 cursor-pointer hover:bg-muted/30 select-none"
                role="button"
                tabIndex={0}
                onClick={() => toggleSection(section.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSection(section.id); } }}
                aria-expanded={isExpanded}
                data-testid={`ar-ws-section-${section.id}`}
              >
                <Button variant="ghost" size="icon" className="h-5 w-5 p-0 shrink-0" tabIndex={-1} aria-hidden="true">
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </Button>
                {section.type === "same_be" ? (
                  <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 border-green-200 text-[10px] shrink-0">Same BE</Badge>
                ) : (
                  <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 border-orange-200 text-[10px] shrink-0">Diff BE</Badge>
                )}
                <span className="text-xs font-medium truncate">{section.label}</span>
                <Badge variant="secondary" className="text-[10px] shrink-0">{section.bookings.length} booking{section.bookings.length > 1 ? "s" : ""}</Badge>
                <span className="ml-auto text-xs text-muted-foreground shrink-0">
                  TAP: <span className="font-mono font-semibold">{fmt(sectionTap)} {currency}</span>
                </span>
              </div>

              {isExpanded && (
                <>
                  {/* Info banner */}
                  <div className="px-4 py-2 border-t bg-blue-50/60 dark:bg-blue-950/30">
                    <div className="flex items-start gap-1.5 text-[11px] text-blue-700 dark:text-blue-300">
                      <Info className="h-3 w-3 mt-0.5 shrink-0" />
                      {section.type === "same_be"
                        ? <span>Already paid under the same billing entity. TAP defaults to <strong>0</strong>. Override per-booking in the <strong>Final Amt</strong> column if needed.</span>
                        : <span>Previously reconciled under BE <span className="font-mono font-semibold">{section.hoBeId || "—"}</span>. TAP defaults to <strong>0</strong>. Override per-booking if needed.</span>
                      }
                    </div>
                  </div>

                  {/* TID column headers */}
                  <div
                    className="grid gap-x-4 px-3 py-1.5 bg-muted/30 border-t text-[10px] font-medium text-muted-foreground"
                    style={{ gridTemplateColumns: TID_GRID }}
                  >
                    <div />
                    <div>TID</div>
                    <div className="text-center">SP Net</div>
                    <div className="text-center">HO Net</div>
                    <div className="text-center">Difference LC</div>
                    <div className="text-center text-violet-600">Total Amount Payable</div>
                    <div className="text-center">Amount Paid</div>
                    <div className="text-center text-violet-600">Dispute</div>
                    <div className="text-center text-green-600">Balance Amt Payable</div>
                    <div className="text-center">BIDs</div>
                  </div>

                  {/* TID rows */}
                  {section.tidGroups.map(tidGroup => {
                    const tidKey = `${section.id}_${tidGroup.tid}`;
                    const isTidExpanded = expandedTids.has(tidKey);
                    const allDontPay = tidGroup.bookings.every(b => decisions.get(b.bookingId)?.decision === "dont_pay");
                    const allZeroed = !allDontPay && tidGroup.bookings.every(b => {
                      const d = decisions.get(b.bookingId);
                      return !d || (d.decision === "pay" && d.finalAmount === 0);
                    });

                    return (
                      <div key={tidKey} className="border-t">
                        {/* TID header row */}
                        <div
                          className={`grid gap-x-4 px-3 min-h-[2.75rem] items-center cursor-pointer transition-colors hover:bg-muted/30 ${isTidExpanded ? "bg-muted/20" : ""}`}
                          style={{ gridTemplateColumns: TID_GRID }}
                          onClick={() => toggleTid(tidKey)}
                          data-testid={`ar-ws-tid-${tidKey}`}
                        >
                          <div className="flex items-center">
                            {isTidExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </div>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono text-sm font-medium text-primary truncate" title={tidGroup.tid}>{tidGroup.tid}</span>
                            {allZeroed && <Badge className="text-[9px] bg-green-100 text-green-700 border-green-200 shrink-0 px-1 py-0">TAP=0</Badge>}
                            {allDontPay && <Badge variant="secondary" className="text-[9px] shrink-0 px-1 py-0">Don't Pay</Badge>}
                          </div>
                          <div className="text-center text-sm font-mono">{fmt(tidGroup.spNet)}</div>
                          <div className="text-center text-sm font-mono">{fmt(tidGroup.hoNet)}</div>
                          <div className={`text-center text-sm font-mono ${tidGroup.discLc < 0 ? "text-red-600 dark:text-red-400" : tidGroup.discLc > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
                            {fmt(tidGroup.discLc)}
                          </div>
                          {(() => {
                            const tidTap = tidGroup.bookings.reduce((s, b) => {
                              const dec = decisions.get(b.bookingId);
                              if (dec?.decision === "dont_pay") return s;
                              return s + (dec?.finalAmount ?? 0);
                            }, 0);
                            const tidAmtPaid = tidGroup.bookings.reduce((s, b) => s + (b.amountPaid || 0), 0);
                            const tidDispute = tidGroup.bookings.reduce((s, b) => {
                              if (activeDisputes.has(b.bookingId)) return s + (disputeAmounts.get(b.bookingId) || 0);
                              return s;
                            }, 0);
                            const tidBalance = tidTap - tidAmtPaid;
                            return (
                              <>
                                <div className="text-center text-sm font-mono font-semibold text-violet-600">{fmt(tidTap)}</div>
                                <div className="text-center text-sm font-mono text-muted-foreground">{fmt(tidAmtPaid)}</div>
                                <div className={`text-center text-sm font-mono ${tidDispute > 0 ? "text-amber-600" : "text-muted-foreground"}`}>{fmt(tidDispute)}</div>
                                <div className={`text-center text-sm font-mono font-semibold ${tidBalance > 0 ? "text-green-600" : tidBalance < 0 ? "text-red-600" : ""}`}>{fmt(tidBalance)}</div>
                              </>
                            );
                          })()}
                          <div className="text-center text-sm font-mono">{tidGroup.bookings.length}</div>
                        </div>

                        {/* TID action strip (NPD-style) */}
                        {isTidExpanded && (
                          <div className="flex items-center gap-2 p-2 mx-3 mb-2 mt-1 rounded-md bg-primary/5 border border-primary/10 flex-wrap">
                            <Button size="sm" className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setSpNetAllInTid(tidGroup)} data-testid={`ar-ws-set-spnet-tid-${tidKey}`}>
                              <TrendingUp className="h-3.5 w-3.5" /> Set SP Net
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-green-700 border-green-300 hover:bg-green-50" onClick={() => setHoNetAllInTid(tidGroup)} data-testid={`ar-ws-set-honet-tid-${tidKey}`}>
                              <TrendingDown className="h-3.5 w-3.5" /> Set HO Net
                            </Button>
                            <div className="flex-1" />
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => disputeAllInTid(tidGroup)} data-testid={`ar-ws-dispute-tid-${tidKey}`}>
                              <Gavel className="h-3.5 w-3.5" /> Dispute
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-orange-700 border-orange-300 hover:bg-orange-50" disabled={issueMutation.isPending || !runId} onClick={() => issueForTid(tidGroup, section.label)} data-testid={`ar-ws-issue-tid-${tidKey}`}>
                              <FileWarning className="h-3.5 w-3.5" /> Issue
                            </Button>
                          </div>
                        )}

                        {/* BID detail rows */}
                        {isTidExpanded && (
                          <div className="border-t bg-muted/5">
                            {/* BID header */}
                            <div
                              className="grid gap-x-4 pl-8 pr-3 py-1 bg-muted/20 text-[10px] font-medium text-muted-foreground"
                              style={{ gridTemplateColumns: BID_GRID }}
                            >
                              <div>Booking ID</div>
                              <div className="text-center">Ticket ID</div>
                              <div className="text-center text-blue-600">SP Net</div>
                              <div className="text-center text-green-600">HO Net</div>
                              <div className="text-center text-red-600">Diff LC</div>
                              <div className="text-center">Decision</div>
                              <div className="text-center">Reason</div>
                              <div className="text-center text-violet-600">Total Amount Payable</div>
                              <div className="text-center">Amount Paid</div>
                              <div className="text-center text-amber-600">Dispute Amt</div>
                              <div className="text-center text-green-600">Balance Amt Payable</div>
                              <div />
                            </div>

                            {/* BID rows */}
                            {tidGroup.bookings.map(booking => {
                              const d = getDecision(booking.bookingId);
                              const isDisputeActive = activeDisputes.has(booking.bookingId);
                              const disputeAmt = disputeAmounts.get(booking.bookingId) || 0;
                              const isDontPay = d.decision === "dont_pay";
                              const isPay = d.decision === "pay";
                              const isCustomReason = d.reason && !REASON_VALUES.has(d.reason);
                              const hasMismatch = hasPaymentMismatchFn?.(booking) ?? false;

                              return (
                                <div key={booking.bookingId} className={isDontPay ? "opacity-50" : ""}>
                                  <div
                                    className={`grid gap-x-4 pl-8 pr-3 min-h-[2.25rem] border-t items-center text-xs ${isDisputeActive ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}`}
                                    style={{ gridTemplateColumns: BID_GRID }}
                                    data-testid={`ar-ws-bid-${booking.bookingId}`}
                                  >
                                    {/* Booking ID */}
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1">
                                        <span className="font-mono text-primary font-medium truncate" title={booking.bookingId}>{booking.bookingId}</span>
                                        {isDisputeActive && <Badge className="text-[9px] px-1 py-0 bg-amber-100 text-amber-700 border-amber-200">Disputed</Badge>}
                                      </div>
                                    </div>
                                    {/* Ticket ID */}
                                    <div className="text-center font-mono text-muted-foreground truncate" title={booking.ticketId || ""}>
                                      {booking.ticketId || "—"}
                                    </div>
                                    {/* SP Net */}
                                    <div className="text-center font-mono text-blue-600" data-testid={`booking-sp-${booking.bookingId}`}>{fmt(booking.spNet)}</div>
                                    {/* HO Net */}
                                    <div className="text-center font-mono text-green-600" data-testid={`booking-ho-${booking.bookingId}`}>{fmt(booking.hoNet)}</div>
                                    {/* Diff LC */}
                                    <div className="text-center font-mono text-red-600 dark:text-red-400" data-testid={`booking-diff-${booking.bookingId}`}>
                                      {fmt(Math.round((booking.hoNet - booking.spNet) * 100) / 100)}
                                    </div>
                                    {/* Decision */}
                                    <div className="text-center">
                                      <Select
                                        value={d.decision}
                                        onValueChange={(v: "pay" | "dont_pay") => setDecision(booking.bookingId, { decision: v })}
                                      >
                                        <SelectTrigger
                                          className={`h-7 text-[10px] px-1 w-full font-medium ${
                                            isDontPay
                                              ? "border-red-200 bg-red-50/60 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400"
                                              : "border-green-200 bg-green-50/60 text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400"
                                          }`}
                                          data-testid={`ar-ws-decision-${booking.bookingId}`}
                                        >
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="pay">Pay</SelectItem>
                                          <SelectItem value="dont_pay">Don't Pay</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    {/* Reason */}
                                    {(() => {
                                      const isReasonMissing = isPay && !d.reason;
                                      return (
                                        <div>
                                          {(isCustomReason || d.customReason === "__other__") ? (
                                            <div className="flex items-center gap-0.5">
                                              <Input
                                                className={`h-7 text-[10px] px-1 flex-1 ${isReasonMissing ? "border-red-400 dark:border-red-600" : ""}`}
                                                placeholder="Type reason..."
                                                value={isCustomReason ? d.reason : ""}
                                                onChange={e => setDecision(booking.bookingId, { reason: e.target.value, customReason: e.target.value })}
                                                data-testid={`ar-ws-custom-reason-${booking.bookingId}`}
                                                autoFocus={d.customReason === "__other__" && !d.reason}
                                              />
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                                                onClick={() => setDecision(booking.bookingId, { reason: "", customReason: "" })}
                                                aria-label="Clear custom reason"
                                              >
                                                <XIcon className="h-3 w-3" />
                                              </Button>
                                            </div>
                                          ) : (
                                            <Select
                                              value={d.reason || "none"}
                                              onValueChange={(v) => {
                                                if (v === "none") {
                                                  setDecision(booking.bookingId, { reason: "", customReason: "" });
                                                } else if (v === "__other__") {
                                                  setDecision(booking.bookingId, { reason: "", customReason: "__other__" });
                                                } else {
                                                  setDecision(booking.bookingId, { reason: v, customReason: "" });
                                                }
                                              }}
                                            >
                                              <SelectTrigger
                                                className={`h-7 text-[10px] px-1 w-full ${isReasonMissing ? "border-red-400 dark:border-red-600" : ""}`}
                                                data-testid={`ar-ws-reason-${booking.bookingId}`}
                                              >
                                                <SelectValue placeholder="—" />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="none">—</SelectItem>
                                                {REASON_OPTIONS.map(o => (
                                                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                                ))}
                                                <SelectItem value="__other__">Other…</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          )}
                                        </div>
                                      );
                                    })()}
                                    {/* Total Amount Payable */}
                                    {(() => {
                                      const tap = isPay ? d.finalAmount : 0;
                                      const bookingAmountPaid = booking.amountPaid || 0;
                                      const balanceAmountPayable = tap - bookingAmountPaid;
                                      return (
                                        <>
                                          <div className="text-center">
                                            {isPay ? (
                                              <Input
                                                type="number"
                                                step="0.01"
                                                className={`h-7 text-[10px] px-1 text-right font-mono w-full ${
                                                  d.finalAmount > 0
                                                    ? "border-violet-300 bg-violet-50/40 font-semibold text-violet-700 dark:border-violet-700 dark:bg-violet-950/20 dark:text-violet-400"
                                                    : "border-muted"
                                                }`}
                                                value={d.finalAmount}
                                                onChange={e => setDecision(booking.bookingId, { finalAmount: Math.round((parseFloat(e.target.value) || 0) * 100) / 100 })}
                                                data-testid={`ar-ws-final-amount-${booking.bookingId}`}
                                              />
                                            ) : (
                                              <span className="text-muted-foreground text-xs italic">—</span>
                                            )}
                                          </div>
                                          {/* Amount Paid */}
                                          <div className="text-center font-mono text-muted-foreground" data-testid={`ar-ws-amtpaid-${booking.bookingId}`}>
                                            {fmt(bookingAmountPaid)}
                                          </div>
                                          {/* Dispute Amt */}
                                          <div className="text-center">
                                            {isDisputeActive ? (
                                              <div className="flex items-center gap-0.5">
                                                <Input
                                                  type="number"
                                                  step="0.01"
                                                  className="h-7 text-[10px] px-1 w-full text-right font-mono border-amber-300 dark:border-amber-700"
                                                  value={disputeAmt || ""}
                                                  onChange={e => {
                                                    const val = Math.round((parseFloat(e.target.value) || 0) * 100) / 100;
                                                    const newAmounts = new Map(disputeAmounts);
                                                    newAmounts.set(booking.bookingId, val);
                                                    onDisputeChange(new Set(activeDisputes), newAmounts);
                                                  }}
                                                  data-testid={`ar-ws-dispute-amount-${booking.bookingId}`}
                                                />
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className="h-5 w-5 text-amber-600 hover:text-amber-800 hover:bg-amber-100 shrink-0"
                                                  aria-label="Remove dispute"
                                                  onClick={() => {
                                                    const newActive = new Set(activeDisputes);
                                                    newActive.delete(booking.bookingId);
                                                    const newAmounts = new Map(disputeAmounts);
                                                    newAmounts.delete(booking.bookingId);
                                                    onDisputeChange(newActive, newAmounts);
                                                  }}
                                                >
                                                  <XIcon className="h-3 w-3" />
                                                </Button>
                                              </div>
                                            ) : (
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-[10px] px-1 text-amber-700 hover:bg-amber-50 dark:text-amber-400"
                                                onClick={() => {
                                                  const newActive = new Set(activeDisputes);
                                                  newActive.add(booking.bookingId);
                                                  const newAmounts = new Map(disputeAmounts);
                                                  newAmounts.set(booking.bookingId, Math.round(Math.abs(booking.spNet - booking.hoNet) * 100) / 100);
                                                  onDisputeChange(newActive, newAmounts);
                                                }}
                                                data-testid={`ar-ws-dispute-btn-${booking.bookingId}`}
                                              >
                                                <Gavel className="h-3 w-3" /> Dispute
                                              </Button>
                                            )}
                                          </div>
                                          {/* Balance Amt Payable */}
                                          <div className={`text-center font-mono font-semibold ${balanceAmountPayable > 0 ? "text-green-600" : balanceAmountPayable < 0 ? "text-red-600" : "text-muted-foreground"}`} data-testid={`ar-ws-balance-${booking.bookingId}`}>
                                            {fmt(balanceAmountPayable)}
                                          </div>
                                          {/* Save */}
                                          {(() => {
                                            const isReasonMissingForSave = isPay && !d.reason;
                                            return (
                                              <div className="text-center">
                                                <Tooltip>
                                                  <TooltipTrigger asChild>
                                                    <Button
                                                      variant="ghost"
                                                      size="icon"
                                                      className={`h-6 w-6 ${isReasonMissingForSave ? "text-amber-500 hover:text-amber-700 hover:bg-amber-50" : "text-green-600 hover:text-green-800 hover:bg-green-50"}`}
                                                      onClick={() => setFeedback(`Saved booking ${booking.bookingId}`)}
                                                      aria-label={`Save booking ${booking.bookingId}`}
                                                      data-testid={`ar-ws-save-${booking.bookingId}`}
                                                    >
                                                      {isReasonMissingForSave ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                                    </Button>
                                                  </TooltipTrigger>
                                                  {isReasonMissingForSave && (
                                                    <TooltipContent side="left" className="text-xs">
                                                      Reason required before saving
                                                    </TooltipContent>
                                                  )}
                                                </Tooltip>
                                              </div>
                                            );
                                          })()}
                                        </>
                                      );
                                    })()}
                                  </div>

                                  {/* Vendor ID mismatch row */}
                                  {hasMismatch && (
                                    <div className="flex items-center gap-2 pl-8 pr-3 py-1 border-t bg-violet-50/50 dark:bg-violet-950/20">
                                      <Badge variant="outline" className="text-[10px] border-violet-300 text-violet-700 dark:text-violet-300 shrink-0">
                                        {booking.paymentMethod} → {dominantPaymentMethod}
                                      </Badge>
                                      <span className="text-[10px] text-muted-foreground shrink-0">Final Vendor ID:</span>
                                      <Input
                                        className="h-5 text-[10px] font-mono w-28 px-1"
                                        placeholder="Vendor ID"
                                        value={finalVendorIds?.get(booking.bookingId) || ""}
                                        onChange={e => onVendorIdChange?.(booking.bookingId, e.target.value)}
                                        onBlur={() => {
                                          const val = finalVendorIds?.get(booking.bookingId) || "";
                                          onVendorIdSave?.(booking.bookingId, val);
                                        }}
                                        onKeyDown={e => {
                                          if (e.key === "Enter") {
                                            const val = finalVendorIds?.get(booking.bookingId) || "";
                                            onVendorIdSave?.(booking.bookingId, val);
                                          }
                                        }}
                                        data-testid={`ar-ws-vendor-id-${booking.bookingId}`}
                                      />
                                      {finalVendorIds?.has(booking.bookingId) && finalVendorIds.get(booking.bookingId)!.trim() && (
                                        <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary bar */}
      {(() => {
        const totalAmtPaid = bookings.reduce((s, b) => s + (b.amountPaid || 0), 0);
        const totalDisputeAmt = bookings.reduce((s, b) => {
          if (activeDisputes.has(b.bookingId)) return s + (disputeAmounts.get(b.bookingId) || 0);
          return s;
        }, 0);
        const totalBalance = totalTap - totalAmtPaid;
        return (
          <div className="flex items-center gap-4 px-4 py-2.5 border-t bg-muted/20 text-xs shrink-0 flex-wrap">
            <span className="text-muted-foreground">Summary:</span>
            <span>
              <span className="font-semibold text-green-600 dark:text-green-400">{totalZeroed}</span>{" "}zeroed out
            </span>
            <span>
              <span className="font-semibold text-amber-600 dark:text-amber-400">{totalKept}</span>{" "}kept payable
            </span>
            {feedback && (
              <span className="text-blue-600 dark:text-blue-400 truncate">{feedback}</span>
            )}
            <div className="ml-auto flex items-center gap-4 shrink-0">
              <span>TAP: <span className="font-mono font-semibold text-violet-600">{fmt(totalTap)}</span></span>
              <span>Paid: <span className="font-mono font-semibold">{fmt(totalAmtPaid)}</span></span>
              <span>Dispute: <span className="font-mono font-semibold text-amber-600">{fmt(totalDisputeAmt)}</span></span>
              <span>Balance: <span className={`font-mono font-semibold ${totalBalance > 0 ? "text-green-600" : totalBalance < 0 ? "text-red-600" : ""}`}>{fmt(totalBalance)} {currency}</span></span>
            </div>
            {showApplyConfirm && onClose && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0">
                    <Button
                      size="sm"
                      className="h-7 text-xs px-3"
                      onClick={onClose}
                      disabled={payMissingReason > 0}
                      data-testid="ar-ws-apply-confirm"
                    >
                      Apply &amp; Confirm
                    </Button>
                  </span>
                </TooltipTrigger>
                {payMissingReason > 0 && (
                  <TooltipContent side="top" className="text-xs">
                    {payMissingReason} Pay booking{payMissingReason > 1 ? "s" : ""} missing a reason
                  </TooltipContent>
                )}
              </Tooltip>
            )}
          </div>
        );
      })()}
    </div>
  );
}
