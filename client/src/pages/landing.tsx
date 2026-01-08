import { useLocation } from "wouter";
import { Upload, Cog, Download, Clock, ArrowRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { RunRecord } from "@shared/schema";

interface LandingPageProps {
  runs: RunRecord[];
  lastFxRefresh: string | null;
  onStartDemo: () => void;
}

const steps = [
  {
    number: 1,
    title: "Upload",
    description: "Import your reconciliation reports and supplier invoices in XLSX or CSV format",
    icon: Upload,
  },
  {
    number: 2,
    title: "Run",
    description: "Automated column mapping, FX conversion, and discrepancy detection",
    icon: Cog,
  },
  {
    number: 3,
    title: "Export",
    description: "Download summaries, draft messages, and DRI-ready reports",
    icon: Download,
  },
];

export function LandingPage({ runs, lastFxRefresh, onStartDemo }: LandingPageProps) {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-full">
      <section className="py-16 px-8 text-center bg-gradient-to-b from-accent/30 to-background">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-5xl font-bold mb-4 tracking-tight">
            Headout Recon Automation
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Streamline your booking reconciliation workflow with automated discrepancy detection, 
            smart categorization, and ready-to-send draft messages.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Button
              size="lg"
              onClick={() => setLocation("/upload")}
              className="px-8"
              data-testid="button-start-reconciliation"
            >
              Start Reconciliation
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={onStartDemo}
              data-testid="button-try-demo"
            >
              <Play className="mr-2 h-5 w-5" />
              Try Demo with Sample File
            </Button>
          </div>
        </div>
      </section>

      <section className="py-16 px-8">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-semibold text-center mb-12">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {steps.map((step, idx) => (
              <div key={step.number} className="relative">
                <Card className="h-full">
                  <CardContent className="pt-8 pb-6 text-center">
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                      <step.icon className="h-8 w-8 text-primary" />
                    </div>
                    <Badge variant="secondary" className="mb-4">
                      Step {step.number}
                    </Badge>
                    <h3 className="text-xl font-semibold mb-2">{step.title}</h3>
                    <p className="text-muted-foreground">{step.description}</p>
                  </CardContent>
                </Card>
                {idx < steps.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-4 transform -translate-y-1/2 z-10">
                    <ArrowRight className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-8 bg-muted/30">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Recent Runs
              </CardTitle>
            </CardHeader>
            <CardContent>
              {runs.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                    <Clock className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <p className="text-muted-foreground mb-2">No runs yet</p>
                  <p className="text-sm text-muted-foreground">
                    Start a reconciliation to see your run history here
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {runs.slice(0, 5).map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between p-4 rounded-lg bg-background border hover-elevate cursor-pointer"
                      onClick={() => setLocation("/results")}
                      data-testid={`run-card-${run.id}`}
                    >
                      <div>
                        <p className="font-medium">{run.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(run.createdAt).toLocaleDateString()} · {run.totalBookings} bookings
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge
                          variant={
                            run.status === "done"
                              ? "outline"
                              : run.status === "error"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {run.status}
                        </Badge>
                        {run.totalDiscrepancyUsd !== null && (
                          <span className="font-mono text-sm">
                            ${run.totalDiscrepancyUsd.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="py-8 px-8 border-t">
        <div className="max-w-4xl mx-auto flex items-center justify-between text-sm text-muted-foreground">
          <span>Headout Recon Automation v1.0.0</span>
          {lastFxRefresh && (
            <span>Last FX refresh: {new Date(lastFxRefresh).toLocaleString()}</span>
          )}
        </div>
      </footer>
    </div>
  );
}
