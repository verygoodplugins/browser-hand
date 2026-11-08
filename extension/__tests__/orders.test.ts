import { describe, expect, it, vi } from "vitest";
import {
  OrderHistoryError,
  createHttpOrderSource,
  createOrderHistorySource,
  createPlaceholderOrderSource,
  formatOrderMoney,
  parseOrderHistoryPage,
} from "../account/orders";

const context = { getToken: async () => "session-token" };

describe("order history", () => {
  it("returns labeled sample orders when no URL is configured", async () => {
    const page = await createOrderHistorySource().listOrders({ userId: "user_123" }, context);
    expect(page.source).toBe("placeholder");
    expect(page.orders.length).toBeGreaterThan(0);
    expect(page.orders.every((order) => order.sample)).toBe(true);
    expect(page.nextCursor).toBeNull();
  });

  it("does not invent another page for the placeholder cursor", async () => {
    const page = await createPlaceholderOrderSource().listOrders(
      { userId: "user_123", cursor: "next" },
      context
    );
    expect(page.orders).toEqual([]);
  });

  it("requires a user id", async () => {
    await expect(
      createPlaceholderOrderSource().listOrders({ userId: "  " }, context)
    ).rejects.toBeInstanceOf(OrderHistoryError);
  });

  it("requests the signed-in user's orders with the Clerk session token", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          orders: [
            {
              id: "ord_1",
              number: "BH-9",
              createdAt: "2026-11-01T00:00:00.000Z",
              status: "paid",
              currency: "USD",
              totalAmountCents: 500,
              lineItems: [
                {
                  id: "li_1",
                  name: "Seat",
                  quantity: 1,
                  unitAmountCents: 500,
                  currency: "usd",
                },
              ],
            },
          ],
          nextCursor: "cursor-2",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    const source = createHttpOrderSource(
      "https://orders.example.com/v1/orders?tenant=bh",
      fetchImpl
    );
    const page = await source.listOrders(
      { userId: "user_123", limit: 20, cursor: "cursor-1" },
      context
    );

    expect(page.source).toBe("http");
    expect(page.nextCursor).toBe("cursor-2");
    expect(page.orders[0]?.currency).toBe("usd");
    expect(page.orders[0]?.sample).toBeUndefined();
    const [input, init] = fetchImpl.mock.calls[0] ?? [];
    const url = new URL(String(input));
    expect(url.origin).toBe("https://orders.example.com");
    expect(url.searchParams.get("userId")).toBe("user_123");
    expect(url.searchParams.get("tenant")).toBe("bh");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("cursor")).toBe("cursor-1");
    expect(init).toBeDefined();
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer session-token");
  });

  it("does not fall back to sample orders when the HTTP source fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));
    const source = createHttpOrderSource("https://orders.example.com/orders", fetchImpl);
    await expect(source.listOrders({ userId: "user_123" }, context)).rejects.toThrow(/503/);
  });

  it("rejects a malformed order page", () => {
    expect(() => parseOrderHistoryPage({ orders: [{ id: "x" }] })).toThrow(OrderHistoryError);
  });

  it("formats cents as currency", () => {
    expect(formatOrderMoney(2900, "usd")).toBe("$29.00");
  });

  it("refuses a non-http order URL", () => {
    expect(() => createHttpOrderSource("file:///tmp/orders.json")).toThrow(OrderHistoryError);
  });
});
