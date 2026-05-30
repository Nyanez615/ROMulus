import { create } from "zustand";
import type { OnboardingState } from "@/lib/bindings/OnboardingState";

interface OnboardingStore {
  state: OnboardingState | null;
  currentStep: number;
  setState: (s: OnboardingState) => void;
  setStep: (n: number) => void;
}

export const useOnboardingStore = create<OnboardingStore>((set) => ({
  state: null,
  currentStep: 1,
  setState: (state) => {
    let step = 1;
    if (state.terms_accepted) step = 2;
    if (state.terms_accepted && state.preferences_configured) step = 3;
    if (state.terms_accepted && state.preferences_configured && state.roots_added) step = 4;
    set({ state, currentStep: step });
  },
  setStep: (currentStep) => set({ currentStep }),
}));
