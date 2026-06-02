import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./App.css";
import { Layout } from "./components/Layout";
import { OnboardingWizard } from "./onboarding/OnboardingWizard";
import { useOnboardingStore } from "./store/onboarding";
import { usePreferencesStore } from "./store/preferences";
import { getOnboardingState, getSettings } from "./lib/tauri";
import { isTauri } from "./lib/env";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function AppShell() {
  const { state, setState } = useOnboardingStore();
  const { setPreferences } = usePreferencesStore();
  // Start as false (not loading) in browser dev preview; true only inside Tauri
  const [loading, setLoading] = useState(isTauri);

  useEffect(() => {
    if (!isTauri()) return;
    getOnboardingState()
      .then(setState)
      .catch(console.error)
      .finally(() => setLoading(false));
    getSettings()
      .then((s) => setPreferences(s.preferences))
      .catch(console.error);
  }, [setState, setPreferences]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Starting…
      </div>
    );
  }

  // In browser preview, skip onboarding and show the main layout
  if (!isTauri()) {
    return <Layout />;
  }

  if (!state?.is_complete) {
    return <OnboardingWizard />;
  }

  return <Layout />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
}
