import { useEffect } from "react";
import { Link, Route, BrowserRouter, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Icon } from "./components/Icon";
import { AuditPage } from "./pages/AuditPage";
import { EvaluationPage } from "./pages/EvaluationPage";
import { HomePage } from "./pages/HomePage";
import { MethodologyPage } from "./pages/MethodologyPage";
import { ReportsPage } from "./pages/ReportsPage";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);
  return null;
}

function NotFoundPage() {
  return (
    <div className="page page-narrow">
      <div className="empty-reports card" style={{ marginTop: "8vh" }}>
        <span className="empty-icon">
          <Icon name="search" size={23} />
        </span>
        <h2>Page not found</h2>
        <p>The page you requested does not exist in this workbench.</p>
        <div className="empty-actions">
          <Link to="/" className="button button-primary">
            Back to the workbench
          </Link>
          <Link to="/reports" className="button button-secondary">
            View reports
          </Link>
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="audits/:id" element={<AuditPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="evaluation" element={<EvaluationPage />} />
          <Route path="methodology" element={<MethodologyPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
