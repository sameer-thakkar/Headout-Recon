import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Users, Plus, Trash2, KeyRound, Loader2, Shield, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { SafeUser } from "@shared/schema";

interface UserManagementProps {
  currentUser: SafeUser;
}

function AddUserForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/users", { username, password, role });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setUsername("");
      setPassword("");
      setRole("member");
      toast({ title: "User created", description: `${username} has been added.` });
      onSuccess();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }}
      className="space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="new-username">Username</Label>
          <Input
            id="new-username"
            data-testid="input-new-username"
            placeholder="e.g. jsmith"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-password">Password</Label>
          <Input
            id="new-password"
            data-testid="input-new-password"
            type="password"
            placeholder="Min 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Role</Label>
        <Select value={role} onValueChange={(v) => setRole(v as "member" | "admin")}>
          <SelectTrigger data-testid="select-new-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">Member</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        type="submit"
        disabled={!username || !password || password.length < 6 || createMutation.isPending}
        className="w-full"
        data-testid="button-create-user"
      >
        {createMutation.isPending ? (
          <><Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />Creating…</>
        ) : (
          <><Plus className="h-4 w-4 mr-2" aria-hidden="true" />Add User</>
        )}
      </Button>
    </form>
  );
}

function ResetPasswordForm({ userId, username, onClose }: { userId: string; username: string; onClose: () => void }) {
  const { toast } = useToast();
  const [newPassword, setNewPassword] = useState("");

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/users/${userId}/password`, { newPassword });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to reset password");
      }
    },
    onSuccess: () => {
      toast({ title: "Password reset", description: `Password for ${username} has been updated.` });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); resetMutation.mutate(); }}
      className="flex gap-2 items-end"
    >
      <div className="flex-1 space-y-1">
        <Label htmlFor={`reset-pw-${userId}`} className="text-xs">New password</Label>
        <Input
          id={`reset-pw-${userId}`}
          type="password"
          placeholder="Min 6 characters"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          className="h-8 text-sm"
        />
      </div>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={newPassword.length < 6 || resetMutation.isPending}
      >
        {resetMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
    </form>
  );
}

interface UserManagementDialogProps extends UserManagementProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function UserManagement({ currentUser, open: controlledOpen, onOpenChange }: UserManagementDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [resetPasswordFor, setResetPasswordFor] = useState<string | null>(null);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ users: SafeUser[] }>({
    queryKey: ["/api/users"],
    enabled: open,
  });

  const deleteMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("DELETE", `/api/users/${userId}`);
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to delete user");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const roleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await apiRequest("PATCH", `/api/users/${userId}/role`, { role });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to update role");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isControlled = controlledOpen !== undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            data-testid="button-open-user-management"
            aria-label="Manage users"
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Users</span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            User Management
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium mb-3">Add New User</h3>
            <AddUserForm onSuccess={() => {}} />
          </div>

          <Separator />

          <div>
            <h3 className="text-sm font-medium mb-3">All Users</h3>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.users || []).map((user) => (
                    <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {user.role === "admin" ? (
                            <Shield className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                          ) : (
                            <User className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                          )}
                          <span className="font-medium">{user.username}</span>
                          {user.id === currentUser.id && (
                            <Badge variant="secondary" className="text-xs">you</Badge>
                          )}
                        </div>
                        {resetPasswordFor === user.id && (
                          <div className="mt-2">
                            <ResetPasswordForm
                              userId={user.id}
                              username={user.username}
                              onClose={() => setResetPasswordFor(null)}
                            />
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {user.id === currentUser.id ? (
                          <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                            {user.role}
                          </Badge>
                        ) : (
                          <Select
                            value={user.role}
                            onValueChange={(role) => roleMutation.mutate({ userId: user.id, role })}
                          >
                            <SelectTrigger className="h-7 w-24 text-xs" data-testid={`select-role-${user.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="member">Member</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString("en-GB")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => setResetPasswordFor(resetPasswordFor === user.id ? null : user.id)}
                            data-testid={`button-reset-password-${user.id}`}
                            aria-label={`Reset password for ${user.username}`}
                          >
                            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          {user.id !== currentUser.id && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => {
                                if (confirm(`Delete user "${user.username}"?`)) {
                                  deleteMutation.mutate(user.id);
                                }
                              }}
                              disabled={deleteMutation.isPending}
                              data-testid={`button-delete-user-${user.id}`}
                              aria-label={`Delete ${user.username}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
