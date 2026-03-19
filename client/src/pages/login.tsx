import { useState } from "react";
import { useLocation } from "wouter";
import { apiRequest, setAuthToken, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Lock, Loader2 } from "lucide-react";

export function LoginPage() {
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/login", { password });
      const data = await res.json();
      if (data.token) setAuthToken(data.token);
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
      setLocation("/");
    } catch {
      setError("Incorrect password. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
            <Lock className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Headout Recon</h1>
            <p className="text-sm text-muted-foreground mt-1">Internal reconciliation tool</p>
          </div>
        </div>
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Sign in</CardTitle>
            <CardDescription>Enter the access password to continue</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  data-testid="input-password"
                  type="password"
                  placeholder="Enter access password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  autoComplete="current-password"
                />
              </div>
              {error && (
                <p data-testid="text-login-error" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button
                data-testid="button-signin"
                type="submit"
                className="w-full"
                disabled={isLoading || !password}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
