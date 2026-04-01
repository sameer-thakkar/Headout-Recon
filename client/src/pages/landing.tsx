import { useLocation } from "wouter";
import { Upload, Cog, Download, Clock, ArrowRight, Play, Database, Trash2, Bookmark, BookmarkCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { ReconciliationSession } from "@shared/schema";
import { VendorBalancesSection } from "@/components/vendor-balances-section";
import { PortalReloadsSection } from "@/components/portal-reloads-section";
import { PaxTypesSection } from "@/components/pax-types-section";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface LandingPageProps {
  lastFxRefresh: string | null;
  onStartDemo: () => void;
  onLoadSession?: (session: ReconciliationSession) => void;
  savedSessionIds?: Set<string>;
  onToggleSave?: (sessionId: string) => void;
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

export function LandingPage({ lastFxRefresh, onStartDemo, onLoadSession, savedSessionIds, onToggleSave }: LandingPageProps) {
  const [, setLocation] = useLocation();

  const { data: sessionsData, isLoading: isLoadingSessions } = useQuery<{ sessions: ReconciliationSession[] }>({
    queryKey: ["/api/sessions"],
  });

  const sessions = sessionsData?.sessions || [];

  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      await apiRequest("DELETE", `/api/sessions/${sessionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
    },
  });

  const handleLoadSession = (session: ReconciliationSession) => {
    if (onLoadSession) {
      onLoadSession(session);
    }
    setLocation("/discrepancy-analysis");
  };

  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this session?")) {
      deleteSessionMutation.mutate(sessionId);
    }
  };

  const handleToggleSave = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    onToggleSave?.(sessionId);
  };

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

      <VendorBalancesSection />

      <PortalReloadsSection />

      <PaxTypesSection />

      <section className="py-16 px-8 bg-muted/30">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Recent Sessions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingSessions ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">Loading sessions…</p>
                </div>
              ) : sessions.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                    <Database className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <p className="text-muted-foreground mb-2">No sessions yet</p>
                  <p className="text-sm text-muted-foreground">
                    Upload files to start your first reconciliation
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {sessions.slice(0, 10).map((session) => {
                    const isSaved = savedSessionIds?.has(session.id);
                    return (
                      <div
                        key={session.id}
                        className="flex items-center justify-between p-4 rounded-lg bg-background border hover-elevate cursor-pointer"
                        onClick={() => handleLoadSession(session)}
                        data-testid={`session-card-${session.id}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {isSaved && (
                            <BookmarkCheck className="h-4 w-4 text-primary flex-shrink-0" aria-hidden="true" />
                          )}
                          <div className="min-w-0">
                            <p className="font-medium truncate">{session.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {new Date(session.createdAt).toLocaleDateString("en-GB")}
                              {session.hoFileName && ` · ${session.hoFileName}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge
                            variant={
                              session.status === "done"
                                ? "outline"
                                : session.status === "error"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {session.status}
                          </Badge>
                          {onToggleSave && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className={isSaved ? "text-primary" : "text-muted-foreground"}
                                  onClick={(e) => handleToggleSave(e, session.id)}
                                  data-testid={`button-save-session-${session.id}`}
                                  aria-label={isSaved ? "Remove from Recon Tracker" : "Save to Recon Tracker"}
                                >
                                  {isSaved ? (
                                    <BookmarkCheck className="h-4 w-4" aria-hidden="true" />
                                  ) : (
                                    <Bookmark className="h-4 w-4" aria-hidden="true" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {isSaved ? "Remove from Recon Tracker" : "Save to Recon Tracker"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={(e) => handleDeleteSession(e, session.id)}
                            data-testid={`button-delete-session-${session.id}`}
                            aria-label="Delete session"
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
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
