import { useState, useCallback, useMemo, useEffect } from "react";
import { Plus, Trash2, Calculator, ChevronDown, ChevronRight, AlertTriangle, Check } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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

export interface Adjustment {
  id: string;
  nature: string;
  reference: string;
  type: "add" | "less";
  amount: number;
  selectedDisputeIds?: string[]; // For "Open Dispute Adjustments" nature
  maxDisputeAmount?: number; // Max allowed amount based on selected DIDs (for "Open Dispute Adjustments")
  isPreset?: boolean; // True for the 7 fixed adjustment rows
}

// The 7 fixed preset adjustment natures (in order)
export const PRESET_ADJUSTMENT_NATURES = [
  "Open Dispute Adjustments",
  "Cancellations-Post Recon",
  "Credit Note",
  "Debit Note",
  "Rebate",
  "Co-Marketing Income",
  "Deposit adjustment",
] as const;

// Helper to create the 7 preset adjustment rows
export const createPresetAdjustments = (): Adjustment[] => {
  return PRESET_ADJUSTMENT_NATURES.map((nature, index) => ({
    id: `preset-${index}`,
    nature,
    reference: "",
    type: "less" as const,
    amount: 0,
    selectedDisputeIds: nature === "Open Dispute Adjustments" ? [] : undefined,
    isPreset: true,
  }));
};

export interface BookingForPayable {
  bookingId: string;
  tid: string;
  reason: string;
  hoNet: number;
  spNet: number;
  currency: string;
  beId?: string;
  billingEntityName?: string;
}

export interface FinalNetSelection {
  [bookingId: string]: "ho" | "sp";
}

interface AmountPayableModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookings: BookingForPayable[];
  currency: string;
  adjustments: Adjustment[];
  finalNetSelections: FinalNetSelection;
  onApply: (adjustments: Adjustment[], selections: FinalNetSelection, finalAmount: number) => void;
  runId?: string | null;
}

