import { useState } from "react";
import { Copy, Download, MessageSquare, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import type { DraftMessage } from "@shared/schema";

interface DraftsPageProps {
  draftMessages: DraftMessage[];
  hasResults: boolean;
}

function MessageCard({ message }: { message: DraftMessage }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.body);
    setCopied(true);
    toast({ title: "Copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    const blob = new Blob([message.body], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${message.driTeam}-${message.category}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getBorderColor = () => {
    switch (message.driTeam) {
      case "Tech":
      case "Supply":
        return "border-l-chart-1";
      case "Selenium":
        return "border-l-chart-2";
      case "Reservation Ops":
        return "border-l-chart-3";
      case "Inventory Ops":
        return "border-l-chart-4";
      case "Finance":
        return "border-l-chart-5";
      default:
        return "border-l-muted";
    }
  };

  return (
    <Card className={`border-l-4 ${getBorderColor()}`} data-testid={`draft-card-${message.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary">{message.driTeam}</Badge>
            <Badge variant="outline">{message.category}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCopy}
              data-testid={`button-copy-${message.id}`}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleExport}
              data-testid={`button-export-${message.id}`}
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <CardTitle className="text-base">{message.subject}</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="font-mono text-sm whitespace-pre-wrap bg-muted/50 p-4 rounded-lg overflow-x-auto">
          {message.body}
        </pre>
        <div className="flex items-center gap-4 mt-4 text-sm text-muted-foreground">
          <span>{message.bookingCount} booking(s)</span>
          <span>·</span>
          <span className="font-mono">
            ${message.totalDiscrepancyUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export function DraftsPage({ draftMessages, hasResults }: DraftsPageProps) {
  if (!hasResults) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-8">
        <EmptyState
          icon={MessageSquare}
          title="No draft messages"
          description="Run a reconciliation to generate draft messages for each DRI team"
        />
      </div>
    );
  }

  const mtbMessages = draftMessages.filter((m) => m.category.startsWith("MTB"));
  const chargeLossMessages = draftMessages.filter((m) => m.category.startsWith("Charge Loss"));
  const npdMessages = draftMessages.filter((m) => m.category.startsWith("NPD"));

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Draft Messages</h1>
        <p className="text-muted-foreground">
          Ready-to-send messages for each DRI team
        </p>
      </div>

      <Tabs defaultValue="mtb">
        <TabsList className="mb-6">
          <TabsTrigger value="mtb" data-testid="tab-mtb-drafts">
            MTB ({mtbMessages.length})
          </TabsTrigger>
          <TabsTrigger value="chargeloss" data-testid="tab-chargeloss-drafts">
            Charge Loss ({chargeLossMessages.length})
          </TabsTrigger>
          <TabsTrigger value="npd" data-testid="tab-npd-drafts">
            NPD ({npdMessages.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mtb">
          <div className="space-y-4">
            {mtbMessages.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  No MTB messages to display
                </CardContent>
              </Card>
            ) : (
              mtbMessages.map((msg) => <MessageCard key={msg.id} message={msg} />)
            )}
          </div>
        </TabsContent>

        <TabsContent value="chargeloss">
          <div className="space-y-4">
            {chargeLossMessages.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  No Charge Loss messages to display
                </CardContent>
              </Card>
            ) : (
              chargeLossMessages.map((msg) => <MessageCard key={msg.id} message={msg} />)
            )}
          </div>
        </TabsContent>

        <TabsContent value="npd">
          <div className="space-y-4">
            {npdMessages.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  No NPD messages to display
                </CardContent>
              </Card>
            ) : (
              npdMessages.map((msg) => <MessageCard key={msg.id} message={msg} />)
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
