import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/queryClient";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, Shield, ShieldCheck, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ValidationCheck {
  id: string;
  name: string;
  category: string;
  severity: "critical" | "warning";
  status: "pass" | "fail" | "warning" | "running";
  message: string;
  details?: any;
}

interface ValidationSummary {
  total: number;
  passed: number;
  warnings: number;
  criticalFails: number;
  canProceed: boolean;
}

interface ValidationModalProps {
  open: boolean;
  onClose: () => void;
  onProceed: () => void;
  runId: string;
  exportFormat: "excel" | "gsheet";
}

export function ValidationModal({ open, onClose, onProceed, runId, exportFormat }: ValidationModalProps) {
  const [checks, setChecks] = useState<ValidationCheck[]>([]);
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState<Set<string>>(new Set());
  const [currentCheckIndex, setCurrentCheckIndex] = useState(0);

  const runValidation = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setChecks([]);
    setSummary(null);
    setAcknowledgedWarnings(new Set());
    setCurrentCheckIndex(0);

    try {
      const response = await authFetch(`/api/runs/${runId}/validate-financial`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Validation failed");
      }
      const data = await response.json();

      const serverChecks: ValidationCheck[] = data.checks;
      const animatedChecks: ValidationCheck[] = serverChecks.map(c => ({
        ...c,
        status: "running" as const,
      }));
      setChecks(animatedChecks);

      for (let i = 0; i < serverChecks.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 150));
        setCurrentCheckIndex(i);
        setChecks(prev => prev.map((c, idx) =>
          idx === i ? { ...c, status: serverChecks[i].status } : c
        ));
      }

      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setIsLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (open && runId) {
      runValidation();
    }
  }, [open, runId, runValidation]);

  const toggleWarningAcknowledgment = (checkId: string) => {
    setAcknowledgedWarnings(prev => {
      const next = new Set(prev);
      if (next.has(checkId)) {
        next.delete(checkId);
      } else {
        next.add(checkId);
      }
      return next;
    });
  };

  const warningChecks = checks.filter(c => c.status === "warning");
  const allWarningsAcknowledged = warningChecks.length === 0 || warningChecks.every(c => acknowledgedWarnings.has(c.id));
  const canProceed = summary?.canProceed && allWarningsAcknowledged && !isLoading;

  const getStatusIcon = (check: ValidationCheck) => {
    if (check.status === "running") {
      return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" data-testid={`icon-running-${check.id}`} />;
    }
    if (check.status === "pass") {
      return <CheckCircle2 className="h-4 w-4 text-green-500" data-testid={`icon-pass-${check.id}`} />;
    }
    if (check.status === "fail") {
      return <XCircle className="h-4 w-4 text-red-500" data-testid={`icon-fail-${check.id}`} />;
    }
    return <AlertTriangle className="h-4 w-4 text-amber-500" data-testid={`icon-warning-${check.id}`} />;
  };

  const categories = ["Data Completeness", "Data Integrity", "Review Completeness", "Financial Sanity"];
  const groupedChecks = categories.map(cat => ({
    category: cat,
    checks: checks.filter(c => c.category === cat),
  })).filter(g => g.checks.length > 0);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="validation-modal">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {!summary ? (
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Shield className="h-5 w-5 text-primary" />
              </div>
            ) : summary.criticalFails > 0 ? (
              <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                <ShieldAlert className="h-5 w-5 text-red-500" />
              </div>
            ) : (
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-green-500" />
              </div>
            )}
            <div>
              <DialogTitle data-testid="text-validation-title">Pre-Export Validation</DialogTitle>
              <DialogDescription>
                Running checks before generating the{" "}
                {exportFormat === "excel" ? "Excel" : "Google Sheets"} report
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300" data-testid="text-validation-error">
            {error}
          </div>
        )}

        <ScrollArea className="max-h-[400px] pr-2">
          <div className="space-y-4">
            {groupedChecks.map(group => (
              <div key={group.category}>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2" data-testid={`text-category-${group.category.replace(/\s/g, '-').toLowerCase()}`}>
                  {group.category}
                </p>
                <div className="space-y-1.5">
                  {group.checks.map((check) => (
                    <div
                      key={check.id}
                      className={`flex items-start gap-3 p-2.5 rounded-lg border transition-all duration-300 ${
                        check.status === "running"
                          ? "border-border bg-muted/30"
                          : check.status === "pass"
                          ? "border-green-200 dark:border-green-800/50 bg-green-50/50 dark:bg-green-900/10"
                          : check.status === "fail"
                          ? "border-red-200 dark:border-red-800/50 bg-red-50/50 dark:bg-red-900/10"
                          : "border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-900/10"
                      }`}
                      data-testid={`validation-check-${check.id}`}
                    >
                      <div className="mt-0.5 shrink-0">
                        {getStatusIcon(check)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium" data-testid={`text-check-name-${check.id}`}>{check.name}</span>
                          {check.status !== "running" && (
                            <Badge
                              variant={check.severity === "critical" ? "destructive" : "secondary"}
                              className="text-[10px] px-1.5 py-0"
                              data-testid={`badge-severity-${check.id}`}
                            >
                              {check.severity}
                            </Badge>
                          )}
                        </div>
                        {check.status !== "running" && (
                          <p className="text-xs text-muted-foreground mt-0.5" data-testid={`text-check-message-${check.id}`}>
                            {check.message}
                          </p>
                        )}
                        {check.status === "warning" && (
                          <div className="flex items-center gap-2 mt-2">
                            <Checkbox
                              id={`ack-${check.id}`}
                              checked={acknowledgedWarnings.has(check.id)}
                              onCheckedChange={() => toggleWarningAcknowledgment(check.id)}
                              data-testid={`checkbox-ack-${check.id}`}
                            />
                            <label
                              htmlFor={`ack-${check.id}`}
                              className="text-xs text-muted-foreground cursor-pointer select-none"
                            >
                              I've reviewed this and it's okay to proceed
                            </label>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {summary && (
          <div className={`flex items-center gap-3 p-3 rounded-lg border ${
            summary.criticalFails > 0
              ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20"
              : summary.warnings > 0
              ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20"
              : "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20"
          }`} data-testid="validation-summary">
            <div className="flex-1">
              <div className="flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  <span data-testid="text-passed-count">{summary.passed} passed</span>
                </span>
                {summary.warnings > 0 && (
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <span data-testid="text-warnings-count">{summary.warnings} warnings</span>
                  </span>
                )}
                {summary.criticalFails > 0 && (
                  <span className="flex items-center gap-1.5">
                    <XCircle className="h-3.5 w-3.5 text-red-500" />
                    <span data-testid="text-fails-count">{summary.criticalFails} failed</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-validation">
            Cancel
          </Button>
          {summary?.criticalFails ? (
            <Button variant="outline" onClick={onClose} data-testid="button-go-back-fix">
              Go Back & Fix
            </Button>
          ) : (
            <Button
              onClick={onProceed}
              disabled={!canProceed}
              data-testid="button-proceed-export"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Validating...
                </span>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  Proceed to Export
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
