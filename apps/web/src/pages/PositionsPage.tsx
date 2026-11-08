import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { SAMPLE_ACCOUNT } from "../config";
import { useSession, type Network } from "../lib/session";
import { Button, Field } from "../ui";

export function PositionsPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [accountId, setAccountId] = useState(SAMPLE_ACCOUNT);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "account">("newest");
  const rows = useMemo(() => {
    const filtered = session.reads.filter((row) => row.accountId.toLowerCase().includes(query.trim().toLowerCase()));
    return [...filtered].sort((a, b) => sort === "account" ? a.accountId.localeCompare(b.accountId) : b.at.localeCompare(a.at));
  }, [session.reads, query, sort]);

  return (
    <>
      <p className="kicker">Positions</p>
      <h1>Burrow accounts</h1>
      <p className="lede">Each row is an account read in this tab. Opening one loads a fresh view from RPC. Network for a new read is {session.network}, from Settings.</p>
      <form className="toolbar wide" onSubmit={(event) => { event.preventDefault(); navigate(`/app/positions/${encodeURIComponent(accountId.trim())}?network=${session.network}`); }}>
        <Field label="Account" hint="The Burrow account id, not a deposit address.">
          <input value={accountId} onChange={(event) => setAccountId(event.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <Button type="submit" disabled={accountId.trim().length === 0}>Open position</Button>
      </form>
      <div className="filters">
        <Field label="Search">
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </Field>
        <Field label="Sort">
          <select value={sort} onChange={(event) => setSort(event.target.value as "newest" | "account")}>
            <option value="newest">Newest</option>
            <option value="account">Account</option>
          </select>
        </Field>
      </div>
      {rows.length === 0 ? <p>No account has been read in this browser session.</p> : (
        <div className="scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Account</th>
                <th>Network</th>
                <th>Health</th>
                <th>Collateral</th>
                <th>Debt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><Link to={`/app/positions/${encodeURIComponent(row.accountId)}?network=${row.network}`}>{row.accountId}</Link></td>
                  <td>{row.network}</td>
                  <td>{row.healthLabel}</td>
                  <td className="num">{row.collateralCount}</td>
                  <td className="num">{row.debtCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function positionPath(accountId: string, network: Network): string {
  return `/app/positions/${encodeURIComponent(accountId)}?network=${network}`;
}
