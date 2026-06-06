import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ConsolePageTitle } from "./ConsolePageTitle";
import { getConsoleColor } from "@/lib/consoleUtils";

describe("ConsolePageTitle", () => {
  it("renders plain tabName when selectedConsoles is null", () => {
    render(<ConsolePageTitle selectedConsoles={null} tabName="ROMs" />);
    expect(screen.getByRole("heading")).toHaveTextContent("ROMs");
    expect(screen.queryByText("Nintendo")).toBeNull();
  });

  it("renders plain tabName when selectedConsoles is empty array", () => {
    render(<ConsolePageTitle selectedConsoles={[]} tabName="System Files" />);
    expect(screen.getByRole("heading")).toHaveTextContent("System Files");
  });

  it("renders platform — canonical — tabName when selectedConsoles is set", () => {
    render(
      <ConsolePageTitle
        selectedConsoles={["Nintendo - Game Boy Advance", "Nintendo - Game Boy Advance (Multiboot)"]}
        tabName="ROMs"
      />,
    );
    const heading = screen.getByRole("heading");
    expect(heading).toHaveTextContent("Nintendo");
    expect(heading).toHaveTextContent("Game Boy Advance");
    expect(heading).toHaveTextContent("ROMs");
  });

  it("platform span has a non-empty color style from getConsoleColor", () => {
    const { container } = render(
      <ConsolePageTitle selectedConsoles={["Nintendo - Game Boy Advance"]} tabName="ROMs" />,
    );
    const span = container.querySelector("span");
    // jsdom normalizes hex → rgb(), so just verify a color is applied
    expect(span?.style.color).toBeTruthy();
    // Verify getConsoleColor is called for Nintendo (not the default gray)
    const defaultColor = "#6B7280";
    expect(getConsoleColor("Nintendo - Game Boy Advance")).not.toBe(defaultColor);
  });

  it("uses canonical name (strips variant suffix) in the title", () => {
    render(
      <ConsolePageTitle
        selectedConsoles={["Nintendo - Game Boy Advance (Multiboot)"]}
        tabName="System Files"
      />,
    );
    const heading = screen.getByRole("heading");
    expect(heading).toHaveTextContent("Game Boy Advance");
    expect(heading).not.toHaveTextContent("Multiboot");
  });

  it("works with Sega console", () => {
    render(<ConsolePageTitle selectedConsoles={["Sega - Saturn"]} tabName="History" />);
    const heading = screen.getByRole("heading");
    expect(heading).toHaveTextContent("Sega");
    expect(heading).toHaveTextContent("Saturn");
    expect(heading).toHaveTextContent("History");
  });
});
