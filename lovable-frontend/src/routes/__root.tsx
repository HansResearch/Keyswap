import '../polyfills'
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  Link,
} from "@tanstack/react-router";

import { Header } from "@/components/Header";
import { SolanaWalletProvider } from "@/lib/wallet-provider";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-mono-xs text-muted-foreground">404 — NOT FOUND</h1>
        <Link to="/" className="mt-4 inline-block text-sm text-primary hover:underline">← Back to market</Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-mono-xs text-destructive">SOMETHING BROKE</h1>
        <button onClick={() => { router.invalidate(); reset(); }} className="mt-4 rounded border border-border bg-surface px-3 py-1.5 text-mono-xs hover:bg-muted">Retry</button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <SolanaWalletProvider>
        <div className="min-h-screen bg-background text-foreground">
          <Header />
          <Outlet />
        </div>
        <Toaster />
      </SolanaWalletProvider>
    </QueryClientProvider>
  );
}
