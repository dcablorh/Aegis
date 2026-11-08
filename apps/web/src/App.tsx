import { useEffect, useState, type MouseEvent } from "react";
import { PositionPage } from "./pages/PositionPage";
import { ProtectionPage } from "./pages/ProtectionPage";
import { QuotePage } from "./pages/QuotePage";
import { SecurityPage } from "./pages/SecurityPage";
import { Mark } from "./ui";

const LINKS = [
  { href: "/", label: "Position" },
  { href: "/protection", label: "Protection" },
  { href: "/quote", label: "Quote" },
  { href: "/security", label: "Allowlist" },
];

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  function go(event: MouseEvent<HTMLAnchorElement>, href: string) {
    event.preventDefault();
    window.history.pushState({}, "", href);
    setPath(href);
  }
  return { path, go };
}

export function App() {
  const { path, go } = usePath();
  const page = path === "/protection" ? <ProtectionPage />
    : path === "/quote" ? <QuotePage />
    : path === "/security" ? <SecurityPage />
    : <PositionPage />;
  return (
    <>
      <a className="skip" href="#content">Skip to content</a>
      <header className="top">
        <a className="brand" href="/" onClick={(event) => go(event, "/")}>
          <Mark />
          <span className="brand-copy">
            <strong>AegisMargin</strong>
            <span>Testnet reads · dry-run quotes</span>
          </span>
        </a>
        <nav aria-label="Primary">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} aria-current={path === link.href || (link.href === "/" && path === "") ? "page" : undefined} onClick={(event) => go(event, link.href)}>
              {link.label}
            </a>
          ))}
        </nav>
      </header>
      <main id="content" key={path} className="page">{page}</main>
    </>
  );
}
