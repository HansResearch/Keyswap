import { useNavigate } from "@tanstack/react-router";

// This dialog is no longer used — the launch flow moved to /launch route.
// Kept to avoid breaking existing imports; it renders nothing.
export function LaunchKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  if (!open) return null;
  // Redirect to the launch page
  onOpenChange(false);
  navigate({ to: "/launch" });
  return null;
}
