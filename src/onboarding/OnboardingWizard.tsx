import { useEffect } from "react";
import { Gamepad2 } from "lucide-react";
import { useOnboardingStore } from "@/store/onboarding";
import { getOnboardingState } from "@/lib/tauri";
import { TermsStep } from "./steps/TermsStep";
import { PreferencesStep } from "./steps/PreferencesStep";
import { AddRootStep } from "./steps/AddRootStep";
import { ScanStep } from "./steps/ScanStep";

const STEPS = [
  { n: 1, label: "Terms"        },
  { n: 2, label: "Preferences"  },
  { n: 3, label: "ROM Library"  },
  { n: 4, label: "First Scan"   },
];

export function OnboardingWizard() {
  const { currentStep, setState } = useOnboardingStore();

  useEffect(() => {
    getOnboardingState().then(setState).catch(console.error);
  }, [setState]);

  return (
    <div className="flex flex-col items-center justify-center min-h-full p-8 bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center">
          <Gamepad2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">ROMulus</h1>
          <p className="text-sm text-muted-foreground">ROM collection management hub</p>
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map(({ n, label }, i) => (
          <div key={n} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div
                className={[
                  "w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold border",
                  n < currentStep
                    ? "bg-primary border-primary text-primary-foreground"
                    : n === currentStep
                    ? "bg-primary/20 border-primary text-primary"
                    : "bg-muted border-border text-muted-foreground",
                ].join(" ")}
              >
                {n < currentStep ? "✓" : n}
              </div>
              <span
                className={[
                  "text-xs hidden sm:block",
                  n === currentStep ? "text-foreground font-medium" : "text-muted-foreground",
                ].join(" ")}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-px ${n < currentStep ? "bg-primary" : "bg-border"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="w-full max-w-md">
        {currentStep === 1 && <TermsStep />}
        {currentStep === 2 && <PreferencesStep />}
        {currentStep === 3 && <AddRootStep />}
        {currentStep === 4 && <ScanStep />}
      </div>
    </div>
  );
}
