import { useState } from "react";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Lock, Loader2, Mail, ArrowLeft, CheckCircle2 } from "lucide-react";

interface LoginPageProps {
  onSwitchToRegister?: () => void;
}

export function LoginPage({ onSwitchToRegister }: LoginPageProps) {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSubmitted, setResetSubmitted] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/login", { email: email.trim(), password });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Sign in failed");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
      setLocation("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign in failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError("");
    setResetLoading(true);
    try {
      await apiRequest("POST", "/api/auth/request-password-reset", { email: resetEmail.trim() });
      setResetSubmitted(true);
    } catch (err: unknown) {
      setResetError(err instanceof Error ? err.message : "Failed to submit request. Please try again.");
    } finally {
      setResetLoading(false);
    }
  };

  if (showForgotPassword) {
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
              <CardTitle className="text-base">Forgot Password</CardTitle>
              <CardDescription>
                {resetSubmitted
                  ? "Your request has been submitted"
                  : "Enter your email to request a password reset"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {resetSubmitted ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-3 rounded-md bg-muted/50">
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                    <p className="text-sm" data-testid="text-reset-confirmation">
                      If an account with that email exists, a password reset request has been submitted for review. An administrator will process your request.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setShowForgotPassword(false);
                      setResetSubmitted(false);
                      setResetEmail("");
                    }}
                    data-testid="button-back-to-login"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to sign in
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleResetRequest} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="reset-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <Input
                        id="reset-email"
                        data-testid="input-reset-email"
                        type="email"
                        placeholder="you@headout.com"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        className="pl-9"
                        autoFocus
                        autoComplete="email"
                      />
                    </div>
                  </div>
                  {resetError && (
                    <p data-testid="text-reset-error" className="text-sm text-destructive">
                      {resetError}
                    </p>
                  )}
                  <Button
                    data-testid="button-submit-reset"
                    type="submit"
                    className="w-full"
                    disabled={resetLoading || !resetEmail}
                  >
                    {resetLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                        Submitting...
                      </>
                    ) : (
                      "Request Password Reset"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => {
                      setShowForgotPassword(false);
                      setResetError("");
                      setResetEmail("");
                    }}
                    data-testid="button-cancel-reset"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to sign in
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

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
            <CardDescription>Enter your email and password to continue</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="email"
                    data-testid="input-email"
                    type="email"
                    placeholder="you@headout.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9"
                    autoFocus
                    autoComplete="email"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button
                    type="button"
                    data-testid="link-forgot-password"
                    className="text-xs text-primary hover:underline font-medium cursor-pointer"
                    onClick={() => setShowForgotPassword(true)}
                  >
                    Forgot password?
                  </button>
                </div>
                <Input
                  id="password"
                  data-testid="input-password"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
                disabled={isLoading || !email || !password}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                    Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
            {onSwitchToRegister && (
              <div className="mt-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Don't have an account?{" "}
                  <button
                    type="button"
                    data-testid="link-register"
                    className="text-primary hover:underline font-medium cursor-pointer"
                    onClick={onSwitchToRegister}
                  >
                    Register
                  </button>
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
