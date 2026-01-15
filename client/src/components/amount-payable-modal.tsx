import { useState, useCallback, useMemo, useEffect } from "react";
import { Plus, Trash2, Calculator, ChevronDown, ChevronRight } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export interface Adjustment {
  id: string;
  nature: string;
  type: "add" | "less";
  amount: number;
}

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
}

export function AmountPayableModal({
  open,
  onOpenChange,
  bookings,
  currency,
  adjustments,
  finalNetSelections,
  onApply,
}: AmountPayableModalProps) {
  const [localAdjustments, setLocalAdjustments] = useState<Adjustment[]>(adjustments);
  const [localSelections, setLocalSelections] = useState<FinalNetSelection>(finalNetSelections);
  const [expandedReasons, setExpandedReasons] = useState<Set<string>>(new Set());
  const [expandedTids, setExpandedTids] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setLocalAdjustments(adjustments);
      setLocalSelections(finalNetSelections);
      setExpandedReasons(new Set());
      setExpandedTids(new Set());
    }
  }, [open, adjustments, finalNetSelections]);

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
    return localAdjustments.reduce((total, adj) => {
      if (adj.type === "add") {
        return total + adj.amount;
      } else {
        return total - adj.amount;
      }
    }, baseAmount);
  }, [baseAmount, localAdjustments]);

  const updateSelection = useCallback((bookingId: string, value: "ho" | "sp") => {
    setLocalSelections(prev => ({ ...prev, [bookingId]: value }));
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
  }, [bookingsByReasonAndTid]);

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

  const getReasonTotal = useCallback((reason: string): number => {
    const reasonBookings = bookingsByReason[reason] || [];
    return reasonBookings.reduce((sum, b) => sum + getFinalNetPrice(b), 0);
  }, [bookingsByReason, getFinalNetPrice]);

  const addAdjustment = useCallback(() => {
    const newAdj: Adjustment = {
      id: crypto.randomUUID(),
      nature: "",
      type: "add",
      amount: 0,
    };
    setLocalAdjustments((prev) => [...prev, newAdj]);
  }, []);

  const removeAdjustment = useCallback((id: string) => {
    setLocalAdjustments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const updateAdjustment = useCallback((id: string, field: keyof Adjustment, value: string | number) => {
    setLocalAdjustments((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, [field]: value } : a
      )
    );
  }, []);

  const handleApply = useCallback(() => {
    onApply(localAdjustments, localSelections, finalAmount);
    onOpenChange(false);
  }, [localAdjustments, localSelections, finalAmount, onApply, onOpenChange]);

  const formatCurrency = (value: number) => {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
                            <div className="col-span-3 flex justify-center">
                              <Select
                                value=""
                                onValueChange={(v) => updateReasonSelection(reason, v as "ho" | "sp")}
                              >
                                <SelectTrigger className="w-28 h-7 text-xs" data-testid={`select-reason-${reason}`}>
                                  <SelectValue placeholder="Bulk set all" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="ho">All HO Net</SelectItem>
                                  <SelectItem value="sp">All SP Net</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="col-span-5 text-right font-mono text-sm font-semibold">
                              {formatCurrency(reasonTotal)} {currency}
                            </div>
                          </div>

                          <CollapsibleContent>
                            <div className="grid grid-cols-12 gap-2 px-3 py-1.5 bg-muted/30 text-xs font-medium text-muted-foreground border-t">
                              <div className="col-span-3">TID / Booking ID</div>
                              <div className="col-span-2 text-right">HO Net</div>
                              <div className="col-span-2 text-right">SP Net</div>
                              <div className="col-span-3 text-center">Final Net</div>
                              <div className="col-span-2 text-right">Final Price</div>
                            </div>

                            <div>
                              {Object.entries(tidGroups).map(([tid, tidBookings]) => (
                                <Collapsible
                                  key={tid}
                                  open={expandedTids.has(tidKey(tid))}
                                  onOpenChange={() => toggleTid(tidKey(tid))}
                                >
                                  <div className="border-t">
                                    <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-background items-center">
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
                                      <div className="col-span-3 flex justify-center">
                                        <Select
                                          value=""
                                          onValueChange={(v) => updateTidSelection(reason, tid, v as "ho" | "sp")}
                                        >
                                          <SelectTrigger className="w-24 h-6 text-xs" data-testid={`select-tid-${reason}-${tid}`}>
                                            <SelectValue placeholder="Bulk set" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="ho">All HO Net</SelectItem>
                                            <SelectItem value="sp">All SP Net</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <div className="col-span-2 text-right font-mono text-xs font-medium">
                                        {formatCurrency(tidBookings.reduce((s, b) => s + getFinalNetPrice(b), 0))}
                                      </div>
                                    </div>

                                    <CollapsibleContent>
                                      {tidBookings.map((booking) => (
                                        <div
                                          key={booking.bookingId}
                                          className="grid grid-cols-12 gap-2 px-3 py-1 border-t border-dashed items-center text-xs"
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
                                          <div className="col-span-3 flex justify-center">
                                            <Select
                                              value={getSelection(booking.bookingId, booking.reason)}
                                              onValueChange={(v) => updateSelection(booking.bookingId, v as "ho" | "sp")}
                                            >
                                              <SelectTrigger className="w-20 h-5 text-xs" data-testid={`select-booking-${booking.bookingId}`}>
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="ho">HO Net</SelectItem>
                                                <SelectItem value="sp">SP Net</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </div>
                                          <div className="col-span-2 text-right font-mono font-medium">
                                            {formatCurrency(getFinalNetPrice(booking))}
                                          </div>
                                        </div>
                                      ))}
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

              {localAdjustments.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground border rounded-lg border-dashed">
                  <p className="text-sm">No adjustments added</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1">
                    <div className="col-span-5">Nature</div>
                    <div className="col-span-2">Add/Less</div>
                    <div className="col-span-4">Amount</div>
                    <div className="col-span-1"></div>
                  </div>

                  {localAdjustments.map((adj, index) => (
                    <div
                      key={adj.id}
                      className="grid grid-cols-12 gap-2 items-center"
                      data-testid={`row-adjustment-${index}`}
                    >
                      <div className="col-span-5">
                        <Input
                          placeholder="e.g., Credit Note"
                          value={adj.nature}
                          onChange={(e) => updateAdjustment(adj.id, "nature", e.target.value)}
                          className="h-8"
                          data-testid={`input-nature-${index}`}
                        />
                      </div>
                      <div className="col-span-2">
                        <Select
                          value={adj.type}
                          onValueChange={(v) => updateAdjustment(adj.id, "type", v as "add" | "less")}
                        >
                          <SelectTrigger className="h-8" data-testid={`select-type-${index}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="add">Add</SelectItem>
                            <SelectItem value="less">Less</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-4">
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={adj.amount || ""}
                          onChange={(e) => updateAdjustment(adj.id, "amount", parseFloat(e.target.value) || 0)}
                          className="font-mono h-8"
                          data-testid={`input-amount-${index}`}
                        />
                      </div>
                      <div className="col-span-1 flex justify-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeAdjustment(adj.id)}
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          data-testid={`button-remove-${index}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
