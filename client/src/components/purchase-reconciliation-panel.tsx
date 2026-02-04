import { useMemo } from "react";
import { Calculator, TrendingUp, TrendingDown, ArrowRight, Minus, Plus, Wallet } from "lucide-react";
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
import type { PrimaryRow } from "@shared/schema";

interface PurchaseReconciliationPanelProps {
  primaryRows: PrimaryRow[];
  currency: string;
  billingEntityName: string;
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
  onClose,
}: PurchaseReconciliationPanelProps) {
  const calculations = useMemo(() => {
    const openingBalance = 10000;
    const reloads = 10000;
    const closingBalance = 10000;
    
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
  }, [primaryRows]);

  const lineItems = [
    {
      id: 1,
      label: "Opening Balance",
      value: calculations.openingBalance,
      description: "Fetched from backend (BE ID level)",
      icon: Wallet,
      isPlaceholder: true,
    },
    {
      id: 2,
      label: "Reloads",
      value: calculations.reloads,
      description: "Fetched from backend (BE ID level)",
      icon: Plus,
      isPlaceholder: true,
    },
    {
      id: 3,
      label: "Refunds",
      value: calculations.refunds,
      description: "SP Invoice negative values",
      icon: Minus,
      isPlaceholder: false,
    },
    {
      id: 4,
      label: "Closing Balance",
      value: calculations.closingBalance,
      description: "Fetched from backend (BE ID level)",
      icon: Wallet,
      isPlaceholder: true,
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
        <Badge variant="secondary" className="text-xs">
          PORTAL_DEPOSIT
        </Badge>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <span>{billingEntityName || "Supplier"}</span>
          </CardTitle>
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
                        {item.isPlaceholder && (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                            Placeholder
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className={`py-2 text-right font-mono ${isNegative ? "text-red-600 dark:text-red-400" : isPositive && item.isHighlight ? "text-green-600 dark:text-green-400" : ""}`}>
                      {formatNumber(item.value)}
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
