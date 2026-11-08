import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { ActivityPage } from "./pages/ActivityPage";
import { DraftPage } from "./pages/DraftPage";
import { LandingPage } from "./pages/LandingPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PositionDetailPage } from "./pages/PositionDetailPage";
import { PositionsPage } from "./pages/PositionsPage";
import { ProtectionCentrePage } from "./pages/ProtectionCentrePage";
import { ProtectionNewPage } from "./pages/ProtectionNewPage";
import { QuoteDetailPage } from "./pages/QuoteDetailPage";
import { QuoteNewPage } from "./pages/QuoteNewPage";
import { SecurityPage } from "./pages/SecurityPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Shell } from "./shell/Shell";

export function App() {
  return (
    <BrowserRouter>
      <a className="skip" href="#content">Skip to content</a>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/app" element={<Shell />}>
          <Route index element={<OverviewPage />} />
          <Route path="positions" element={<PositionsPage />} />
          <Route path="positions/:accountId" element={<PositionDetailPage />} />
          <Route path="protection" element={<ProtectionCentrePage />} />
          <Route path="protection/new" element={<ProtectionNewPage />} />
          <Route path="protection/drafts/:draftId" element={<DraftPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="activity/new" element={<QuoteNewPage />} />
          <Route path="activity/quotes/:quoteId" element={<QuoteDetailPage />} />
          <Route path="security" element={<SecurityPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="/protection" element={<Navigate to="/app/protection" replace />} />
        <Route path="/quote" element={<Navigate to="/app/activity/new" replace />} />
        <Route path="/security" element={<Navigate to="/app/security" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
