import { useState, useCallback, useMemo } from "react";
import { Plus, Trash2, Calculator } from "lucide-react";
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

export interface Adjustment {
  id: string;
  nature: string;
  type: "add" | "less";
  amount: number;
}

interface AmountPayableModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseAmount: number;
  adjustments: Adjustment[];
  onAdjustmentsChange: (adjustments: Adjustment[]) => void;
}

export function AmountPayableModal({
  open,
  onOpenChange,
  baseAmount,
  adjustments,
  onAdjustmentsChange,
}: AmountPayableModalProps) {
  const [localAdjustments, setLocalAdjustments] = useState<Adjustment[]>(adjustments);

  const handleOpen = useCallback((isOpen: boolean) => {
    if (isOpen) {
      setLocalAdjustments(adjustments);
    }
    onOpenChange(isOpen);
  }, [adjustments, onOpenChange]);

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

  const finalAmount = useMemo(() => {
    return localAdjustments.reduce((total, adj) => {
      if (adj.type === "add") {
        return total + adj.amount;
      } else {
        return total - adj.amount;
      }
    }, baseAmount);
  }, [baseAmount, localAdjustments]);

  const handleApply = useCallback(() => {
    onAdjustmentsChange(localAdjustments);
    onOpenChange(false);
  }, [localAdjustments, onAdjustmentsChange, onOpenChange]);

  const formatCurrency = (value: number) => {
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Amount Payable Calculator
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="bg-muted/50 rounded-lg p-4">
            <p className="text-sm text-muted-foreground mb-1">Amount Payable for Bookings Reconciled</p>
            <p className="text-2xl font-bold font-mono" data-testid="text-base-amount">
              {formatCurrency(baseAmount)}
            </p>
          </div>

          <Separator />

          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">Post Reconciliation Adjustments</h3>
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
              <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
                <p>No adjustments added yet</p>
                <p className="text-sm">Click "Add Adjustment" to add post-reconciliation adjustments</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-12 gap-2 text-sm font-medium text-muted-foreground px-1">
                  <div className="col-span-5">Nature of Adjustment</div>
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
                        placeholder="e.g., Credit Note, Late Fee"
                        value={adj.nature}
                        onChange={(e) => updateAdjustment(adj.id, "nature", e.target.value)}
                        data-testid={`input-nature-${index}`}
                      />
                    </div>
                    <div className="col-span-2">
                      <Select
                        value={adj.type}
                        onValueChange={(v) => updateAdjustment(adj.id, "type", v as "add" | "less")}
                      >
                        <SelectTrigger data-testid={`select-type-${index}`}>
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
                        className="font-mono"
                        data-testid={`input-amount-${index}`}
                      />
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeAdjustment(adj.id)}
                        className="text-destructive hover:text-destructive"
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
              {formatCurrency(finalAmount)}
            </p>
            {localAdjustments.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Base ({formatCurrency(baseAmount)}) 
                {localAdjustments.map((adj) => (
                  <span key={adj.id}>
                    {adj.type === "add" ? " + " : " - "}
                    {formatCurrency(adj.amount)}
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">
            Cancel
          </Button>
          <Button onClick={handleApply} data-testid="button-apply">
            Apply Adjustments
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
