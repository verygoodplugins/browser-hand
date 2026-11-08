import { useAuth } from "@clerk/chrome-extension";
import { useEffect, useMemo, useRef, useState } from "react";
import { readClerkConfig } from "../../account/config";
import {
  createOrderHistorySource,
  formatOrderDate,
  formatOrderMoney,
  orderStatusLabel,
  type Order,
  type OrderHistorySource,
} from "../../account/orders";

export function OrderHistory({ userId }: { userId: string }) {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const source = useMemo<OrderHistorySource>(
    () => createOrderHistorySource(readClerkConfig().orderHistoryUrl),
    []
  );
  const [orders, setOrders] = useState<Order[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState(source.id);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    source
      .listOrders({ userId, limit: 20 }, { getToken: () => getTokenRef.current() })
      .then((page) => {
        if (cancelled) return;
        setOrders(page.orders);
        setNextCursor(page.nextCursor);
        setSourceId(page.source);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load orders.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, userId]);

  async function loadMore(): Promise<void> {
    if (!nextCursor) return;
    setLoading(true);
    setError(null);
    try {
      const page = await source.listOrders(
        { userId, limit: 20, cursor: nextCursor },
        { getToken: () => getTokenRef.current() }
      );
      setOrders((current) => [...current, ...page.orders]);
      setNextCursor(page.nextCursor);
      setSourceId(page.source);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load orders.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="orders-heading">
      <h2 id="orders-heading">Order history</h2>
      {sourceId === "placeholder" && !error ? (
        <p className="banner">
          <strong>Sample orders.</strong> Browser Hand does not have an order service yet. These
          rows are placeholders so the account page has a shape to render. Set{" "}
          <code>WXT_ORDER_HISTORY_URL</code> and rebuild to load this account&apos;s real orders.
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {loading && orders.length === 0 ? <p className="muted">Loading orders…</p> : null}
      {!loading && !error && orders.length === 0 ? (
        <p className="muted">No orders for this account.</p>
      ) : null}
      {orders.length > 0 ? (
        <ul className="orders">
          {orders.map((order) => (
            <li className="order" key={order.id}>
              <div className="order-head">
                <span className="order-number">{order.number}</span>
                <span className={`status status-${order.status}`}>
                  {orderStatusLabel(order.status)}
                </span>
              </div>
              <div className="order-meta">
                {formatOrderDate(order.createdAt)} ·{" "}
                {formatOrderMoney(order.totalAmountCents, order.currency)}
              </div>
              <ul className="order-lines">
                {order.lineItems.map((item) => (
                  <li key={item.id}>
                    {item.quantity} × {item.name}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
      {nextCursor ? (
        <div className="row-actions">
          <button
            className="button"
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
