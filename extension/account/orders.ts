/**
 * Order history for the Browser Hand account page.
 *
 * There is no order service in this repo. `createOrderHistorySource()` returns:
 * - an HTTP source when `WXT_ORDER_HISTORY_URL` is set at build time
 * - otherwise a placeholder source with clearly marked sample orders
 *
 * Wire a real source by implementing `GET {WXT_ORDER_HISTORY_URL}`:
 *
 * ```json
 * { "orders": [Order], "nextCursor": null }
 * ```
 *
 * The extension sends `Authorization: Bearer <Clerk session token>` and
 * `userId`, `limit`, and `cursor` query parameters. The server must verify the
 * token with `@clerk/backend` `verifyToken` and return only that user's orders
 * (`payload.sub`). Do not trust `userId` by itself. See the README.
 */

export type OrderStatus = "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";

export interface OrderLineItem {
  id: string;
  name: string;
  quantity: number;
  /** Integer minor units (cents). */
  unitAmountCents: number;
  currency: string;
}

export interface Order {
  id: string;
  number: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
  status: OrderStatus;
  currency: string;
  /** Integer minor units (cents). */
  totalAmountCents: number;
  lineItems: OrderLineItem[];
  /** True only for the built-in sample source. Real orders omit this. */
  sample?: boolean;
}

export interface OrderHistoryQuery {
  userId: string;
  limit?: number;
  cursor?: string;
}

export interface OrderHistoryPage {
  orders: Order[];
  nextCursor: string | null;
  source: "placeholder" | "http";
}

export interface OrderHistoryContext {
  /** Clerk session token. Required by the HTTP source. */
  getToken: () => Promise<string | null>;
}

export interface OrderHistorySource {
  readonly id: OrderHistoryPage["source"];
  listOrders(query: OrderHistoryQuery, context: OrderHistoryContext): Promise<OrderHistoryPage>;
}

export class OrderHistoryError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "OrderHistoryError";
    this.status = status;
  }
}

const ORDER_STATUSES: readonly OrderStatus[] = [
  "pending",
  "paid",
  "fulfilled",
  "cancelled",
  "refunded",
];

const PLACEHOLDER_ORDERS: readonly Order[] = [
  {
    id: "sample_bh_1108",
    number: "BH-1108",
    createdAt: "2026-10-02T18:24:00.000Z",
    status: "paid",
    currency: "usd",
    totalAmountCents: 1200,
    sample: true,
    lineItems: [
      {
        id: "sample_li_1108",
        name: "Browser Hand relay add-on (sample)",
        quantity: 1,
        unitAmountCents: 1200,
        currency: "usd",
      },
    ],
  },
  {
    id: "sample_bh_1042",
    number: "BH-1042",
    createdAt: "2026-07-18T15:04:00.000Z",
    status: "fulfilled",
    currency: "usd",
    totalAmountCents: 2900,
    sample: true,
    lineItems: [
      {
        id: "sample_li_1042",
        name: "Browser Hand seat (sample)",
        quantity: 1,
        unitAmountCents: 2900,
        currency: "usd",
      },
    ],
  },
];

function requireUserId(userId: string): string {
  const trimmed = userId.trim();
  if (!trimmed) {
    throw new OrderHistoryError("A Clerk user id is required to list orders.");
  }
  return trimmed;
}

export function createPlaceholderOrderSource(): OrderHistorySource {
  return {
    id: "placeholder",
    async listOrders(query) {
      requireUserId(query.userId);
      if (query.cursor) {
        return { orders: [], nextCursor: null, source: "placeholder" };
      }
      const limit = query.limit ?? PLACEHOLDER_ORDERS.length;
      return {
        orders: PLACEHOLDER_ORDERS.slice(0, limit).map((order) => ({
          ...order,
          lineItems: order.lineItems.map((item) => ({ ...item })),
        })),
        nextCursor: null,
        source: "placeholder",
      };
    },
  };
}