export function AmountPayableModal({
  open,
  onOpenChange,
  bookings,
  currency,
  adjustments,
  finalNetSelections,
  onApply,
  runId,
}: AmountPayableModalProps) {
  const [localAdjustments, setLocalAdjustments] = useState<Adjustment[]>(adjustments);
  const [localSelections, setLocalSelections] = useState<FinalNetSelection>(finalNetSelections);
  const [expandedReasons, setExpandedReasons] = useState<Set<string>>(new Set());
  const [expandedTids, setExpandedTids] = useState<Set<string>>(new Set());
  const [disputeAmounts, setDisputeAmounts] = useState<Map<string, number>>(new Map());
  const [activeDisputes, setActiveDisputes] = useState<Set<string>>(new Set());
  const [originalDisputes, setOriginalDisputes] = useState<Map<string, number>>(new Map());
  const [disputesLoaded, setDisputesLoaded] = useState(false);
  // Store aggregated disputes by billing entity for adjustment reference dropdown (matches Dispute Tracker view)
  const [openDisputes, setOpenDisputes] = useState<Array<{ 
    displayId: string; 
    billingEntityId: string;
    billingEntityName: string;
    totalDisputeAmount: number; 
    bookingCount: number;
  }>>([]);
  // Validation error for manually added adjustment rows
  const [validationError, setValidationError] = useState<string>("");

  // Reset adjustments and selections when props change (but not disputes)
  useEffect(() => {
    if (open) {
      // Merge preset adjustments with any passed-in adjustments
      const presets = createPresetAdjustments();
      const customAdjustments = adjustments.filter(a => !a.isPreset);
      setLocalAdjustments([...presets, ...customAdjustments]);
      setLocalSelections(finalNetSelections);
    }
  }, [open, adjustments, finalNetSelections]);

  // Load disputes only once when modal opens (not when other props change)
  useEffect(() => {
    if (open && !disputesLoaded) {
      setExpandedReasons(new Set());
      setExpandedTids(new Set());
      
      // Load existing disputes from backend
      if (runId) {
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
            // Store original state for comparison on Apply
            setOriginalDisputes(new Map(newDisputeAmounts));
            
            // Aggregate disputes by billing entity (same logic as Dispute Tracker)
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
            
            // Create aggregated display (matching Dispute Tracker numbering)
            const aggregatedDisputes: Array<{ displayId: string; billingEntityId: string; billingEntityName: string; totalDisputeAmount: number; bookingCount: number }> = [];
            let counter = 1;
            for (const group of Array.from(groupedByBillingEntity.values())) {
              if (group.length === 0) continue;
              const first = group[0];
              const totalAmount = group.reduce((sum, d) => sum + d.disputeAmount, 0);
              // Round to exactly 2 decimal places
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
      } else {
        setDisputeAmounts(new Map());
        setActiveDisputes(new Set());
        setOriginalDisputes(new Map());
        setDisputesLoaded(true);
      }
    }
    
    // Reset disputesLoaded when modal closes so next open loads fresh data
    if (!open) {
      setDisputesLoaded(false);
    }
  }, [open, runId, disputesLoaded]);

  const reconciledBookings = useMemo(() => 
    (bookings || []).filter(b => b.reason === "Reconciled"), 
    [bookings]
  );

  const discrepancyBookings = useMemo(() => 
    (bookings || []).filter(b => b.reason !== "Reconciled"), 
    [bookings]
  );

  const bookingsByReason = useMemo(() => {
    const grouped: Record<string, BookingForPayable[]> = {};
    for (const b of discrepancyBookings) {
      if (!grouped[b.reason]) grouped[b.reason] = [];
      grouped[b.reason].push(b);
    }
    return grouped;
  }, [discrepancyBookings]);

  const billingEntityInfo = useMemo(() => {
    const allBookings = bookings || [];
    const beId = allBookings.find(b => b.beId)?.beId || null;
    const billingEntityName = allBookings.find(b => b.billingEntityName)?.billingEntityName || null;
    return { beId, billingEntityName };
  }, [bookings]);

  const bookingsByReasonAndTid = useMemo(() => {
    const result: Record<string, Record<string, BookingForPayable[]>> = {};
    for (const [reason, reasonBookings] of Object.entries(bookingsByReason)) {
      result[reason] = {};
      for (const b of reasonBookings) {
        if (!result[reason][b.tid]) result[reason][b.tid] = [];
        result[reason][b.tid].push(b);
      }
    }
    return result;
  }, [bookingsByReason]);

  const getSelection = useCallback((bookingId: string, reason: string): "ho" | "sp" => {
    if (reason === "Reconciled") return "sp";
    return localSelections[bookingId] || "sp";
  }, [localSelections]);

  const getFinalNetPrice = useCallback((booking: BookingForPayable): number => {
    const selection = getSelection(booking.bookingId, booking.reason);
    return selection === "ho" ? booking.hoNet : booking.spNet;
  }, [getSelection]);

  const reconciledTotal = useMemo(() => 
    reconciledBookings.reduce((sum, b) => sum + b.spNet, 0),
    [reconciledBookings]
  );

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
    // Round to exactly 2 decimal places
    return Math.round(result * 100) / 100;
  }, [baseAmount, localAdjustments]);

  const updateSelection = useCallback((bookingId: string, value: "ho" | "sp", booking?: BookingForPayable) => {
    setLocalSelections(prev => ({ ...prev, [bookingId]: value }));
    if (value === "ho") {
      setDisputeAmounts(prev => {
        const next = new Map(prev);
        next.delete(bookingId);
        return next;
      });
      setActiveDisputes(prev => {
        const next = new Set(prev);
        next.delete(bookingId);
        return next;
      });
    }
  }, []);

  const updateReasonSelection = useCallback((reason: string, value: "ho" | "sp") => {
    const reasonBookings = bookingsByReason[reason] || [];
    setLocalSelections(prev => {
      const updated = { ...prev };
      for (const b of reasonBookings) {
        updated[b.bookingId] = value;
      }
      return updated;
    });
    if (value === "ho") {
      setDisputeAmounts(prev => {
        const next = new Map(prev);
        for (const b of reasonBookings) {
          next.delete(b.bookingId);
        }
        return next;
      });
      setActiveDisputes(prev => {
        const next = new Set(prev);
        for (const b of reasonBookings) {
          next.delete(b.bookingId);
        }
        return next;
      });
    }
  }, [bookingsByReason]);

  const updateTidSelection = useCallback((reason: string, tid: string, value: "ho" | "sp") => {
    const tidBookings = bookingsByReasonAndTid[reason]?.[tid] || [];
    setLocalSelections(prev => {
      const updated = { ...prev };
      for (const b of tidBookings) {
        updated[b.bookingId] = value;
      }
      return updated;
    });
    if (value === "ho") {
      setDisputeAmounts(prev => {
        const next = new Map(prev);
        for (const b of tidBookings) {
          next.delete(b.bookingId);
        }
        return next;
      });
      setActiveDisputes(prev => {
        const next = new Set(prev);
        for (const b of tidBookings) {
          next.delete(b.bookingId);
        }
        return next;
      });
    }
  }, [bookingsByReasonAndTid]);

  const activateDispute = useCallback((bookingId: string, booking: BookingForPayable) => {
    const maxDispute = Math.abs(booking.hoNet - booking.spNet);
    setActiveDisputes(prev => {
      const next = new Set(prev);
      next.add(bookingId);
      return next;
    });
    setDisputeAmounts(prev => {
      const next = new Map(prev);
      next.set(bookingId, maxDispute);
      return next;
    });
    // Note: Disputes are saved to backend only when Apply is clicked
  }, []);

  const toggleReason = useCallback((reason: string) => {
    setExpandedReasons(prev => {
      const next = new Set(prev);
      if (next.has(reason)) {
        next.delete(reason);
      } else {
        next.add(reason);
      }
      return next;
    });
  }, []);

  const toggleTid = useCallback((key: string) => {
    setExpandedTids(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const getMaxDisputeAmount = useCallback((booking: BookingForPayable): number => {
    return Math.abs(booking.hoNet - booking.spNet);
  }, []);

  const getDisputeAmount = useCallback((bookingId: string): number => {
    return disputeAmounts.get(bookingId) || 0;
  }, [disputeAmounts]);

  const setBookingDisputeAmount = useCallback((bookingId: string, amount: number, _booking?: BookingForPayable) => {
    setDisputeAmounts(prev => {
      const next = new Map(prev);
      if (amount <= 0) {
        next.delete(bookingId);
      } else {
        next.set(bookingId, amount);
      }
      return next;
    });
    if (amount <= 0) {
      setActiveDisputes(prev => {
        const next = new Set(prev);
        next.delete(bookingId);
        return next;
      });
    }
    // Note: Disputes are saved to backend only when Apply is clicked
  }, []);

  const updateReasonDispute = useCallback((reason: string, action: "all" | "clear") => {
    const reasonBookings = bookingsByReason[reason] || [];
    const disputableBookings = reasonBookings.filter(b => 
      getSelection(b.bookingId, b.reason) === "sp"
    );
    setDisputeAmounts(prev => {
      const next = new Map(prev);
      for (const b of disputableBookings) {
        if (action === "all") {
          next.set(b.bookingId, getMaxDisputeAmount(b));
        } else {
          next.delete(b.bookingId);
        }
      }
      return next;
    });
    setActiveDisputes(prev => {
      const next = new Set(prev);
      for (const b of disputableBookings) {
        if (action === "all") {
          next.add(b.bookingId);
        } else {
          next.delete(b.bookingId);
        }
      }
      return next;
    });
    // Note: Disputes are saved to backend only when Apply is clicked
  }, [bookingsByReason, getSelection, getMaxDisputeAmount]);

  const updateTidDispute = useCallback((reason: string, tid: string, action: "all" | "clear") => {
    const tidBookings = bookingsByReasonAndTid[reason]?.[tid] || [];
    const disputableBookings = tidBookings.filter(b => 
      getSelection(b.bookingId, b.reason) === "sp"
    );
    setDisputeAmounts(prev => {
      const next = new Map(prev);
      for (const b of disputableBookings) {
        if (action === "all") {
          next.set(b.bookingId, getMaxDisputeAmount(b));
        } else {
          next.delete(b.bookingId);
        }
      }
      return next;
    });
    setActiveDisputes(prev => {
      const next = new Set(prev);
      for (const b of disputableBookings) {
        if (action === "all") {
          next.add(b.bookingId);
        } else {
          next.delete(b.bookingId);
        }
      }
      return next;
    });
    // Note: Disputes are saved to backend only when Apply is clicked
  }, [bookingsByReasonAndTid, getSelection, getMaxDisputeAmount]);

  const getTidDisputeCount = useCallback((reason: string, tid: string): { disputed: number; disputable: number; total: number; totalDisputeAmt: number } => {
    const tidBookings = bookingsByReasonAndTid[reason]?.[tid] || [];
    const disputableBookings = tidBookings.filter(b => 
      getSelection(b.bookingId, b.reason) === "sp"
    );
    const disputed = disputableBookings.filter(b => getDisputeAmount(b.bookingId) > 0).length;
    const totalDisputeAmt = disputableBookings.reduce((s, b) => s + getDisputeAmount(b.bookingId), 0);
    return { disputed, disputable: disputableBookings.length, total: tidBookings.length, totalDisputeAmt };
  }, [bookingsByReasonAndTid, getSelection, getDisputeAmount]);

  const isTidPartiallyDisputed = useCallback((reason: string, tid: string) => {
    const { disputed, disputable } = getTidDisputeCount(reason, tid);
    return disputed > 0 && disputed < disputable;
  }, [getTidDisputeCount]);

  const hasBookingDispute = useCallback((bookingId: string) => {
    return getDisputeAmount(bookingId) > 0;
  }, [getDisputeAmount]);

  const getReasonTotal = useCallback((reason: string): number => {
    const reasonBookings = bookingsByReason[reason] || [];
    return reasonBookings.reduce((sum, b) => sum + getFinalNetPrice(b), 0);
  }, [bookingsByReason, getFinalNetPrice]);

  const addAdjustment = useCallback(() => {
    const newAdj: Adjustment = {
      id: crypto.randomUUID(),
      nature: "",
      reference: "",
      type: "add",
      amount: 0,
      isPreset: false, // Manually added row
    };
    setLocalAdjustments((prev) => [...prev, newAdj]);
  }, []);

  const removeAdjustment = useCallback((id: string) => {
    // Only allow deletion of non-preset rows
    setLocalAdjustments((prev) => prev.filter((a) => a.id !== id || a.isPreset));
  }, []);

  const updateAdjustment = useCallback((id: string, field: keyof Adjustment, value: string | number | string[]) => {
    setLocalAdjustments((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        return { ...a, [field]: value };
      })
    );
    // Clear validation error when user starts filling in fields
    setValidationError("");
  }, []);

  // Update selected dispute IDs for an adjustment and recalculate amount
  const updateAdjustmentDisputes = useCallback((adjustmentId: string, selectedIds: string[]) => {
    setLocalAdjustments((prev) =>
      prev.map((a) => {
        if (a.id !== adjustmentId) return a;
        
        // Calculate total amount from selected aggregated disputes
        const totalAmount = openDisputes
          .filter(d => selectedIds.includes(d.displayId))
          .reduce((sum, d) => sum + d.totalDisputeAmount, 0);
        
        // Round to exactly 2 decimal places
        const roundedAmount = Math.round(totalAmount * 100) / 100;
        
        return {
          ...a,
          selectedDisputeIds: selectedIds,
          reference: selectedIds.join(", "),
          amount: roundedAmount,
          maxDisputeAmount: roundedAmount, // Set max as the total from selected DIDs
        };
      })
    );
  }, [openDisputes]);

  // Update dispute adjustment amount with max validation
  const updateDisputeAdjustmentAmount = useCallback((adjustmentId: string, value: number) => {
    setLocalAdjustments((prev) =>
      prev.map((a) => {
        if (a.id !== adjustmentId) return a;
        // Clamp the value to max if it exceeds
        const maxAmount = a.maxDisputeAmount || 0;
        const clampedValue = Math.min(value, maxAmount);
        // Round to exactly 2 decimal places
        const roundedAmount = Math.round(clampedValue * 100) / 100;
        return { ...a, amount: roundedAmount };
      })
    );
  }, []);

  const handleApply = useCallback(async () => {
    // Clear any previous validation error
    setValidationError("");
    
    // Validate manually added rows - all fields must be filled
    const manualAdjustments = localAdjustments.filter(a => !a.isPreset);
    const incompleteRows = manualAdjustments.filter(a => 
      !a.nature.trim() || !a.reference.trim() || !a.type || a.amount === 0
    );
    
    if (incompleteRows.length > 0) {
      setValidationError(`Manually added rows require: Nature, Reference No, Add/Less selection, and Amount (non-zero). ${incompleteRows.length} row(s) incomplete.`);
      return;
    }
    
    // Sync disputes to backend: compare current state with original
    if (runId) {
      const currentBookingIds = new Set(disputeAmounts.keys());
      const originalBookingIds = new Set(originalDisputes.keys());
      
      // Find disputes to create (in current but not in original, or amount changed)
      const disputesToCreate: string[] = [];
      Array.from(currentBookingIds).forEach(bookingId => {
        const currentAmount = disputeAmounts.get(bookingId) || 0;
        const originalAmount = originalDisputes.get(bookingId) || 0;
        if (!originalBookingIds.has(bookingId) || currentAmount !== originalAmount) {
          disputesToCreate.push(bookingId);
        }
      });
      
      // Find disputes to delete (in original but not in current)
      const disputesToDelete: string[] = [];
      Array.from(originalBookingIds).forEach(bookingId => {
        if (!currentBookingIds.has(bookingId)) {
          disputesToDelete.push(bookingId);
        }
      });
      
      // Get booking info for creating disputes
      const allBookings = [...(bookings || [])];
      const bookingMap = new Map(allBookings.map(b => [b.bookingId, b]));
      
      // Create/update disputes
      let createdCount = 0;
      let skippedCount = 0;
      for (const bookingId of disputesToCreate) {
        const booking = bookingMap.get(bookingId);
        const disputeAmount = disputeAmounts.get(bookingId) || 0;
        if (booking && disputeAmount > 0) {
          const maxDispute = Math.abs(booking.hoNet - booking.spNet);
          await apiRequest("POST", "/api/disputes", {
            runId,
            bookingId,
            billingEntityId: booking.beId || "",
            billingEntityName: booking.billingEntityName || "",
            currency: currency,
            disputeAmount,
            maxDisputeAmount: maxDispute,
          }).catch(err => console.error("Failed to create dispute:", err));
          createdCount++;
        } else {
          skippedCount++;
        }
      }
      
      // Delete removed disputes
      for (const bookingId of disputesToDelete) {
        await fetch(`/api/disputes/${runId}/${bookingId}`, { method: "DELETE" })
          .catch(err => console.error("Failed to delete dispute:", err));
      }
      
      // Invalidate the disputes query cache so Dispute Tracker gets fresh data
      await queryClient.invalidateQueries({ queryKey: [`/api/disputes/${runId}`] });
    }
    
    onApply(localAdjustments, localSelections, finalAmount);
    onOpenChange(false);
  }, [localAdjustments, localSelections, finalAmount, onApply, onOpenChange, runId, disputeAmounts, originalDisputes, bookings, currency]);

  // Indian numbering format: 1,00,000.00
  const formatCurrency = (value: number) => {
    return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Amount Payable Calculator - {currency}
          </DialogTitle>
        </DialogHeader>

        {(billingEntityInfo.beId || billingEntityInfo.billingEntityName) && (
          <div className="flex-shrink-0 bg-primary/5 border border-primary/20 rounded-lg p-4 mb-4">
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
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto pr-2" style={{ maxHeight: 'calc(90vh - 140px)' }}>
          <div className="space-y-6">
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
                              <span className="font-semibold text-sm">{reason}</span>
                              <Badge variant="secondary" className="text-xs">
                                {reasonBookings.length} bookings
                              </Badge>
                            </div>
                            <div className="col-span-2 flex justify-center">
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
                            </div>
                            <div className="col-span-2 flex justify-center gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-xs"
                                onClick={() => updateReasonDispute(reason, "all")}
                                data-testid={`button-dispute-all-reason-${reason}`}
                              >
                                Dispute All
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-xs text-muted-foreground"
                                onClick={() => updateReasonDispute(reason, "clear")}
                                data-testid={`button-clear-reason-${reason}`}
                              >
                                Clear
                              </Button>
                            </div>
                            <div className="col-span-4 text-right font-mono text-sm font-semibold">
                              {formatCurrency(reasonTotal)} {currency}
                            </div>
                          </div>

                          <CollapsibleContent>
                            <div className="grid grid-cols-16 gap-2 px-3 py-1.5 bg-muted/30 text-xs font-medium text-muted-foreground border-t">
                              <div className="col-span-3">TID / Booking ID</div>
                              <div className="col-span-2 text-right">HO Net</div>
                              <div className="col-span-2 text-right">SP Net</div>
                              <div className="col-span-2 text-center">Final Net</div>
                              <div className="col-span-1 text-center">Dispute</div>
                              <div className="col-span-2 text-right">Price Payable</div>
                              <div className="col-span-2 text-right">Dispute Amt</div>
                              <div className="col-span-2 text-right">Reconciled Net</div>
                            </div>

                            <div>
                              {Object.entries(tidGroups).map(([tid, tidBookings]) => (
                                <Collapsible
                                  key={tid}
                                  open={expandedTids.has(tidKey(tid))}
                                  onOpenChange={() => toggleTid(tidKey(tid))}
                                >
                                  <div className="border-t">
                                    <div className="grid grid-cols-16 gap-2 px-3 py-2 bg-background items-center">
                                      <div className="col-span-3 flex items-center gap-2">
                                        <CollapsibleTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-5 w-5">
                                            {expandedTids.has(tidKey(tid)) ? (
                                              <ChevronDown className="h-3 w-3" />
                                            ) : (
                                              <ChevronRight className="h-3 w-3" />
                                            )}
                                          </Button>
                                        </CollapsibleTrigger>
                                        <span className="font-medium text-xs truncate" title={tid}>
                                          {tid}
                                        </span>
                                        <Badge variant="outline" className="text-xs h-5">
                                          {tidBookings.length}
                                        </Badge>
                                      </div>
                                      <div className="col-span-2 text-right font-mono text-xs">
                                        {formatCurrency(tidBookings.reduce((s, b) => s + b.hoNet, 0))}
                                      </div>
                                      <div className="col-span-2 text-right font-mono text-xs">
                                        {formatCurrency(tidBookings.reduce((s, b) => s + b.spNet, 0))}
                                      </div>
                                      <div className="col-span-2 flex justify-center">
                                        <Select
                                          value=""
                                          onValueChange={(v) => updateTidSelection(reason, tid, v as "ho" | "sp")}
                                        >
                                          <SelectTrigger className="w-20 h-6 text-xs" data-testid={`select-tid-${reason}-${tid}`}>
                                            <SelectValue placeholder="Bulk" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="ho">All HO Net</SelectItem>
                                            <SelectItem value="sp">All SP Net</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <div className="col-span-1 flex justify-center items-center">
                                        {(() => {
                                          const { disputed, disputable } = getTidDisputeCount(reason, tid);
                                          const noDisputable = disputable === 0;
                                          
                                          if (noDisputable) {
                                            return null;
                                          }
                                          
                                          if (disputed > 0) {
                                            return (
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-4 px-1 text-[9px] text-muted-foreground hover:text-foreground"
                                                onClick={() => updateTidDispute(reason, tid, "clear")}
                                                data-testid={`button-clear-dispute-tid-${reason}-${tid}`}
                                              >
                                                Clear
                                              </Button>
                                            );
                                          }
                                          
                                          return (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="h-5 px-1 text-[9px]"
                                              onClick={() => updateTidDispute(reason, tid, "all")}
                                              data-testid={`button-dispute-all-tid-${reason}-${tid}`}
                                            >
                                              All
                                            </Button>
                                          );
                                        })()}
                                      </div>
                                      <div className="col-span-2 text-right font-mono text-xs font-medium">
                                        {formatCurrency(tidBookings.reduce((s, b) => s + getFinalNetPrice(b), 0))}
                                      </div>
                                      <div className="col-span-2 text-right font-mono text-xs">
                                        {(() => {
                                          const { totalDisputeAmt } = getTidDisputeCount(reason, tid);
                                          return totalDisputeAmt > 0 ? (
                                            <span className="text-orange-600 dark:text-orange-400">{formatCurrency(totalDisputeAmt)}</span>
                                          ) : null;
                                        })()}
                                      </div>
                                      <div className="col-span-2 text-right font-mono text-xs font-medium text-green-600 dark:text-green-400">
                                        {formatCurrency(tidBookings.reduce((s, b) => {
                                          const canDispute = getSelection(b.bookingId, b.reason) === "sp";
                                          const pricePayable = getFinalNetPrice(b);
                                          const disputeAmt = canDispute ? getDisputeAmount(b.bookingId) : 0;
                                          return s + (pricePayable - disputeAmt);
                                        }, 0))}
                                      </div>
                                    </div>

                                    <CollapsibleContent>
                                      {tidBookings.map((booking) => {
                                        const selection = getSelection(booking.bookingId, booking.reason);
                                        const canDispute = selection === "sp";
                                        const pricePayable = getFinalNetPrice(booking);
                                        const maxDispute = getMaxDisputeAmount(booking);
                                        const currentDispute = canDispute ? getDisputeAmount(booking.bookingId) : 0;
                                        const exceedsMax = currentDispute > maxDispute;
                                        const reconciledNet = pricePayable - currentDispute;
                                        return (
                                          <div
                                            key={booking.bookingId}
                                            className="grid grid-cols-16 gap-2 px-3 py-1 border-t border-dashed items-center text-xs"
                                            data-testid={`row-booking-${booking.bookingId}`}
                                          >
                                            <div className="col-span-3 pl-6 truncate text-muted-foreground" title={booking.bookingId}>
                                              {booking.bookingId}
                                            </div>
                                            <div className="col-span-2 text-right font-mono">
                                              {formatCurrency(booking.hoNet)}
                                            </div>
                                            <div className="col-span-2 text-right font-mono">
                                              {formatCurrency(booking.spNet)}
                                            </div>
                                            <div className="col-span-2 flex justify-center">
                                              <Select
                                                value={selection}
                                                onValueChange={(v) => updateSelection(booking.bookingId, v as "ho" | "sp", booking)}
                                              >
                                                <SelectTrigger className="w-16 h-5 text-xs" data-testid={`select-booking-${booking.bookingId}`}>
                                                  <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  <SelectItem value="ho">HO</SelectItem>
                                                  <SelectItem value="sp">SP</SelectItem>
                                                </SelectContent>
                                              </Select>
                                            </div>
                                            <div className="col-span-1 flex justify-center">
                                              {canDispute ? (
                                                activeDisputes.has(booking.bookingId) ? (
                                                  <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-4 px-1 text-[9px] text-muted-foreground hover:text-foreground"
                                                    onClick={() => setBookingDisputeAmount(booking.bookingId, 0)}
                                                    data-testid={`button-clear-dispute-${booking.bookingId}`}
                                                  >
                                                    Clear
                                                  </Button>
                                                ) : (
                                                  <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-5 px-1 text-[9px]"
                                                    onClick={() => activateDispute(booking.bookingId, booking)}
                                                    data-testid={`button-dispute-${booking.bookingId}`}
                                                  >
                                                    Dispute
                                                  </Button>
                                                )
                                              ) : null}
                                            </div>
                                            <div className="col-span-2 text-right font-mono font-medium">
                                              {formatCurrency(pricePayable)}
                                            </div>
                                            <div className="col-span-2 flex justify-end">
                                              {activeDisputes.has(booking.bookingId) ? (
                                                <div className="relative group">
                                                  <Input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={currentDispute || ""}
                                                    onChange={(e) => setBookingDisputeAmount(booking.bookingId, parseFloat(e.target.value) || 0, booking)}
                                                    className={`w-20 h-5 text-xs text-right font-mono px-1 ${exceedsMax ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/30' : ''}`}
                                                    placeholder="0"
                                                    data-testid={`input-dispute-booking-${booking.bookingId}`}
                                                  />
                                                  {exceedsMax && (
                                                    <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover:block">
                                                      <div className="bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 text-[10px] px-2 py-1 rounded shadow-lg whitespace-nowrap border border-orange-300 dark:border-orange-700">
                                                        Max: {formatCurrency(maxDispute)}
                                                      </div>
                                                    </div>
                                                  )}
                                                </div>
                                              ) : null}
                                            </div>
                                            <div className="col-span-2 text-right font-mono font-medium text-green-600 dark:text-green-400">
                                              {formatCurrency(reconciledNet)}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </CollapsibleContent>
                                  </div>
                                </Collapsible>
                              ))}
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    );
                  })}
                </div>

                <div className="mt-3 bg-muted/50 rounded-lg p-3">
                  <div className="flex items-center justify-between font-medium text-sm">
                    <span>Total Discrepancy Amount</span>
                    <span className="font-mono">
                      {formatCurrency(discrepancyTotal)} {currency}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-muted/30 rounded-lg p-4 border">
              <p className="text-sm text-muted-foreground mb-1">Base Amount (Reconciled + Discrepancy)</p>
              <p className="text-2xl font-bold font-mono" data-testid="text-base-amount">
                {formatCurrency(baseAmount)} {currency}
              </p>
            </div>

            <Separator />

            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Post Reconciliation Adjustments</h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addAdjustment}
                  data-testid="button-add-adjustment"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Adjustment
                </Button>
              </div>

              {/* Validation Error */}
              {validationError && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 mb-2">
                  <p className="text-sm text-destructive flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    {validationError}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1">
                  <div className="col-span-3">Nature</div>
                  <div className="col-span-3">Reference No</div>
                  <div className="col-span-2">Add/Less</div>
                  <div className="col-span-3">Amount ({currency})</div>
                  <div className="col-span-1"></div>
                </div>

                {localAdjustments.map((adj, index) => {
                  const isDisputeAdjustment = adj.nature === "Open Dispute Adjustments";
                  const isPreset = adj.isPreset === true;
                  
                  return (
                    <div
                      key={adj.id}
                      className="grid grid-cols-12 gap-2 items-center"
                      data-testid={`row-adjustment-${index}`}
                    >
                      {/* Nature - Read-only text for preset rows, editable input for manual rows */}
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

                      {/* Reference Number - Multi-select for disputes, text input for others */}
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
                                    {adj.selectedDisputeIds.length} selected
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
                              value={adj.reference || ""}
                              onChange={(e) => updateAdjustment(adj.id, "reference", e.target.value)}
                              className="h-8"
                              data-testid={`input-reference-${index}`}
                            />
                          </ScrollArea>
                        )}
                      </div>

                      {/* Add/Less - Locked to "Less" for dispute adjustments */}
                      <div className="col-span-2">
                        <Select
                          value={adj.type}
                          onValueChange={(v) => updateAdjustment(adj.id, "type", v as "add" | "less")}
                          disabled={isDisputeAdjustment}
                        >
                          <SelectTrigger 
                            className={`h-8 ${isDisputeAdjustment ? "opacity-70" : ""}`} 
                            data-testid={`select-type-${index}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="add">Add</SelectItem>
                            <SelectItem value="less">Less</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Amount - Editable for dispute adjustments with max validation */}
                        <div className="col-span-3">
                          {isDisputeAdjustment ? (
                            <div className="space-y-1">
                              <Input
                                type="number"
                                placeholder={adj.selectedDisputeIds && adj.selectedDisputeIds.length > 0 ? "0.00" : "Select DID first"}
                                min="0"
                                max={adj.maxDisputeAmount || 0}
                                step="0.01"
                                value={adj.amount || ""}
                                onChange={(e) => {
                                  const value = parseFloat(e.target.value) || 0;
                                  updateDisputeAdjustmentAmount(adj.id, value);
                                }}
                                className="font-mono h-8"
                                disabled={!adj.selectedDisputeIds || adj.selectedDisputeIds.length === 0}
                                data-testid={`input-amount-${index}`}
                              />
                              {adj.maxDisputeAmount && adj.maxDisputeAmount > 0 && (
                                <p className="text-[10px] text-muted-foreground">
                                  Max: {formatCurrency(adj.maxDisputeAmount)} {currency}
                                </p>
                              )}
                            </div>
                          ) : (
                            <Input
                              type="number"
                              placeholder="0.00"
                              value={adj.amount || ""}
                              onChange={(e) => updateAdjustment(adj.id, "amount", parseFloat(e.target.value) || 0)}
                              className="font-mono h-8"
                              data-testid={`input-amount-${index}`}
                            />
                          )}
                        </div>

                        {/* Remove Button - Only show for manually added rows */}
                        <div className="col-span-1 flex justify-center">
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
        </div>

        <DialogFooter className="gap-2 pt-4 border-t flex-shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">
            Cancel
          </Button>
          <Button onClick={handleApply} data-testid="button-apply">
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
