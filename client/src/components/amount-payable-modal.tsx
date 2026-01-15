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
import { ScrollArea } from "@/components/ui/scroll-area";
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
  const [expandedTids, setExpandedTids] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setLocalAdjustments(adjustments);
      setLocalSelections(finalNetSelections);
    }
  }, [open, adjustments, finalNetSelections]);

  const reconciledBookings = useMemo(() => 
    bookings.filter(b => b.reason === "Reconciled"), 
    [bookings]
  );

  const discrepancyBookings = useMemo(() => 
    bookings.filter(b => b.reason !== "Reconciled"), 
    [bookings]
  );

  const bookingsByTid = useMemo(() => {
    const grouped: Record<string, BookingForPayable[]> = {};
    for (const b of discrepancyBookings) {
      if (!grouped[b.tid]) grouped[b.tid] = [];
      grouped[b.tid].push(b);
    }
    return grouped;
  }, [discrepancyBookings]);

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

  const updateTidSelection = useCallback((tid: string, value: "ho" | "sp") => {
    const tidBookings = bookingsByTid[tid] || [];
    setLocalSelections(prev => {
      const updated = { ...prev };
      for (const b of tidBookings) {
        updated[b.bookingId] = value;
      }
      return updated;
    });
  }, [bookingsByTid]);

  const toggleTid = useCallback((tid: string) => {
    setExpandedTids(prev => {
      const next = new Set(prev);
      if (next.has(tid)) {
        next.delete(tid);
      } else {
        next.add(tid);
      }
      return next;
    });
  }, []);

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
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Amount Payable Calculator - {currency}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
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
                    <p className="text-sm font-medium">Discrepancy Bookings</p>
                    <p className="text-xs text-muted-foreground">
                      Select HO Net or SP Net as Final Net for each booking
                    </p>
                  </div>
                  <Badge variant="outline">{discrepancyBookings.length} bookings</Badge>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                    <div className="col-span-3">TID / Booking ID</div>
                    <div className="col-span-2 text-right">HO Net</div>
                    <div className="col-span-2 text-right">SP Net</div>
                    <div className="col-span-3 text-center">Final Net</div>
                    <div className="col-span-2 text-right">Final Price</div>
                  </div>

                  <div className="max-h-64 overflow-y-auto">
                    {Object.entries(bookingsByTid).map(([tid, tidBookings]) => (
                      <Collapsible
                        key={tid}
                        open={expandedTids.has(tid)}
                        onOpenChange={() => toggleTid(tid)}
                      >
                        <div className="border-t">
                          <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/30 items-center">
                            <div className="col-span-3 flex items-center gap-2">
                              <CollapsibleTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6">
                                  {expandedTids.has(tid) ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </Button>
                              </CollapsibleTrigger>
                              <span className="font-medium text-sm truncate" title={tid}>
                                {tid}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                {tidBookings.length}
                              </Badge>
                            </div>
                            <div className="col-span-2 text-right font-mono text-sm">
                              {formatCurrency(tidBookings.reduce((s, b) => s + b.hoNet, 0))}
                            </div>
                            <div className="col-span-2 text-right font-mono text-sm">
                              {formatCurrency(tidBookings.reduce((s, b) => s + b.spNet, 0))}
                            </div>
                            <div className="col-span-3 flex justify-center">
                              <Select
                                value=""
                                onValueChange={(v) => updateTidSelection(tid, v as "ho" | "sp")}
                              >
                                <SelectTrigger className="w-28 h-7 text-xs" data-testid={`select-tid-${tid}`}>
                                  <SelectValue placeholder="Bulk set" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="ho">All HO Net</SelectItem>
                                  <SelectItem value="sp">All SP Net</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="col-span-2 text-right font-mono text-sm font-medium">
                              {formatCurrency(tidBookings.reduce((s, b) => s + getFinalNetPrice(b), 0))}
                            </div>
                          </div>

                          <CollapsibleContent>
                            {tidBookings.map((booking) => (
                              <div
                                key={booking.bookingId}
                                className="grid grid-cols-12 gap-2 px-3 py-1.5 border-t border-dashed items-center text-sm"
                                data-testid={`row-booking-${booking.bookingId}`}
                              >
                                <div className="col-span-3 pl-8 truncate text-muted-foreground" title={booking.bookingId}>
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
                                    <SelectTrigger className="w-24 h-7 text-xs" data-testid={`select-booking-${booking.bookingId}`}>
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

                  <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/50 border-t font-medium text-sm">
                    <div className="col-span-7">Discrepancy Subtotal</div>
                    <div className="col-span-5 text-right font-mono">
                      {formatCurrency(discrepancyTotal)} {currency}
                    </div>
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
        </ScrollArea>

        <DialogFooter className="gap-2 pt-4 border-t">
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
