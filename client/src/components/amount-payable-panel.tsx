import { useState, useCallback, useMemo, useEffect } from "react";
import { Plus, Trash2, Calculator, ChevronDown, ChevronRight, AlertTriangle, Check, X, Eye } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  Adjustment, 
  BookingForPayable, 
  FinalNetSelection,
  PRESET_ADJUSTMENT_NATURES,
  createPresetAdjustments 
} from "./amount-payable-modal";
import type { PrimaryRow } from "@shared/schema";

interface AmountPayablePanelProps {
  bookings: BookingForPayable[];
  currency: string;
  adjustments: Adjustment[];
  finalNetSelections: FinalNetSelection;
  onApply: (adjustments: Adjustment[], selections: FinalNetSelection, finalAmount: number) => void;
  onClose: () => void;
  runId?: string | null;
  allRows?: PrimaryRow[];
}

export function AmountPayablePanel({
  bookings,
  currency,
  adjustments,
  finalNetSelections,
  onApply,
  onClose,
  runId,
  allRows = [],
}: AmountPayablePanelProps) {
  const [localAdjustments, setLocalAdjustments] = useState<Adjustment[]>(adjustments);
  const [localSelections, setLocalSelections] = useState<FinalNetSelection>(finalNetSelections);
  const [expandedReasons, setExpandedReasons] = useState<Set<string>>(new Set());
  const [expandedTids, setExpandedTids] = useState<Set<string>>(new Set());
  const [disputeAmounts, setDisputeAmounts] = useState<Map<string, number>>(new Map());
  const [activeDisputes, setActiveDisputes] = useState<Set<string>>(new Set());
  const [originalDisputes, setOriginalDisputes] = useState<Map<string, number>>(new Map());
  const [disputesLoaded, setDisputesLoaded] = useState(false);
  const [openDisputes, setOpenDisputes] = useState<Array<{ 
    displayId: string; 
    billingEntityId: string;
    billingEntityName: string;
    totalDisputeAmount: number; 
    bookingCount: number;
  }>>([]);
  const [validationError, setValidationError] = useState<string>("");
  const [selectedReasonModal, setSelectedReasonModal] = useState<string | null>(null);

  useEffect(() => {
    const presets = createPresetAdjustments();
    const customAdjustments = adjustments.filter(a => !a.isPreset);
    setLocalAdjustments([...presets, ...customAdjustments]);
    setLocalSelections(finalNetSelections);
    
    if (runId && !disputesLoaded) {
      fetch(`/api/disputes/${runId}`)
        .then(res => res.json())
        .then(data => {
          const disputes = data.disputes || [];
          const newDisputeAmounts = new Map<string, number>();
          const newActiveDisputes = new Set<string>();
          
          for (const dispute of disputes) {
            newDisputeAmounts.set(dispute.bookingId, dispute.disputeAmount);
            newActiveDisputes.add(dispute.bookingId);
          }
          
          setDisputeAmounts(newDisputeAmounts);
          setActiveDisputes(newActiveDisputes);
          setOriginalDisputes(new Map(newDisputeAmounts));
          
          const groupedByBillingEntity = new Map<string, Array<{ billingEntityId: string; billingEntityName: string; disputeAmount: number }>>();
          for (const dispute of disputes) {
            const key = `${dispute.billingEntityId}-${dispute.currency}`;
            if (!groupedByBillingEntity.has(key)) {
              groupedByBillingEntity.set(key, []);
            }
            groupedByBillingEntity.get(key)!.push({
              billingEntityId: dispute.billingEntityId,
              billingEntityName: dispute.billingEntityName,
              disputeAmount: dispute.disputeAmount,
            });
          }
          
          const aggregatedDisputes: Array<{ displayId: string; billingEntityId: string; billingEntityName: string; totalDisputeAmount: number; bookingCount: number }> = [];
          let counter = 1;
          for (const group of Array.from(groupedByBillingEntity.values())) {
            if (group.length === 0) continue;
            const first = group[0];
            const totalAmount = group.reduce((sum, d) => sum + d.disputeAmount, 0);
            const roundedTotal = Math.round(totalAmount * 100) / 100;
            aggregatedDisputes.push({
              displayId: `DID-#${counter}`,
              billingEntityId: first.billingEntityId,
              billingEntityName: first.billingEntityName,
              totalDisputeAmount: roundedTotal,
              bookingCount: group.length,
            });
            counter++;
          }
          setOpenDisputes(aggregatedDisputes);
          setDisputesLoaded(true);
        })
        .catch(err => {
          console.error("Failed to load existing disputes:", err);
          setDisputeAmounts(new Map());
          setActiveDisputes(new Set());
          setOriginalDisputes(new Map());
          setDisputesLoaded(true);
        });
    }
  }, [runId, disputesLoaded, adjustments, finalNetSelections]);

  const reconciledBookings = useMemo(() => 
    (bookings || []).filter(b => b.reason === "Reconciled"), 
    [bookings]
  );

  const discrepancyBookings = useMemo(() => 
    (bookings || []).filter(b => b.reason !== "Reconciled"), 
    [bookings]
  );

  const reconciledTotal = useMemo(() => 
    reconciledBookings.reduce((sum, b) => sum + b.spNet, 0), 
    [reconciledBookings]
  );

  const bookingsByReason = useMemo(() => {
    const grouped: Record<string, BookingForPayable[]> = {};
    for (const booking of discrepancyBookings) {
      if (!grouped[booking.reason]) {
        grouped[booking.reason] = [];
      }
      grouped[booking.reason].push(booking);
    }
    return grouped;
  }, [discrepancyBookings]);

  const bookingsByReasonAndTid = useMemo(() => {
    const result: Record<string, Record<string, BookingForPayable[]>> = {};
    for (const booking of discrepancyBookings) {
      if (!result[booking.reason]) {
        result[booking.reason] = {};
      }
      const tid = booking.tid || booking.bookingId;
      if (!result[booking.reason][tid]) {
        result[booking.reason][tid] = [];
      }
      result[booking.reason][tid].push(booking);
    }
    return result;
  }, [discrepancyBookings]);

  const billingEntityInfo = useMemo(() => {
    const firstBooking = bookings?.[0];
    return {
      beId: firstBooking?.beId || "",
      billingEntityName: firstBooking?.billingEntityName || "",
      ticketId: firstBooking?.ticketId || "",
      paymentBasis: firstBooking?.paymentBasis || "",
    };
  }, [bookings]);

  const getFinalNetPrice = useCallback((booking: BookingForPayable): number => {
    if (booking.reason === "Reconciled" || booking.reason === "Unmapped") {
      return booking.spNet;
    }
    const selection = localSelections[booking.bookingId] || "sp";
    return selection === "ho" ? booking.hoNet : booking.spNet;
  }, [localSelections]);

  const getReasonTotal = useCallback((reason: string): number => {
    const reasonBookings = bookingsByReason[reason] || [];
    return reasonBookings.reduce((sum, b) => sum + getFinalNetPrice(b), 0);
  }, [bookingsByReason, getFinalNetPrice]);

  const discrepancyTotal = useMemo(() => 
    discrepancyBookings.reduce((sum, b) => sum + getFinalNetPrice(b), 0),
    [discrepancyBookings, getFinalNetPrice]
  );

  const baseAmount = reconciledTotal + discrepancyTotal;

  const finalAmount = useMemo(() => {
    const result = localAdjustments.reduce((total, adj) => {
      if (adj.type === "add") {
        return total + adj.amount;
      } else {
        return total - adj.amount;
      }
    }, baseAmount);
    return Math.round(result * 100) / 100;
  }, [baseAmount, localAdjustments]);

  const updateSelection = useCallback((bookingId: string, value: "ho" | "sp", booking?: BookingForPayable) => {
    setLocalSelections(prev => ({ ...prev, [bookingId]: value }));
    if (value === "ho") {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        newSet.delete(bookingId);
        return newSet;
      });
      setDisputeAmounts(prev => {
        const newMap = new Map(prev);
        newMap.delete(bookingId);
        return newMap;
      });
    }
  }, []);

  const updateReasonSelection = useCallback((reason: string, value: "ho" | "sp") => {
    const reasonBookings = bookingsByReason[reason] || [];
    setLocalSelections(prev => {
      const newSelections = { ...prev };
      for (const b of reasonBookings) {
        newSelections[b.bookingId] = value;
      }
      return newSelections;
    });
    if (value === "ho") {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        for (const b of reasonBookings) {
          newSet.delete(b.bookingId);
        }
        return newSet;
      });
      setDisputeAmounts(prev => {
        const newMap = new Map(prev);
        for (const b of reasonBookings) {
          newMap.delete(b.bookingId);
        }
        return newMap;
      });
    }
  }, [bookingsByReason]);

  const updateTidSelection = useCallback((reason: string, tid: string, value: "ho" | "sp") => {
    const tidBookings = bookingsByReasonAndTid[reason]?.[tid] || [];
    setLocalSelections(prev => {
      const newSelections = { ...prev };
      for (const b of tidBookings) {
        newSelections[b.bookingId] = value;
      }
      return newSelections;
    });
    if (value === "ho") {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        for (const b of tidBookings) {
          newSet.delete(b.bookingId);
        }
        return newSet;
      });
      setDisputeAmounts(prev => {
        const newMap = new Map(prev);
        for (const b of tidBookings) {
          newMap.delete(b.bookingId);
        }
        return newMap;
      });
    }
  }, [bookingsByReasonAndTid]);

  const toggleReason = useCallback((reason: string) => {
    setExpandedReasons(prev => {
      const newSet = new Set(prev);
      if (newSet.has(reason)) {
        newSet.delete(reason);
      } else {
        newSet.add(reason);
      }
      return newSet;
    });
  }, []);

  const toggleTid = useCallback((tidKey: string) => {
    setExpandedTids(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tidKey)) {
        newSet.delete(tidKey);
      } else {
        newSet.add(tidKey);
      }
      return newSet;
    });
  }, []);

  const isBookingDisputable = useCallback((booking: BookingForPayable): boolean => {
    if (booking.reason === "Unmapped") return true;
    const selection = localSelections[booking.bookingId] || "sp";
    return selection === "sp";
  }, [localSelections]);

  const getMaxDisputeAmount = useCallback((booking: BookingForPayable): number => {
    const finalNet = getFinalNetPrice(booking);
    return Math.abs(booking.hoNet - finalNet);
  }, [getFinalNetPrice]);

  const toggleDispute = useCallback((bookingId: string, booking: BookingForPayable) => {
    if (!isBookingDisputable(booking)) return;
    
    setActiveDisputes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(bookingId)) {
        newSet.delete(bookingId);
      } else {
        newSet.add(bookingId);
        if (!disputeAmounts.has(bookingId)) {
          const maxAmt = getMaxDisputeAmount(booking);
          setDisputeAmounts(prevMap => new Map(prevMap).set(bookingId, maxAmt));
        }
      }
      return newSet;
    });
  }, [isBookingDisputable, disputeAmounts, getMaxDisputeAmount]);

  const updateDisputeAmount = useCallback((bookingId: string, amount: number) => {
    setDisputeAmounts(prev => new Map(prev).set(bookingId, amount));
  }, []);

  const updateReasonDispute = useCallback((reason: string, action: "all" | "clear") => {
    const reasonBookings = bookingsByReason[reason] || [];
    if (action === "all") {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        for (const b of reasonBookings) {
          if (isBookingDisputable(b)) {
            newSet.add(b.bookingId);
            if (!disputeAmounts.has(b.bookingId)) {
              const maxAmt = getMaxDisputeAmount(b);
              setDisputeAmounts(prevMap => new Map(prevMap).set(b.bookingId, maxAmt));
            }
          }
        }
        return newSet;
      });
    } else {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        for (const b of reasonBookings) {
          newSet.delete(b.bookingId);
        }
        return newSet;
      });
    }
  }, [bookingsByReason, isBookingDisputable, disputeAmounts, getMaxDisputeAmount]);

  const getTidDisputeCount = useCallback((reason: string, tid: string) => {
    const tidBookings = bookingsByReasonAndTid[reason]?.[tid] || [];
    let disputed = 0;
    let disputable = 0;
    for (const b of tidBookings) {
      if (isBookingDisputable(b)) {
        disputable++;
        if (activeDisputes.has(b.bookingId)) {
          disputed++;
        }
      }
    }
    return { disputed, disputable };
  }, [bookingsByReasonAndTid, isBookingDisputable, activeDisputes]);

  const toggleTidDispute = useCallback((reason: string, tid: string) => {
    const tidBookings = bookingsByReasonAndTid[reason]?.[tid] || [];
    const { disputed, disputable } = getTidDisputeCount(reason, tid);
    
    if (disputed === disputable) {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        for (const b of tidBookings) {
          newSet.delete(b.bookingId);
        }
        return newSet;
      });
    } else {
      setActiveDisputes(prev => {
        const newSet = new Set(prev);
        for (const b of tidBookings) {
          if (isBookingDisputable(b)) {
            newSet.add(b.bookingId);
            if (!disputeAmounts.has(b.bookingId)) {
              const maxAmt = getMaxDisputeAmount(b);
              setDisputeAmounts(prevMap => new Map(prevMap).set(b.bookingId, maxAmt));
            }
          }
        }
        return newSet;
      });
    }
  }, [bookingsByReasonAndTid, getTidDisputeCount, isBookingDisputable, disputeAmounts, getMaxDisputeAmount]);

  const addAdjustment = useCallback(() => {
    setLocalAdjustments((prev) => [
      ...prev,
      {
        id: `adj-${Date.now()}`,
        nature: "",
        reference: "",
        type: "less",
        amount: 0,
        isPreset: false,
      },
    ]);
  }, []);

  const removeAdjustment = useCallback((id: string) => {
    setLocalAdjustments((prev) => prev.filter((a) => a.id !== id || a.isPreset));
  }, []);

  const updateAdjustment = useCallback((id: string, field: keyof Adjustment, value: string | number | string[]) => {
    setLocalAdjustments((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        return { ...a, [field]: value };
      })
    );
    setValidationError("");
  }, []);

  const updateAdjustmentDisputes = useCallback((adjustmentId: string, selectedIds: string[]) => {
    setLocalAdjustments((prev) =>
      prev.map((a) => {
        if (a.id !== adjustmentId) return a;
        
        const totalAmount = openDisputes
          .filter(d => selectedIds.includes(d.displayId))
          .reduce((sum, d) => sum + d.totalDisputeAmount, 0);
        
        const roundedAmount = Math.round(totalAmount * 100) / 100;
        
        return {
          ...a,
          selectedDisputeIds: selectedIds,
          reference: selectedIds.join(", "),
          amount: roundedAmount,
        };
      })
    );
  }, [openDisputes]);

  const handleApply = useCallback(async () => {
    setValidationError("");
    
    const manualAdjustments = localAdjustments.filter(a => !a.isPreset);
    for (const adj of manualAdjustments) {
      if (!adj.nature.trim() || !adj.reference.trim() || adj.amount === 0) {
        setValidationError("Please fill in all fields (Nature, Reference No, Amount) for manually added adjustment rows before applying.");
        return;
      }
    }
    
    if (runId) {
      const newDisputes: Array<{
        bookingId: string;
        disputeAmount: number;
        currency: string;
        billingEntityId: string;
        billingEntityName: string;
        ticketId: string;
        tid: string;
        reconciledNet: number;
      }> = [];
      const removedDisputes: string[] = [];

      for (const booking of bookings) {
        const wasDisputed = originalDisputes.has(booking.bookingId);
        const isNowDisputed = activeDisputes.has(booking.bookingId);
        const currentAmount = disputeAmounts.get(booking.bookingId) || 0;
        const originalAmount = originalDisputes.get(booking.bookingId) || 0;

        if (isNowDisputed && (!wasDisputed || currentAmount !== originalAmount)) {
          const selection = localSelections[booking.bookingId] || "ho";
          const reconciledNet = selection === "ho" ? booking.hoNet : booking.spNet;
          newDisputes.push({
            bookingId: booking.bookingId,
            disputeAmount: currentAmount,
            currency: booking.currency,
            billingEntityId: booking.beId || "",
            billingEntityName: booking.billingEntityName || "",
            ticketId: booking.ticketId || "",
            tid: booking.tid || "",
            reconciledNet,
          });
        } else if (wasDisputed && !isNowDisputed) {
          removedDisputes.push(booking.bookingId);
        }
      }

      if (newDisputes.length > 0) {
        await apiRequest("POST", `/api/disputes/${runId}`, { disputes: newDisputes });
      }
      
      if (removedDisputes.length > 0) {
        await apiRequest("DELETE", `/api/disputes/${runId}`, { bookingIds: removedDisputes });
      }
      
      await queryClient.invalidateQueries({ queryKey: [`/api/disputes/${runId}`] });
    }
    
    onApply(localAdjustments, localSelections, finalAmount);
  }, [localAdjustments, localSelections, finalAmount, onApply, runId, disputeAmounts, originalDisputes, bookings, activeDisputes]);

  const formatCurrency = (value: number) => {
    return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Amount Payable Calculator - {currency}</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-panel">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {(billingEntityInfo.beId || billingEntityInfo.billingEntityName || billingEntityInfo.ticketId || billingEntityInfo.paymentBasis) && (
        <div className="flex-shrink-0 bg-primary/5 border-b border-primary/20 p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Billing Entity ID</p>
              <p className="font-mono font-semibold" data-testid="text-be-id">
                {billingEntityInfo.beId || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Billing Entity Name</p>
              <p className="font-semibold" data-testid="text-be-name">
                {billingEntityInfo.billingEntityName || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Ticket ID</p>
              <p className="font-mono font-semibold" data-testid="text-ticket-id">
                {billingEntityInfo.ticketId || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Payment Basis</p>
              <p className="font-semibold" data-testid="text-payment-basis">
                {billingEntityInfo.paymentBasis || "—"}
              </p>
            </div>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">Reconciled Bookings</p>
              <Badge variant="secondary">{reconciledBookings.length} bookings</Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              For reconciled bookings, SP Net is always used as Final Net
            </p>
            <p className="text-xl font-bold font-mono" data-testid="text-reconciled-total">
              {formatCurrency(reconciledTotal)} {currency}
            </p>
          </div>

          {discrepancyBookings.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-medium">Discrepancy Bookings by Reason</p>
                  <p className="text-xs text-muted-foreground">
                    Select HO Net or SP Net as Final Net for each discrepancy type
                  </p>
                </div>
                <Badge variant="outline">{discrepancyBookings.length} bookings</Badge>
              </div>

              <div className="space-y-3">
                {Object.entries(bookingsByReasonAndTid).map(([reason, tidGroups]) => {
                  const reasonBookings = bookingsByReason[reason] || [];
                  const reasonTotal = getReasonTotal(reason);
                  const tidKey = (tid: string) => `${reason}:${tid}`;

                  return (
                    <Collapsible
                      key={reason}
                      open={expandedReasons.has(reason)}
                      onOpenChange={() => toggleReason(reason)}
                    >
                      <div className="border rounded-lg overflow-hidden">
                        <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/50 items-center">
                          <div className="col-span-4 flex items-center gap-2">
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                {expandedReasons.has(reason) ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            </CollapsibleTrigger>
                            <Button
                              variant="ghost"
                              className="p-0 h-auto font-semibold text-sm hover:text-primary hover:bg-transparent"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedReasonModal(reason);
                              }}
                              data-testid={`button-view-reason-${reason}`}
                            >
                              {reason}
                              <Eye className="h-3 w-3 ml-1 opacity-50" />
                            </Button>
                            <Badge variant="secondary" className="text-xs">
                              {reasonBookings.length}
                            </Badge>
                          </div>
                          <div className="col-span-2 flex justify-center">
                            {reason === "Unmapped" ? (
                              <span className="text-xs text-muted-foreground">SP Net only</span>
                            ) : (
                              <Select
                                value=""
                                onValueChange={(v) => updateReasonSelection(reason, v as "ho" | "sp")}
                              >
                                <SelectTrigger className="w-24 h-7 text-xs" data-testid={`select-reason-${reason}`}>
                                  <SelectValue placeholder="Bulk Net" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="ho">All HO Net</SelectItem>
                                  <SelectItem value="sp">All SP Net</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                          <div className="col-span-2 flex justify-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              onClick={() => updateReasonDispute(reason, "all")}
                              data-testid={`button-dispute-all-${reason}`}
                            >
                              Dispute All
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs text-muted-foreground"
                              onClick={() => updateReasonDispute(reason, "clear")}
                              data-testid={`button-clear-${reason}`}
                            >
                              Clear
                            </Button>
                          </div>
                          <div className="col-span-4 text-right font-mono text-sm font-semibold">
                            {formatCurrency(reasonTotal)} {currency}
                          </div>
                        </div>

                        <CollapsibleContent>
                          <div className="grid grid-cols-12 gap-2 px-3 py-1.5 bg-muted/30 text-xs font-medium text-muted-foreground border-t">
                            <div className="col-span-3">TID / Booking ID</div>
                            <div className="col-span-2 text-right">HO Net</div>
                            <div className="col-span-2 text-right">SP Net</div>
                            <div className="col-span-2 text-center">Final Net</div>
                            <div className="col-span-3 text-right">Amount</div>
                          </div>

                          <div className="max-h-64 overflow-y-auto">
                            {Object.entries(tidGroups).map(([tid, tidBookings]) => (
                              <div key={tid} className="border-t">
                                <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-background items-center">
                                  <div className="col-span-3">
                                    <span className="font-medium text-xs truncate block" title={tid}>
                                      {tid}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {tidBookings.length} booking{tidBookings.length > 1 ? "s" : ""}
                                    </span>
                                  </div>
                                  <div className="col-span-2 text-right font-mono text-xs">
                                    {formatCurrency(tidBookings.reduce((s, b) => s + b.hoNet, 0))}
                                  </div>
                                  <div className="col-span-2 text-right font-mono text-xs">
                                    {formatCurrency(tidBookings.reduce((s, b) => s + b.spNet, 0))}
                                  </div>
                                  <div className="col-span-2 flex justify-center">
                                    {reason === "Unmapped" ? (
                                      <span className="text-xs text-muted-foreground">SP</span>
                                    ) : (
                                      <Select
                                        value=""
                                        onValueChange={(v) => updateTidSelection(reason, tid, v as "ho" | "sp")}
                                      >
                                        <SelectTrigger className="w-16 h-6 text-xs" data-testid={`select-tid-${tid}`}>
                                          <SelectValue placeholder="Net" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="ho">HO</SelectItem>
                                          <SelectItem value="sp">SP</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    )}
                                  </div>
                                  <div className="col-span-3 text-right font-mono text-xs font-semibold">
                                    {formatCurrency(tidBookings.reduce((s, b) => s + getFinalNetPrice(b), 0))}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })}
              </div>

              <div className="flex justify-between items-center pt-3 mt-3 border-t">
                <p className="text-sm font-medium">Discrepancy Total</p>
                <p className="text-lg font-bold font-mono" data-testid="text-discrepancy-total">
                  {formatCurrency(discrepancyTotal)} {currency}
                </p>
              </div>
            </div>
          )}

          <Separator />

          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-1">Base Amount</p>
            <p className="text-2xl font-bold font-mono" data-testid="text-base-amount">
              {formatCurrency(baseAmount)} {currency}
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium">Adjustments</p>
              <Button
                size="sm"
                variant="outline"
                onClick={addAdjustment}
                data-testid="button-add-adjustment"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Row
              </Button>
            </div>

            {validationError && (
              <div className="mb-3 p-2 bg-destructive/10 border border-destructive/20 rounded-md flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <p className="text-sm text-destructive">{validationError}</p>
              </div>
            )}

            <div className="grid grid-cols-12 gap-2 px-2 py-1 bg-muted/50 rounded-t-md text-xs font-medium text-muted-foreground">
              <div className="col-span-3">Nature</div>
              <div className="col-span-3">Reference No</div>
              <div className="col-span-2">Add/Less</div>
              <div className="col-span-2 text-right">Amount</div>
              <div className="col-span-2"></div>
            </div>

            <div className="space-y-2 mt-2">
              {localAdjustments.map((adj, index) => {
                const isDisputeAdjustment = adj.nature === "Open Dispute Adjustments";
                const isPreset = adj.isPreset === true;
                
                return (
                  <div
                    key={adj.id}
                    className="grid grid-cols-12 gap-2 items-center"
                    data-testid={`row-adjustment-${index}`}
                  >
                    <div className="col-span-3">
                      {isPreset ? (
                        <div 
                          className="h-8 px-3 flex items-center text-sm bg-muted/50 rounded-md border"
                          data-testid={`text-nature-${index}`}
                        >
                          {adj.nature}
                        </div>
                      ) : (
                        <Input
                          placeholder="Enter nature..."
                          value={adj.nature}
                          onChange={(e) => updateAdjustment(adj.id, "nature", e.target.value)}
                          className="h-8"
                          data-testid={`input-nature-${index}`}
                        />
                      )}
                    </div>

                    <div className="col-span-3">
                      {isDisputeAdjustment ? (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className="h-8 w-full justify-start text-left font-normal"
                              data-testid={`select-disputes-${index}`}
                            >
                              {adj.selectedDisputeIds && adj.selectedDisputeIds.length > 0 ? (
                                <span className="truncate">
                                  {adj.selectedDisputeIds.length} dispute{adj.selectedDisputeIds.length > 1 ? "s" : ""} selected
                                </span>
                              ) : (
                                <span className="text-muted-foreground">Select disputes...</span>
                              )}
                              <ChevronDown className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-2" align="start">
                            {openDisputes.length === 0 ? (
                              <p className="text-sm text-muted-foreground p-2">No open disputes</p>
                            ) : (
                              <div className="space-y-1 max-h-48 overflow-y-auto">
                                {openDisputes.map((dispute) => {
                                  const isSelected = adj.selectedDisputeIds?.includes(dispute.displayId) || false;
                                  return (
                                    <div
                                      key={dispute.displayId}
                                      className="flex items-center gap-2 p-2 rounded hover-elevate cursor-pointer"
                                      onClick={() => {
                                        const currentIds = adj.selectedDisputeIds || [];
                                        const newIds = isSelected
                                          ? currentIds.filter(id => id !== dispute.displayId)
                                          : [...currentIds, dispute.displayId];
                                        updateAdjustmentDisputes(adj.id, newIds);
                                      }}
                                    >
                                      <Checkbox checked={isSelected} />
                                      <div className="flex-1">
                                        <span className="text-sm font-medium">{dispute.displayId}</span>
                                        <span className="text-xs text-muted-foreground ml-2">
                                          ({formatCurrency(dispute.totalDisputeAmount)} {currency})
                                        </span>
                                        {dispute.bookingCount > 1 && (
                                          <span className="text-xs text-muted-foreground ml-1">
                                            ({dispute.bookingCount} bookings)
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
                      ) : (
                        <ScrollArea className="w-full">
                          <Input
                            placeholder="Reference..."
                            value={adj.reference}
                            onChange={(e) => updateAdjustment(adj.id, "reference", e.target.value)}
                            className="h-8"
                            data-testid={`input-reference-${index}`}
                          />
                        </ScrollArea>
                      )}
                    </div>

                    <div className="col-span-2">
                      {isDisputeAdjustment ? (
                        <div className="h-8 px-3 flex items-center text-sm bg-muted/50 rounded-md border">
                          Less
                        </div>
                      ) : (
                        <Select
                          value={adj.type}
                          onValueChange={(v) => updateAdjustment(adj.id, "type", v)}
                        >
                          <SelectTrigger className="h-8" data-testid={`select-type-${index}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="add">Add</SelectItem>
                            <SelectItem value="less">Less</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>

                    <div className="col-span-2">
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={adj.amount || ""}
                        onChange={(e) => updateAdjustment(adj.id, "amount", parseFloat(e.target.value) || 0)}
                        className={`font-mono h-8 ${isDisputeAdjustment ? "bg-muted" : ""}`}
                        readOnly={isDisputeAdjustment}
                        data-testid={`input-amount-${index}`}
                      />
                    </div>

                    <div className="col-span-2 flex justify-end">
                      {!isPreset && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeAdjustment(adj.id)}
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          data-testid={`button-remove-${index}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Separator />

          <div className="bg-primary/5 rounded-lg p-4 border border-primary/20">
            <p className="text-sm text-muted-foreground mb-1">Final Amount Payable</p>
            <p
              className="text-3xl font-bold font-mono text-primary"
              data-testid="text-final-amount"
            >
              {formatCurrency(finalAmount)} {currency}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Base ({formatCurrency(baseAmount)})
              {localAdjustments.map((adj) => (
                <span key={adj.id}>
                  {adj.type === "add" ? " + " : " - "}
                  {formatCurrency(adj.amount)}
                </span>
              ))}
            </p>
          </div>
        </div>
      </ScrollArea>

      <div className="flex justify-end gap-2 p-4 border-t flex-shrink-0">
        <Button variant="outline" onClick={onClose} data-testid="button-cancel">
          Cancel
        </Button>
        <Button onClick={handleApply} data-testid="button-apply">
          Apply
        </Button>
      </div>

      <Dialog open={!!selectedReasonModal} onOpenChange={(open) => !open && setSelectedReasonModal(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>
              Discrepancy Analysis: {selectedReasonModal === "MTB" ? "Multiple Tickets Booked" : 
                selectedReasonModal === "NPD" ? "Net Price Discrepancy" :
                selectedReasonModal === "Unmapped" ? "Unmapped Bookings" :
                selectedReasonModal}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {selectedReasonModal && (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">TID</TableHead>
                    <TableHead className="font-semibold text-right">Discrepancy USD</TableHead>
                    <TableHead className="font-semibold">Fulfilment Method</TableHead>
                    <TableHead className="font-semibold text-center">Times Charged</TableHead>
                    <TableHead className="font-semibold">Booking Date</TableHead>
                    <TableHead className="font-semibold text-center">BID Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const filteredRows = allRows.filter(r => r.reason === selectedReasonModal);
                    const groupedByTid = new Map<string, typeof filteredRows>();
                    for (const row of filteredRows) {
                      const tid = row.tid || row.bookingId;
                      if (!groupedByTid.has(tid)) {
                        groupedByTid.set(tid, []);
                      }
                      groupedByTid.get(tid)!.push(row);
                    }
                    
                    return Array.from(groupedByTid.entries()).map(([tid, rows]) => {
                      const totalDiscrepancy = rows.reduce((sum, r) => sum + (r.differenceUsd || 0), 0);
                      const firstRow = rows[0];
                      return (
                        <TableRow key={tid}>
                          <TableCell className="font-mono">{tid}</TableCell>
                          <TableCell className={`text-right font-mono ${totalDiscrepancy < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                            {totalDiscrepancy.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell>{firstRow.fulfillmentIdentifier || "-"}</TableCell>
                          <TableCell className="text-center">{rows.length > 1 ? `${rows.length}x` : "1x"}</TableCell>
                          <TableCell>{firstRow.bookingCreationDate || "-"}</TableCell>
                          <TableCell className="text-center">{rows.length}</TableCell>
                        </TableRow>
                      );
                    });
                  })()}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
