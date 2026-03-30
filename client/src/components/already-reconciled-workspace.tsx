import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Info, ChevronRight, ChevronDown, CheckCircle2, Gavel, Zap,
  X as XIcon, FileWarning,
} from "lucide-react";

const fmt = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface ArWorkspaceBooking {
  bookingId: string;
  tid?: string;
  reason: string;
  hoNet: number;
  spNet: number;
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
    discLc: tBks.reduce((s, b) => s + (b.spNet - b.hoNet), 0),
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
        errorBucket: "Already Reconciled-Same BE",
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

  const zeroAllInTid = useCallback((tidGroup: ArTidGroup) => {
    const newDecisions = new Map(decisions);
    for (const b of tidGroup.bookings) {
      const current = newDecisions.get(b.bookingId) ?? { decision: "pay" as const, reason: "", customReason: "", finalAmount: 0 };
      newDecisions.set(b.bookingId, { ...current, decision: "pay", finalAmount: 0 });
    }
    onDecisionChange(newDecisions);
    setFeedback(`TAP set to 0 for TID ${tidGroup.tid} (${tidGroup.bookings.length} booking${tidGroup.bookings.length > 1 ? "s" : ""})`);
  }, [decisions, onDecisionChange]);

  const dontPayAllInTid = useCallback((tidGroup: ArTidGroup) => {
    const newDecisions = new Map(decisions);
    for (const b of tidGroup.bookings) {
      const current = newDecisions.get(b.bookingId) ?? { decision: "dont_pay" as const, reason: "", customReason: "", finalAmount: 0 };
      newDecisions.set(b.bookingId, { ...current, decision: "dont_pay" });
    }
    onDecisionChange(newDecisions);
    setFeedback(`All ${tidGroup.bookings.length} booking${tidGroup.bookings.length > 1 ? "s" : ""} in TID ${tidGroup.tid} set to Don't Pay`);
  }, [decisions, onDecisionChange]);

  const disputeAllInTid = useCallback((tidGroup: ArTidGroup) => {
    const newActive = new Set(activeDisputes);
    const newAmounts = new Map(disputeAmounts);
    for (const b of tidGroup.bookings) {
      newActive.add(b.bookingId);
      if (!newAmounts.has(b.bookingId)) {
        newAmounts.set(b.bookingId, Math.abs(b.spNet - b.hoNet));
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

  const BID_GRID = "2fr minmax(5rem,0.8fr) minmax(5.5rem,0.9fr) minmax(5.5rem,0.9fr) minmax(5rem,0.7fr) minmax(9rem,1.4fr) minmax(7.5rem,1.2fr) minmax(6.5rem,1fr)";
  const TID_GRID = "1.5rem 1fr minmax(3.5rem,0.5fr) minmax(5.5rem,0.9fr) minmax(5.5rem,0.9fr) minmax(5.5rem,0.9fr) minmax(8rem,auto)";

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
                onClick={() => toggleSection(section.id)}
                data-testid={`ar-ws-section-${section.id}`}
              >
                <Button variant="ghost" size="icon" className="h-5 w-5 p-0 shrink-0" tabIndex={-1}>
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
                {/* Issue action */}
                <div onClick={e => e.stopPropagation()}>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          disabled={issueMutation.isPending || !runId}
                          onClick={() => issueMutation.mutate({ bookingIds: section.bookings.map(b => b.bookingId), sectionLabel: section.label })}
                          data-testid={`ar-ws-issue-section-${section.id}`}
                        >
                          <FileWarning className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p>Log issue for this group</p></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
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
                    className="grid gap-2 px-3 py-1.5 bg-muted/30 border-t text-[10px] font-medium text-muted-foreground"
                    style={{ gridTemplateColumns: TID_GRID }}
                  >
                    <div />
                    <div>TID</div>
                    <div className="text-right">BIDs</div>
                    <div className="text-right">SP Net</div>
                    <div className="text-right">HO Net</div>
                    <div className="text-right">Disc LC</div>
                    <div className="text-right">Actions</div>
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
                          className="grid gap-2 px-3 py-1.5 items-center hover:bg-muted/20 cursor-pointer"
                          style={{ gridTemplateColumns: TID_GRID }}
                          onClick={() => toggleTid(tidKey)}
                          data-testid={`ar-ws-tid-${tidKey}`}
                        >
                          <Button variant="ghost" size="icon" className="h-5 w-5 p-0" tabIndex={-1}>
                            {isTidExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </Button>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono text-xs font-medium truncate" title={tidGroup.tid}>{tidGroup.tid}</span>
                            {allZeroed && <Badge className="text-[9px] bg-green-100 text-green-700 border-green-200 shrink-0 px-1 py-0">TAP=0</Badge>}
                            {allDontPay && <Badge variant="secondary" className="text-[9px] shrink-0 px-1 py-0">Don't Pay</Badge>}
                          </div>
                          <div className="text-right text-xs font-mono">{tidGroup.bookings.length}</div>
                          <div className="text-right text-xs font-mono">{fmt(tidGroup.spNet)}</div>
                          <div className="text-right text-xs font-mono">{fmt(tidGroup.hoNet)}</div>
                          <div className={`text-right text-xs font-mono ${tidGroup.discLc < 0 ? "text-red-600 dark:text-red-400" : tidGroup.discLc > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
                            {fmt(tidGroup.discLc)}
                          </div>
                          {/* TID action strip */}
                          <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-[10px] gap-1"
                                    onClick={() => zeroAllInTid(tidGroup)}
                                    data-testid={`ar-ws-zero-tid-${tidKey}`}
                                  >
                                    <Zap className="h-3 w-3" />
                                    Zero
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Set TAP=0 for all bookings in this TID</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-[10px] gap-1"
                                    onClick={() => dontPayAllInTid(tidGroup)}
                                    data-testid={`ar-ws-dontpay-tid-${tidKey}`}
                                  >
                                    <XIcon className="h-3 w-3" />
                                    Skip
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Set Don't Pay for all bookings in this TID</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-[10px] gap-1"
                                    onClick={() => disputeAllInTid(tidGroup)}
                                    data-testid={`ar-ws-dispute-tid-${tidKey}`}
                                  >
                                    <Gavel className="h-3 w-3" />
                                    Dispute
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Open dispute for all bookings in this TID</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </div>

                        {/* BID detail rows */}
                        {isTidExpanded && (
                          <div className="border-t bg-muted/5">
                            {/* BID header */}
                            <div
                              className="grid gap-2 pl-8 pr-3 py-1 bg-muted/20 text-[10px] font-medium text-muted-foreground"
                              style={{ gridTemplateColumns: BID_GRID }}
                            >
                              <div>Booking ID</div>
                              <div>Ticket ID</div>
                              <div className="text-right">SP Net</div>
                              <div className="text-right">HO Net</div>
                              <div>Decision</div>
                              <div>Reason</div>
                              <div>Dispute</div>
                              <div className="text-right">Final Amt</div>
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
                                    className="grid gap-2 pl-8 pr-3 py-1 border-t items-center text-xs"
                                    style={{ gridTemplateColumns: BID_GRID }}
                                    data-testid={`ar-ws-bid-${booking.bookingId}`}
                                  >
                                    {/* Booking ID */}
                                    <div className="font-mono text-[11px] truncate" title={booking.bookingId}>
                                      {booking.bookingId}
                                    </div>
                                    {/* Ticket ID */}
                                    <div className="font-mono text-[10px] text-muted-foreground truncate" title={booking.ticketId || ""}>
                                      {booking.ticketId || "—"}
                                    </div>
                                    {/* SP Net */}
                                    <div className="text-right font-mono">{fmt(booking.spNet)}</div>
                                    {/* HO Net */}
                                    <div className="text-right font-mono">{fmt(booking.hoNet)}</div>
                                    {/* Decision */}
                                    <div>
                                      <Select
                                        value={d.decision}
                                        onValueChange={(v: "pay" | "dont_pay") => setDecision(booking.bookingId, { decision: v })}
                                      >
                                        <SelectTrigger className="h-6 text-[10px] px-1" data-testid={`ar-ws-decision-${booking.bookingId}`}>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="pay">Pay</SelectItem>
                                          <SelectItem value="dont_pay">Don't Pay</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    {/* Reason */}
                                    <div className="flex gap-0.5">
                                      <Select
                                        value={isCustomReason ? "" : (d.reason || "")}
                                        onValueChange={(v) => setDecision(booking.bookingId, { reason: v === "none" ? "" : v, customReason: "" })}
                                      >
                                        <SelectTrigger className="h-6 text-[10px] px-1 flex-1" data-testid={`ar-ws-reason-${booking.bookingId}`}>
                                          <SelectValue placeholder="—" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="none">—</SelectItem>
                                          {REASON_OPTIONS.map(o => (
                                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      {isCustomReason && (
                                        <Input
                                          className="h-6 text-[10px] px-1 w-16"
                                          placeholder="Other..."
                                          value={d.reason}
                                          onChange={e => setDecision(booking.bookingId, { reason: e.target.value, customReason: e.target.value })}
                                          data-testid={`ar-ws-custom-reason-${booking.bookingId}`}
                                        />
                                      )}
                                    </div>
                                    {/* Dispute */}
                                    <div>
                                      {isDisputeActive ? (
                                        <div className="flex items-center gap-0.5">
                                          <Input
                                            type="number"
                                            step="0.01"
                                            className="h-6 text-[10px] px-1 w-16 text-right font-mono"
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
                                            className="h-5 w-5"
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
                                          variant="outline"
                                          size="sm"
                                          className="h-6 text-[10px] px-2"
                                          onClick={() => {
                                            const newActive = new Set(activeDisputes);
                                            newActive.add(booking.bookingId);
                                            const newAmounts = new Map(disputeAmounts);
                                            newAmounts.set(booking.bookingId, Math.abs(booking.spNet - booking.hoNet));
                                            onDisputeChange(newActive, newAmounts);
                                          }}
                                          data-testid={`ar-ws-dispute-btn-${booking.bookingId}`}
                                        >
                                          Dispute
                                        </Button>
                                      )}
                                    </div>
                                    {/* Final Amount */}
                                    <div>
                                      {isPay ? (
                                        <Input
                                          type="number"
                                          step="0.01"
                                          className="h-6 text-[10px] px-1 text-right font-mono"
                                          value={d.finalAmount}
                                          onChange={e => setDecision(booking.bookingId, { finalAmount: Math.round((parseFloat(e.target.value) || 0) * 100) / 100 })}
                                          data-testid={`ar-ws-final-amount-${booking.bookingId}`}
                                        />
                                      ) : (
                                        <span className="text-muted-foreground text-[10px]">—</span>
                                      )}
                                    </div>
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
      <div className="flex items-center gap-3 px-4 py-2.5 border-t bg-muted/20 text-xs shrink-0">
        <span className="text-muted-foreground">Summary:</span>
        <span>
          <span className="font-semibold text-green-600 dark:text-green-400">{totalZeroed}</span>{" "}
          zeroed out
        </span>
        <span>
          <span className="font-semibold text-amber-600 dark:text-amber-400">{totalKept}</span>{" "}
          kept payable
        </span>
        {feedback && (
          <span className="text-blue-600 dark:text-blue-400 truncate">{feedback}</span>
        )}
        <span className="ml-auto shrink-0">
          Net TAP:{" "}
          <span className="font-mono font-semibold">
            {fmt(totalTap)} {currency}
          </span>
        </span>
        {showApplyConfirm && onClose && (
          <Button
            size="sm"
            className="h-7 text-xs px-3 shrink-0"
            onClick={onClose}
            data-testid="ar-ws-apply-confirm"
          >
            Apply &amp; Confirm
          </Button>
        )}
      </div>
    </div>
  );
}
