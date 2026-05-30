import { useState } from "react";
import { Shield, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { completeOnboardingStep } from "@/lib/tauri";
import { useOnboardingStore } from "@/store/onboarding";

export function TermsStep() {
  const [termsChecked, setTermsChecked] = useState(false);
  const [crashChecked, setCrashChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const { setState, setStep } = useOnboardingStore();

  async function handleContinue() {
    setLoading(true);
    try {
      const updated = await completeOnboardingStep(1);
      setState(updated);
      setStep(2);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-6">
      <div className="flex items-start gap-3">
        <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div>
          <h2 className="font-semibold text-foreground">Before you start</h2>
          <p className="text-sm text-muted-foreground mt-1">
            ROMulus is a file management tool. It organizes files already on your device.
            It does not download, distribute, or stream ROM files.
          </p>
        </div>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex gap-2 text-sm text-amber-300">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>You are responsible for ensuring you have the right to manage the files in your collection.</span>
      </div>

      <div className="space-y-3">
        <div className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors">
          <Checkbox
            id="terms"
            checked={termsChecked}
            onCheckedChange={(v) => setTermsChecked(Boolean(v))}
            className="mt-0.5"
          />
          <Label htmlFor="terms" className="text-sm text-foreground cursor-pointer leading-relaxed">
            I confirm I have the right to manage the files I will add to ROMulus, and I accept the{" "}
            <a href="#" className="text-primary underline">Terms of Service</a>.
          </Label>
        </div>

        <div className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors">
          <Checkbox
            id="crash"
            checked={crashChecked}
            onCheckedChange={(v) => setCrashChecked(Boolean(v))}
            className="mt-0.5"
          />
          <Label htmlFor="crash" className="text-sm text-foreground cursor-pointer leading-relaxed">
            <span>Opt in to anonymous crash reporting</span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              Only stack traces are sent — no file paths, ROM titles, or personal data. You can change this in Settings.
            </span>
          </Label>
        </div>
      </div>

      <Button
        className="w-full"
        disabled={!termsChecked || loading}
        onClick={handleContinue}
      >
        {loading ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}
