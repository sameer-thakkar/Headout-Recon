import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UserPlus, Loader2 } from "lucide-react";

interface RegisterPageProps {
  onSwitchToLogin?: () => void;
}

export function RegisterPage({ onSwitchToLogin }: RegisterPageProps) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const isHeadoutEmail = email.trim().toLowerCase().endsWith("@headout.com") || email.trim() === "";
  const passwordsMatch = password === confirmPassword;
  const canSubmit = email && firstName && lastName && password.length >= 6 && passwordsMatch && isHeadoutEmail && !isLoading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!isHeadoutEmail) {
      setError("Only @headout.com email addresses are allowed");
      return;
    }
    if (!passwordsMatch) {
      setError("Passwords don't match");
      return;
    }
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/register", {
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        password,
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Registration failed");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Registration failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
            <UserPlus className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Headout Recon</h1>
            <p className="text-sm text-muted-foreground mt-1">Create your account</p>
          </div>
        </div>
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Register</CardTitle>
            <CardDescription>Use your @headout.com email to create an account</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First name</Label>
                  <Input
                    id="firstName"
                    data-testid="input-first-name"
                    type="text"
                    placeholder="First name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last name</Label>
                  <Input
                    id="lastName"
                    data-testid="input-last-name"
                    type="text"
                    placeholder="Last name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="family-name"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-email">Email</Label>
                <Input
                  id="reg-email"
                  data-testid="input-register-email"
                  type="email"
                  placeholder="you@headout.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
                {email && !isHeadoutEmail && (
                  <p className="text-xs text-destructive">Only @headout.com emails are allowed</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-password">Password</Label>
                <Input
                  id="reg-password"
                  data-testid="input-register-password"
                  type="password"
                  placeholder="Min 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-confirm">Confirm password</Label>
                <Input
                  id="reg-confirm"
                  data-testid="input-register-confirm"
                  type="password"
                  placeholder="Repeat password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
                {confirmPassword && !passwordsMatch && (
                  <p className="text-xs text-destructive">Passwords don't match</p>
                )}
              </div>
              {error && (
                <p data-testid="text-register-error" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button
                data-testid="button-register"
                type="submit"
                className="w-full"
                disabled={!canSubmit}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                    Creating account…
                  </>
                ) : (
                  "Create account"
                )}
              </Button>
            </form>
            {onSwitchToLogin && (
              <div className="mt-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Already have an account?{" "}
                  <button
                    type="button"
                    data-testid="link-login"
                    className="text-primary hover:underline font-medium cursor-pointer"
                    onClick={onSwitchToLogin}
                  >
                    Sign in
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
