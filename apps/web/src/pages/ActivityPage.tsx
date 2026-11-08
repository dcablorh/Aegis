import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useSession } from "../lib/session";
import { Field } from "../ui";

type Kind = "all" | "read" | "draft" | "quote";

export function ActivityPage() {
  const session = useSession();
  const [kind, setKind] = useState<Kind>("all");
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const items = [
      ...session.reads.map((item) => ({ kind: "read" as const, at: item.at, title: item.accountId, detail: item.healthLabel, href: `/app/positions/${encodeURIComponent(item.accountId)}?network=${item.network}` })),
      ...session.drafts.map((item) => ({ kind: "draft" as const, at: item.at, title: item.accountId, detail: "Local draft", href: `/app/protection/drafts/${item.id}` })),
      ...session.quotes.map((item) => ({ kind: "quote" as const, at: item.at, title: item.id, detail: item.depositAddress, href: `/app/activity/quotes/${item.id}` })),
    ];
    return items
      .filter((item) => kind === "all" || item.kind === kind)
      .filter((item) => `${item.title} ${item.detail}`.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [session, kind, query]);

  return (
    <>
      <p className="kicker">Activity</p>
      <h1>This tab</h1>
      <p className="lede">Reads, local drafts, and dry quotes from this browser session. There is no cross-chain execution record because none was submitted.</p>
      <Link className="btn" to="/app/activity/new">Request a dry quote</Link>
      <div className="filters">
        <Field label="Kind">
          <select value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
            <option value="all">All</option>
            <option value="read">Reads</option>
            <option value="draft">Drafts</option>
            <option value="quote">Quotes</option>
          </select>
        </Field>
        <Field label="Search">
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </Field>
      </div>
      {rows.length === 0 ? <p>Nothing in this session matches.</p> : (
        <table className="data">
          <thead><tr><th>When</th><th>Kind</th><th>Record</th><th>Detail</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.kind}-${row.href}`}>
                <td>{new Date(row.at).toLocaleString()}</td>
                <td>{row.kind}</td>
                <td><Link to={row.href}>{row.title}</Link></td>
                <td>{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
