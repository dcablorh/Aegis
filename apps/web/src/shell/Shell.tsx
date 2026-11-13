import { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { setNetwork, useSession } from "../lib/session";
import { Mark, Wordmark } from "../ui";

const NAV = [
  { to: "/app", label: "Overview", end: true },
  { to: "/app/positions", label: "Positions", end: false },
  { to: "/app/protection", label: "Protection", end: false },
  { to: "/app/activity", label: "Activity", end: false },
  { to: "/app/security", label: "Security", end: false },
  { to: "/app/settings", label: "Settings", end: false },
];

export function Shell() {
  const session = useSession();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const crumbs = breadcrumbs(location.pathname);

  return (
    <div className="shell" data-collapsed={collapsed ? "true" : "false"}>
      <aside className="side" data-open={open ? "true" : "false"}>
        <NavLink className="side-brand" to="/" onClick={() => setOpen(false)}>
          <Mark />
          <Wordmark />
        </NavLink>
        <nav aria-label="Application">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setOpen(false)}>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <button className="side-toggle" type="button" onClick={() => setCollapsed((value) => !value)}>
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </aside>
      <div className="shell-main">
        <header className="app-top">
          <button className="menu" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>Menu</button>
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((crumb, index) => (
              <span key={crumb.label}>
                {index > 0 ? <span className="crumb-sep">/</span> : null}
                {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span>{crumb.label}</span>}
              </span>
            ))}
          </nav>
          <label className="net">
            <span>Network</span>
            <select value={session.network} onChange={(event) => setNetwork(event.target.value as "testnet" | "mainnet")}>
              <option value="testnet">Testnet</option>
              <option value="mainnet">Mainnet</option>
            </select>
          </label>
        </header>
        <p className="wallet-line">Non-custodial interface: Read-only RPC telemetry and client-side encryption. Zero private key exposure.</p>
        <main id="content" className="app-main" key={location.pathname}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function breadcrumbs(pathname: string): { label: string; to?: string }[] {
  if (pathname === "/app") return [{ label: "Overview" }];
  if (pathname === "/app/positions") return [{ label: "Overview", to: "/app" }, { label: "Positions" }];
  if (pathname.startsWith("/app/positions/")) return [{ label: "Positions", to: "/app/positions" }, { label: "Detail" }];
  if (pathname === "/app/protection") return [{ label: "Overview", to: "/app" }, { label: "Protection" }];
  if (pathname === "/app/protection/new") return [{ label: "Protection", to: "/app/protection" }, { label: "New draft" }];
  if (pathname.startsWith("/app/protection/drafts/")) return [{ label: "Protection", to: "/app/protection" }, { label: "Draft" }];
  if (pathname === "/app/activity") return [{ label: "Overview", to: "/app" }, { label: "Activity" }];
  if (pathname === "/app/activity/new") return [{ label: "Activity", to: "/app/activity" }, { label: "Dry quote" }];
  if (pathname.startsWith("/app/activity/quotes/")) return [{ label: "Activity", to: "/app/activity" }, { label: "Quote" }];
  if (pathname === "/app/security") return [{ label: "Overview", to: "/app" }, { label: "Security" }];
  if (pathname === "/app/settings") return [{ label: "Overview", to: "/app" }, { label: "Settings" }];
  return [{ label: "App", to: "/app" }];
}
