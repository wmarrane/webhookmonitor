import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AsyncState } from "./AsyncState.js";

describe("AsyncState", () => {
  it("shows loading", () => {
    render(<AsyncState loading error={null} empty={false}>x</AsyncState>);
    expect(screen.getByText(/carregando/i)).toBeInTheDocument();
  });
  it("shows error", () => {
    render(<AsyncState loading={false} error="boom" empty={false}>x</AsyncState>);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
  it("shows empty", () => {
    render(<AsyncState loading={false} error={null} empty>x</AsyncState>);
    expect(screen.getByText(/nenhum dado/i)).toBeInTheDocument();
  });
  it("renders children when ready", () => {
    render(<AsyncState loading={false} error={null} empty={false}><span>ready</span></AsyncState>);
    expect(screen.getByText("ready")).toBeInTheDocument();
  });
});
