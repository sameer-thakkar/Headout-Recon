import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Users, Shield, UserCheck, UserX, KeyRound, CheckCircle2, XCircle } from "lucide-react";

interface AdminUser {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  requirePasswordChange: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AdminStats {
  totalUsers: number;
  admins: number;
  researchers: number;
  approved: number;
  suspended: number;
  pendingPasswordResets: number;
}

interface PasswordResetRequest {
  id: string;
  userId: string;
  userEmail: string;
  status: string;
  createdAt: string;
  processedAt: string | null;
  adminNotes: string | null;
}

export function AdminPage() {
  const { toast } = useToast();
  const [approveResult, setApproveResult] = useState<{ requestId: string; email: string; tempPassword: string } | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  const { data: statsData, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
  });

  const { data: usersData, isLoading: usersLoading } = useQuery<{ users: AdminUser[] }>({
    queryKey: ["/api/admin/users"],
  });

  const { data: resetRequestsData, isLoading: resetsLoading } = useQuery<{ resets: PasswordResetRequest[] }>({
    queryKey: ["/api/admin/password-resets"],
  });

  const updateUser = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: { role?: string; status?: string } }) => {
      await apiRequest("PUT", `/api/admin/users/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "User updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const approveReset = useMutation({
    mutationFn: async (requestId: string) => {
      const res = await apiRequest("POST", `/api/admin/password-reset-request/${requestId}/process`);
      return res.json();
    },
    onSuccess: (data, requestId) => {
      const request = pendingResets.find(r => r.id === requestId);
      setApproveResult({ requestId, email: request?.userEmail || "", tempPassword: data.temporaryPassword });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/password-resets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Password reset approved", description: "Temporary password generated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const rejectReset = useMutation({
    mutationFn: async ({ requestId, notes }: { requestId: string; notes: string }) => {
      await apiRequest("POST", `/api/admin/password-reset-request/${requestId}/reject`, { notes });
    },
    onSuccess: () => {
      setRejectingId(null);
      setRejectNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/password-resets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Password reset rejected" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const usersList = usersData?.users || [];
  const pendingResets = resetRequestsData?.resets || [];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-admin-title">Admin Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage users and system settings</p>
      </div>

      {statsLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading stats...
        </div>
      ) : statsData ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4 px-4 text-center">
              <Users className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
              <div className="text-2xl font-bold" data-testid="text-stat-total">{statsData.totalUsers}</div>
              <div className="text-xs text-muted-foreground">Total Users</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 px-4 text-center">
              <Shield className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
              <div className="text-2xl font-bold" data-testid="text-stat-admins">{statsData.admins}</div>
              <div className="text-xs text-muted-foreground">Admins</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 px-4 text-center">
              <UserCheck className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
              <div className="text-2xl font-bold" data-testid="text-stat-researchers">{statsData.researchers}</div>
              <div className="text-xs text-muted-foreground">Researchers</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 px-4 text-center">
              <div className="text-2xl font-bold" data-testid="text-stat-approved">{statsData.approved}</div>
              <div className="text-xs text-muted-foreground">Approved</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 px-4 text-center">
              <UserX className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
              <div className="text-2xl font-bold" data-testid="text-stat-suspended">{statsData.suspended}</div>
              <div className="text-xs text-muted-foreground">Suspended</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 px-4 text-center">
              <KeyRound className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
              <div className="text-2xl font-bold" data-testid="text-stat-resets">{statsData.pendingPasswordResets}</div>
              <div className="text-xs text-muted-foreground">Pending Resets</div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {approveResult && (
        <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-4 pb-4">
            <p className="text-sm font-medium mb-1">Temporary password generated</p>
            <p className="text-sm text-muted-foreground mb-2">
              For user: {approveResult.email}
            </p>
            <code className="block bg-background border rounded px-3 py-2 text-sm font-mono" data-testid="text-temp-password">
              {approveResult.tempPassword}
            </code>
            <p className="text-xs text-muted-foreground mt-2">Share this securely. The user will be required to change it on next login.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setApproveResult(null)} data-testid="button-dismiss-reset">
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Password Reset Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {resetsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading requests...
            </div>
          ) : pendingResets.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4" data-testid="text-no-pending-resets">No pending password reset requests</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 font-medium">Email</th>
                    <th className="text-left py-2 px-2 font-medium">Requested</th>
                    <th className="text-left py-2 px-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingResets.map((request) => (
                    <tr key={request.id} className="border-b last:border-0" data-testid={`row-reset-request-${request.id}`}>
                      <td className="py-2 px-2" data-testid={`text-reset-email-${request.id}`}>{request.userEmail}</td>
                      <td className="py-2 px-2 text-muted-foreground" data-testid={`text-reset-date-${request.id}`}>
                        {new Date(request.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2 px-2">
                        {rejectingId === request.id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              placeholder="Rejection notes (optional)"
                              value={rejectNotes}
                              onChange={(e) => setRejectNotes(e.target.value)}
                              className="h-8 w-48"
                              data-testid={`input-reject-notes-${request.id}`}
                            />
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => rejectReset.mutate({ requestId: request.id, notes: rejectNotes })}
                              disabled={rejectReset.isPending}
                              data-testid={`button-confirm-reject-${request.id}`}
                            >
                              Confirm
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setRejectingId(null); setRejectNotes(""); }}
                              data-testid={`button-cancel-reject-${request.id}`}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => approveReset.mutate(request.id)}
                              disabled={approveReset.isPending}
                              data-testid={`button-approve-reset-${request.id}`}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Approve
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setRejectingId(request.id)}
                              data-testid={`button-reject-reset-${request.id}`}
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Users</CardTitle>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading users...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 font-medium">Name</th>
                    <th className="text-left py-2 px-2 font-medium">Email</th>
                    <th className="text-left py-2 px-2 font-medium">Role</th>
                    <th className="text-left py-2 px-2 font-medium">Status</th>
                    <th className="text-left py-2 px-2 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {usersList.map((user) => (
                    <tr key={user.id} className="border-b last:border-0" data-testid={`row-user-${user.id}`}>
                      <td className="py-2 px-2">
                        {user.firstName} {user.lastName}
                        {user.requirePasswordChange && (
                          <Badge variant="outline" className="ml-2 text-xs">Must change pw</Badge>
                        )}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">{user.email}</td>
                      <td className="py-2 px-2">
                        <Select
                          value={user.role}
                          onValueChange={(role) => updateUser.mutate({ id: user.id, updates: { role } })}
                        >
                          <SelectTrigger className="w-[130px] h-8" data-testid={`select-role-${user.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="researcher">Researcher</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-2 px-2">
                        <Select
                          value={user.status}
                          onValueChange={(status) => updateUser.mutate({ id: user.id, updates: { status } })}
                        >
                          <SelectTrigger className="w-[130px] h-8" data-testid={`select-status-${user.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="approved">Approved</SelectItem>
                            <SelectItem value="suspended">Suspended</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