export function createHttpOrderSource(
  orderHistoryUrl: string,
  fetchImpl: typeof fetch = fetch
): OrderHistorySource {
  let endpoint: URL;
  try {
    endpoint = new URL(orderHistoryUrl);
  } catch {
    throw new OrderHistoryError(`Order history URL is not a valid URL: ${orderHistoryUrl}`);
  }
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new OrderHistoryError("Order history URL must use http or https.");
  }

  return {
    id: "http",
    async listOrders(query, context) {
      const userId = requireUserId(query.userId);
      const token = await context.getToken();
      if (!token) {
        throw new OrderHistoryError("Sign in again to load orders.");
      }

      const url = new URL(endpoint.toString());
      url.searchParams.set("userId", userId);
      if (query.limit != null) url.searchParams.set("limit", String(query.limit));
      if (query.cursor) url.searchParams.set("cursor", query.cursor);

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new OrderHistoryError(`Order history request failed: ${message}`);
      }

      if (!response.ok) {
        const detail = (await response.text()).trim().slice(0, 300);
        throw new OrderHistoryError(
          detail
            ? `Order history request failed (${response.status}): ${detail}`
            : `Order history request failed (${response.status}).`,
          response.status
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new OrderHistoryError("Order history response was not JSON.");
      }

      const page = parseOrderHistoryPage(body);
      return { ...page, source: "http" };
    },
  };
}

export function createOrderHistorySource(orderHistoryUrl?: string): OrderHistorySource {
  const url = orderHistoryUrl?.trim();
  if (!url) return createPlaceholderOrderSource();
  return createHttpOrderSource(url);
}

export function parseOrderHistoryPage(body: unknown): Omit<OrderHistoryPage, "source"> {
  if (!body || typeof body !== "object") {
    throw new OrderHistoryError("Order history response must be a JSON object.");
  }
  const record = body as { orders?: unknown; nextCursor?: unknown };
  if (!Array.isArray(record.orders)) {
    throw new OrderHistoryError("Order history response is missing an orders array.");
  }
  if (record.nextCursor != null && typeof record.nextCursor !== "string") {
    throw new OrderHistoryError("Order history nextCursor must be a string or null.");
  }
  return {
    orders: record.orders.map((order, index) => parseOrder(order, index)),
    nextCursor: record.nextCursor ?? null,
  };
}

function parseOrder(value: unknown, index: number): Order {
  const order = expectRecord(value, `orders[${index}]`);
  const currency = expectCurrency(order.currency, `orders[${index}].currency`);
  const lineItems = Array.isArray(order.lineItems)
    ? order.lineItems.map((item, itemIndex) => parseLineItem(item, index, itemIndex))
    : null;
  if (!lineItems) {
    throw new OrderHistoryError(`orders[${index}].lineItems must be an array.`);
  }
  return {
    id: expectId(order.id, `orders[${index}].id`),
    number: expectId(order.number, `orders[${index}].number`),
    createdAt: expectIsoDate(order.createdAt, `orders[${index}].createdAt`),
    status: expectStatus(order.status, `orders[${index}].status`),
    currency,
    totalAmountCents: expectCents(order.totalAmountCents, `orders[${index}].totalAmountCents`),
    lineItems,
  };
}

function parseLineItem(value: unknown, orderIndex: number, itemIndex: number): OrderLineItem {
  const path = `orders[${orderIndex}].lineItems[${itemIndex}]`;
  const item = expectRecord(value, path);
  const currency = expectCurrency(item.currency, `${path}.currency`);
  return {
    id: expectId(item.id, `${path}.id`),
    name: expectId(item.name, `${path}.name`),
    quantity: expectQuantity(item.quantity, `${path}.quantity`),
    unitAmountCents: expectCents(item.unitAmountCents, `${path}.unitAmountCents`),
    currency,
  };
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OrderHistoryError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function expectId(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new OrderHistoryError(`${path} must be a non-empty string.`);
  }
  return value;
}

function expectIsoDate(value: unknown, path: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new OrderHistoryError(`${path} must be an ISO-8601 date.`);
  }
  return value;
}

function expectStatus(value: unknown, path: string): OrderStatus {
  if (typeof value !== "string" || !ORDER_STATUSES.includes(value as OrderStatus)) {
    throw new OrderHistoryError(`${path} must be one of ${ORDER_STATUSES.join(", ")}.`);
  }
  return value as OrderStatus;
}

function expectCurrency(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value)) {
    throw new OrderHistoryError(`${path} must be a 3-letter currency code.`);
  }
  return value.toLowerCase();
}

function expectCents(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new OrderHistoryError(`${path} must be an integer number of cents.`);
  }
  return value;
}

function expectQuantity(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new OrderHistoryError(`${path} must be a positive integer.`);
  }
  return value;
}

export function formatOrderMoney(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
}

export function formatOrderDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(iso));
}

export function orderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "paid":
      return "Paid";
    case "fulfilled":
      return "Fulfilled";
    case "cancelled":
      return "Cancelled";
    case "refunded":
      return "Refunded";
  }
}
