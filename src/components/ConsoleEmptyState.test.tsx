import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ConsoleEmptyState } from "./ConsoleEmptyState";

describe("ConsoleEmptyState", () => {
  it("renders children (generic message) when selectedConsoles is null", () => {
    render(
      <ConsoleEmptyState selectedConsoles={null} noun="ROMs">
        <div>No ROMs found. Run a scan.</div>
      </ConsoleEmptyState>,
    );
    expect(screen.getByText("No ROMs found. Run a scan.")).toBeInTheDocument();
  });

  it("renders children when selectedConsoles is empty array", () => {
    render(
      <ConsoleEmptyState selectedConsoles={[]} noun="duplicates">
        <p>Nothing to see here</p>
      </ConsoleEmptyState>,
    );
    expect(screen.getByText("Nothing to see here")).toBeInTheDocument();
  });

  it("renders console name in message when selectedConsoles is set", () => {
    render(
      <ConsoleEmptyState
        selectedConsoles={["Nintendo - Game Boy Advance"]}
        noun="ROMs"
      />,
    );
    expect(screen.getByText(/No ROMs for/)).toBeInTheDocument();
    expect(screen.getByText(/Game Boy Advance/)).toBeInTheDocument();
  });

  it("uses canonical name (strips variant suffix) in the message", () => {
    render(
      <ConsoleEmptyState
        selectedConsoles={["Nintendo - Game Boy Advance (Multiboot)"]}
        noun="system files"
      />,
    );
    expect(screen.getByText(/system files/)).toBeInTheDocument();
    expect(screen.getByText(/Game Boy Advance/)).toBeInTheDocument();
  });

  it("does not render children when selectedConsoles is set", () => {
    render(
      <ConsoleEmptyState
        selectedConsoles={["Nintendo - Game Boy Advance"]}
        noun="ROMs"
      >
        <span data-testid="fallback">fallback text</span>
      </ConsoleEmptyState>,
    );
    expect(screen.queryByTestId("fallback")).toBeNull();
  });
});
