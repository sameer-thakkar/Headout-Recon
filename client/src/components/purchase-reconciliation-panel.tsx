import { useMemo, useState } from "react";
import { Calculator, TrendingUp, TrendingDown, ArrowRight, Minus, Plus, Wallet, Save, Edit2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PrimaryRow, VendorBalance } from "@shared/schema";

interface PurchaseReconciliationPanelProps {
  primaryRows: PrimaryRow[];
  currency: string;
  billingEntityName: string;
  beId: string;
  onClose: () => void;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function PurchaseReconciliationPanel({
  primaryRows,
  currency,
  billingEntityName,
  beId,
  onClose,
}: PurchaseReconciliationPanelProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState({
    openingBalance: 0,
    reloads: 0,
    closingBalance: 0,
  });

  const { data: balanceData, isLoading: isLoadingBalance } = useQuery<{ balance: VendorBalance | null }>({
    queryKey: ['/api/vendor-balances', beId],
    enabled: !!beId,
  });

  const saveMutation = useMutation({
    mutationFn: async (values: { openingBalance: number; reloads: number; closingBalance: number }) => {
      return apiRequest('POST', '/api/vendor-balances', {
        beId,
        openingBalance: values.openingBalance,
        reloads: values.reloads,
        closingBalance: values.closingBalance,
        currency,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/vendor-balances', beId] });
      setIsEditing(false);
      toast({
        title: "Balances saved",
        description: "Vendor balances have been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save vendor balances.",
        variant: "destructive",
      });
    },
  });

  const balance = balanceData?.balance;
  const hasBalance = !!balance;

  const handleEdit = () => {
    setEditValues({
      openingBalance: balance?.openingBalance ?? 0,
      reloads: balance?.reloads ?? 0,
      closingBalance: balance?.closingBalance ?? 0,
    });
    setIsEditing(true);
  };

  const handleSave = () => {
    saveMutation.mutate(editValues);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  const calculations = useMemo(() => {
    const openingBalance = balance?.openingBalance ?? 0;
    const reloads = balance?.reloads ?? 0;
    const closingBalance = balance?.closingBalance ?? 0;
    
    const refunds = primaryRows
      .filter(row => row.spNetInHo < 0)
      .reduce((sum, row) => sum + row.spNetInHo, 0);
    
    const computedPurchase = openingBalance + reloads + refunds - closingBalance;
    
    const actualPurchase = primaryRows.reduce((sum, row) => sum + row.spNetInHo, 0);
    
    const timingDifference = computedPurchase - actualPurchase;
    
    const purchasesAsPerHO = primaryRows
      .filter(row => !row.isSecondaryVendor)
      .reduce((sum, row) => sum + row.hoNet, 0);
    
    const difference = purchasesAsPerHO - actualPurchase;
    
    const inSPNotInHO = primaryRows
      .filter(row => row.spNetInHo > row.hoNet)
      .reduce((sum, row) => sum + (row.spNetInHo - row.hoNet), 0);
    
    const inHONotInSP = primaryRows
      .filter(row => row.hoNet > row.spNetInHo)
      .reduce((sum, row) => sum + (row.hoNet - row.spNetInHo), 0);

    const netDifference = difference + inSPNotInHO - inHONotInSP;

    return {
      openingBalance,
      reloads,
      refunds,
      closingBalance,
      computedPurchase,
      actualPurchase,
      timingDifference,
      purchasesAsPerHO,
      difference,
      inSPNotInHO,
      inHONotInSP,
      netDifference,
    };
  }, [primaryRows, balance]);

  const lineItems = [
    {
      id: 1,
      label: "Opening Balance",
      value: isEditing ? editValues.openingBalance : calculations.openingBalance,
      description: hasBalance ? "From database" : "Not configured",
      icon: Wallet,
      isEditable: true,
      editKey: "openingBalance" as const,
    },
    {
      id: 2,
      label: "Reloads",
      value: isEditing ? editValues.reloads : calculations.reloads,
      description: hasBalance ? "From database" : "Not configured",
      icon: Plus,
      isEditable: true,
      editKey: "reloads" as const,
    },
    {
      id: 3,
      label: "Refunds",
      value: calculations.refunds,
      description: "SP Invoice negative values",
      icon: Minus,
      isEditable: false,
    },
    {
      id: 4,
      label: "Closing Balance",
      value: isEditing ? editValues.closingBalance : calculations.closingBalance,
      description: hasBalance ? "From database" : "Not configured",
      icon: Wallet,
      isEditable: true,
      editKey: "closingBalance" as const,
    },
    {
      id: 5,
      label: "Computed Purchase",
      value: calculations.computedPurchase,
      description: "= 1 + 2 + 3 - 4",
      icon: Calculator,
      isFormula: true,
    },
    {
      id: 6,
      label: "Actual Purchase",
      value: calculations.actualPurchase,
      description: "Total from SP Invoice data",
      icon: TrendingUp,
    },
    {
      id: 7,
      label: "Timing Difference in Closing Balance",
      value: calculations.timingDifference,
      description: "= 5 - 6",
      icon: ArrowRight,
      isFormula: true,
    },
    {
      id: 8,
      label: "Purchases as per HO",
      value: calculations.purchasesAsPerHO,
      description: "Total of primary fulfillments (HO Net)",
      icon: TrendingUp,
    },
    {
      id: 9,
      label: "Difference",
      value: calculations.difference,
      description: "= 8 - 6",
      icon: ArrowRight,
      isFormula: true,
      isHighlight: true,
    },
    {
      id: 10,
      label: "In SP data not in HO",
      value: calculations.inSPNotInHO,
      description: "Sum where SP Net > HO Net",
      icon: TrendingDown,
      isReco: true,
    },
    {
      id: 11,
      label: "In HO data not in SP",
      value: calculations.inHONotInSP,
      description: "Sum where HO Net > SP Net",
      icon: TrendingUp,
      isReco: true,
    },
    {
      id: 12,
      label: "Net Difference",
      value: calculations.netDifference,
      description: "= 9 + 10 - 11 (should be 0)",
      icon: Calculator,
      isFormula: true,
      isValidation: true,
    },
  ];

  if (!beId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
          <Wallet className="h-5 w-5 text-amber-600" />
          <span className="text-amber-800 dark:text-amber-200">
            No Billing Entity ID available. Cannot load or save balance data.
          </span>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="button-close-purchase-reco">
            Close
          </Button>
        </div>
      </div>
    );
  }

  if (isLoadingBalance) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading balances...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-primary" />
          <span className="font-semibold">Purchase Reconciliation</span>
          <Badge variant="outline" className="text-xs">
            {currency}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            PORTAL_DEPOSIT
          </Badge>
          {beId && (
            <Badge variant="outline" className="text-xs font-mono">
              BE: {beId}
            </Badge>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <span>{billingEntityName || "Supplier"}</span>
              {!hasBalance && !isEditing && (
                <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                  No balances configured
                </Badge>
              )}
            </CardTitle>
            {!isEditing ? (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleEdit}
                data-testid="button-edit-balances"
              >
                <Edit2 className="h-3 w-3 mr-1" />
                {hasBalance ? "Edit Balances" : "Set Balances"}
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleCancel}
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
                <Button 
                  size="sm" 
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  data-testid="button-save-balances"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3 mr-1" />
                  )}
                  Save
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="h-8">
                <TableHead className="py-1.5 text-xs w-8">#</TableHead>
                <TableHead className="py-1.5 text-xs">Line Item</TableHead>
                <TableHead className="py-1.5 text-xs text-right">Amount ({currency})</TableHead>
                <TableHead className="py-1.5 text-xs">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.map((item) => {
                const IconComponent = item.icon;
                const isNegative = item.value < 0;
                const isPositive = item.value > 0;
                
                return (
                  <TableRow 
                    key={item.id} 
                    className={`h-10 ${item.isHighlight ? "bg-primary/5" : ""} ${item.isReco ? "bg-muted/50" : ""} ${item.isValidation ? (item.value === 0 ? "bg-green-50 dark:bg-green-950/30 border-t-2 border-green-200 dark:border-green-800" : "bg-red-50 dark:bg-red-950/30 border-t-2 border-red-200 dark:border-red-800") : ""}`}
                    data-testid={`purchase-reco-row-${item.id}`}
                  >
                    <TableCell className="py-2 font-mono text-xs text-muted-foreground">
                      {item.id}
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex items-center gap-2">
                        <IconComponent className={`h-4 w-4 ${item.isFormula ? "text-blue-500" : "text-muted-foreground"}`} />
                        <span className={`${item.isHighlight ? "font-semibold" : ""}`}>
                          {item.label}
                        </span>
                        {item.isEditable && !hasBalance && !isEditing && (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                            Not set
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className={`py-2 text-right font-mono ${isNegative ? "text-red-600 dark:text-red-400" : isPositive && item.isHighlight ? "text-green-600 dark:text-green-400" : ""}`}>
                      {isEditing && item.isEditable && item.editKey ? (
                        <Input
                          type="number"
                          value={editValues[item.editKey]}
                          onChange={(e) => setEditValues(prev => ({
                            ...prev,
                            [item.editKey!]: parseFloat(e.target.value) || 0
                          }))}
                          className="w-32 text-right font-mono ml-auto"
                          data-testid={`input-${item.editKey}`}
                        />
                      ) : (
                        formatNumber(item.value)
                      )}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">
                      {item.description}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <Separator className="my-4" />

          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Reconciliation Summary:</span>
              <Badge variant={calculations.netDifference === 0 ? "default" : "destructive"}>
                {calculations.netDifference === 0 ? "Balanced" : "Unbalanced"}
              </Badge>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <span className="text-xs text-muted-foreground">Net Difference (Line 12)</span>
                <p className={`font-mono font-semibold ${calculations.netDifference !== 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                  {formatNumber(calculations.netDifference)} {currency}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end pt-2">
        <Button variant="outline" size="sm" onClick={onClose} data-testid="button-close-purchase-reco">
          Close
        </Button>
      </div>
    </div>
  );
}
