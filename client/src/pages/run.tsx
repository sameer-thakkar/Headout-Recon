import { useState } from "react";
import { useLocation } from "wouter";
import { Play, Columns } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ProgressSteps } from "@/components/progress-steps";
import { EmptyState } from "@/components/empty-state";
import type { ProgressStep } from "@shared/schema";

const defaultSteps: ProgressStep[] = [
  { id: "parse", label: "Parsing files", status: "pending" },
  { id: "fx", label: "Fetching FX rates", status: "pending" },
  { id: "compute", label: "Computing reasons", status: "pending" },
  { id: "summaries", label: "Building summaries", status: "pending" },
  { id: "drafts", label: "Building draft messages", status: "pending" },
  { id: "dri", label: "Building DRI views", status: "pending" },
];

interface RunPageProps {
  onRunReconciliation: (
    onProgress: (stepId: string, status: ProgressStep["status"]) => void
  ) => Promise<void>;
  hasMapping: boolean;
  isProcessing: boolean;
}

export function RunPage({ onRunReconciliation, hasMapping, isProcessing }: RunPageProps) {
  const [, setLocation] = useLocation();
  const [steps, setSteps] = useState<ProgressStep[]>(defaultSteps);
  const [isRunning, setIsRunning] = useState(false);
  const [hasCompleted, setHasCompleted] = useState(false);

  const updateStep = (stepId: string, status: ProgressStep["status"]) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, status } : s))
    );
  };

  const handleRun = async () => {
    setIsRunning(true);
    setHasCompleted(false);
    setSteps(defaultSteps);

    try {
      await onRunReconciliation(updateStep);
      setHasCompleted(true);
    } catch (error) {
      console.error("Reconciliation failed:", error);
    } finally {
      setIsRunning(false);
    }
  };

  if (!hasMapping) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-8">
        <EmptyState
          icon={Columns}
          title="Column mapping required"
          description="Please complete column mapping before running reconciliation"
          action={{
            label: "Go to Mapping",
            onClick: () => setLocation("/mapping"),
          }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Run Reconciliation</h1>
        <p className="text-muted-foreground">
          Process your uploaded files and generate reconciliation results
        </p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Reconciliation Process</CardTitle>
            <CardDescription>
              Click the button below to start processing your files
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              size="lg"
              onClick={handleRun}
              disabled={isRunning || isProcessing}
              className="w-full mb-8"
              data-testid="button-run-reconciliation"
            >
              <Play className="mr-2 h-5 w-5" />
              {isRunning ? "Processing..." : "Run Reconciliation"}
            </Button>

            <ProgressSteps steps={steps} />
          </CardContent>
        </Card>

        {hasCompleted && (
          <Card className="border-chart-2">
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-chart-2/10 flex items-center justify-center mx-auto mb-4">
                  <Play className="h-8 w-8 text-chart-2" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Reconciliation Complete</h3>
                <p className="text-muted-foreground mb-4">
                  Your results are ready to view
                </p>
                <Button
                  onClick={() => setLocation("/discrepancy-analysis")}
                  data-testid="button-view-results"
                >
                  View Discrepancy Analysis
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
