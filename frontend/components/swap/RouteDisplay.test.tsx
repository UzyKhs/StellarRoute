import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PriceQuote } from "@/types";

import { RouteDisplay } from "./RouteDisplay";

const sampleQuote: PriceQuote = {
  base_asset: { asset_type: "native" },
  quote_asset: { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "issuer" },
  amount: "10",
  price: "2.5",
  total: "24.75",
  quote_type: "sell",
  path: [
    {
      from_asset: { asset_type: "native" },
      to_asset: { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "issuer" },
      price: "2.5",
      source: "sdex",
    },
  ],
  timestamp: 1,
  price_impact: "0.42",
};

describe("RouteDisplay", () => {
  afterEach(() => cleanup());

  it("should render loading skeleton when isLoading is true", () => {
    render(<RouteDisplay amountOut="50.0" isLoading={true} />);

    const skeletonElements = document.querySelectorAll(".animate-pulse");
    expect(skeletonElements.length).toBeGreaterThanOrEqual(5);
  });

  it("should render actual content when isLoading is false or undefined", () => {
    render(<RouteDisplay amountOut="50.0" isLoading={false} />);

    expect(screen.getByText("Best Route")).toBeInTheDocument();
  });

  it("should accept isLoading prop as true", () => {
    const { container } = render(<RouteDisplay amountOut="50.0" isLoading={true} />);

    const skeletons = container.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("should accept isLoading prop as false", () => {
    const { container } = render(<RouteDisplay amountOut="50.0" isLoading={false} />);

    const skeletons = container.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBe(0);
  });

  it("should maintain layout stability during state transitions", () => {
    const { container, rerender } = render(<RouteDisplay amountOut="50.0" isLoading={true} />);

    const initialHeight = container.querySelector(".rounded-xl")?.clientHeight;

    rerender(<RouteDisplay amountOut="50.0" isLoading={false} />);

    const finalHeight = container.querySelector(".rounded-xl")?.clientHeight;

    expect(initialHeight).toBeDefined();
    expect(finalHeight).toBeDefined();
    if (initialHeight && finalHeight) {
      expect(Math.abs(initialHeight - finalHeight)).toBeLessThan(50);
    }
  });

  it("virtualizes long alternative route lists and updates the window on scroll", async () => {
    const routes = Array.from({ length: 20 }, (_, index) => ({
      id: `route-${index}`,
      venue: `Pool ${index}`,
      expectedAmount: `≈ ${(50 - index * 0.1).toFixed(4)}`,
    }));

    render(
      <RouteDisplay
        amountOut="50.0"
        alternativeRoutes={routes}
      />,
    );

    const initialButtons = screen.getAllByTestId(/alternative-route-route-/);
    expect(initialButtons.length).toBeLessThan(routes.length);
    expect(screen.getByTestId("alternative-route-route-0")).toBeInTheDocument();

    const scrollContainer = screen.getByTestId("alternative-routes-scroll");
    scrollContainer.scrollTop = 360;
    fireEvent.scroll(scrollContainer);

    await waitFor(() => {
      expect(screen.getByTestId("alternative-route-route-8")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("alternative-route-route-0")).not.toBeInTheDocument();
  });

  it("opens the route detail drawer with hop data from the quote", () => {
    render(
      <RouteDisplay
        amountOut="24.75"
        quote={sampleQuote}
      />,
    );

    fireEvent.click(screen.getByLabelText("Show route details"));

    expect(screen.getByRole("dialog", { name: "Route Details" })).toBeInTheDocument();
    expect(screen.getByText("Hop 1")).toBeInTheDocument();
    expect(screen.getByText("Stellar DEX (SDEX)")).toBeInTheDocument();
  });

  it("shows an alternative route tab and graceful empty-state when details are unavailable", () => {
    render(
      <RouteDisplay
        amountOut="24.75"
        quote={sampleQuote}
        alternativeRoutes={[
          {
            id: "route-alt",
            venue: "Blend Pool",
            expectedAmount: "≈ 24.10",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId("alternative-route-route-alt"));
    fireEvent.click(screen.getByLabelText("Show route details"));
    fireEvent.click(screen.getByTestId("route-detail-tab-alternative"));

    expect(screen.getByText("No hop data available for this route.")).toBeInTheDocument();
  });
});
