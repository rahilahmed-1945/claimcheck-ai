import { ENGINE_VERSION } from "@shared/types";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Icon } from "./Icon";

const NAV = [
  { to: "/", label: "New audit", icon: "plus" as const, end: true },
  { to: "/reports", label: "Reports", icon: "list" as const, end: false },
  { to: "/evaluation", label: "Evaluation", icon: "flask" as const, end: true },
  { to: "/methodology", label: "How it works", icon: "book" as const, end: false },
];

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="ClaimCheck AI home">
      <span className="brand-mark" aria-hidden="true">
        <Icon name="fileCheck" size={19} />
      </span>
      <span className="brand-name">
        ClaimCheck <span className="brand-ai">AI</span>
      </span>
    </Link>
  );
}

export function AppShell() {
  const location = useLocation();
  const reportsActive =
    location.pathname.startsWith("/reports") || location.pathname.startsWith("/audits");

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Brand />
        <nav className="sidebar-nav" aria-label="Primary">
          <span className="nav-label">Workbench</span>
          {NAV.map((item) => {
            const isActive = item.to === "/reports" ? reportsActive : location.pathname === item.to;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={`nav-item${isActive ? " is-active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                aria-label={item.label}
                title={item.label}
              >
                <Icon name={item.icon} size={17} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />

        <div className="engine-card">
          <span className="engine-dot" aria-hidden="true" />
          <div>
            <strong>Engine {ENGINE_VERSION}</strong>
            <span>Deterministic · local</span>
          </div>
        </div>
        <p className="sidebar-note">
          Findings link claims to extracted evidence. They are not verdicts on research validity.
        </p>
      </aside>

      <main className="main" id="main-content">
        <Outlet />
      </main>
    </div>
  );
}
