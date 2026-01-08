import { Check, Loader2, Circle, AlertCircle } from "lucide-react";
import type { ProgressStep } from "@shared/schema";

interface ProgressStepsProps {
  steps: ProgressStep[];
}

export function ProgressSteps({ steps }: ProgressStepsProps) {
  return (
    <div className="space-y-4">
      {steps.map((step, idx) => (
        <div key={step.id} className="flex items-start gap-4">
          <div className="flex flex-col items-center">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center ${
                step.status === "completed"
                  ? "bg-chart-2 text-white"
                  : step.status === "active"
                  ? "bg-primary text-primary-foreground"
                  : step.status === "error"
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {step.status === "completed" ? (
                <Check className="h-5 w-5" />
              ) : step.status === "active" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : step.status === "error" ? (
                <AlertCircle className="h-5 w-5" />
              ) : (
                <Circle className="h-5 w-5" />
              )}
            </div>
            {idx < steps.length - 1 && (
              <div
                className={`w-0.5 h-8 ${
                  step.status === "completed" ? "bg-chart-2" : "bg-muted"
                }`}
              />
            )}
          </div>
          <div className="pt-2">
            <p
              className={`font-medium ${
                step.status === "active"
                  ? "text-foreground"
                  : step.status === "completed"
                  ? "text-muted-foreground"
                  : step.status === "error"
                  ? "text-destructive"
                  : "text-muted-foreground"
              }`}
            >
              {step.label}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
