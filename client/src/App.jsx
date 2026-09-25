import { lazy } from 'react';
import { Route, Routes } from 'react-router';
import AppShell from './layouts/AppShell.jsx';
import AuthLayout from './layouts/AuthLayout.jsx';
import PublicLayout from './layouts/PublicLayout.jsx';
import { PublicOnly, RequireAuth, RequireRole } from './routes/guards.jsx';

// Routes follow the frontend skill §48.
const Landing = lazy(() => import('./pages/Landing.jsx'));
const Privacy = lazy(() => import('./pages/legal/Privacy.jsx'));
const Terms = lazy(() => import('./pages/legal/Terms.jsx'));
const Login = lazy(() => import('./pages/Login.jsx'));
const Register = lazy(() => import('./pages/Register.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Files = lazy(() => import('./pages/Files.jsx'));
const FileDetails = lazy(() => import('./pages/FileDetails.jsx'));
const Shares = lazy(() => import('./pages/Shares.jsx'));
const Activity = lazy(() => import('./pages/Activity.jsx'));
const Security = lazy(() => import('./pages/Security.jsx'));
const Assistant = lazy(() => import('./pages/Assistant.jsx'));
const PublicShare = lazy(() => import('./pages/PublicShare.jsx'));
const AdminOverview = lazy(() => import('./pages/admin/AdminOverview.jsx'));
const AdminIncidents = lazy(() => import('./pages/admin/AdminIncidents.jsx'));
const AdminIncidentDetails = lazy(() => import('./pages/admin/AdminIncidentDetails.jsx'));
const AdminAlerts = lazy(() => import('./pages/admin/AdminAlerts.jsx'));
const AdminRecovery = lazy(() => import('./pages/admin/AdminRecovery.jsx'));
const AdminDetection = lazy(() => import('./pages/admin/AdminDetection.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers.jsx'));
const AdminFiles = lazy(() => import('./pages/admin/AdminFiles.jsx'));
const AdminQuarantine = lazy(() => import('./pages/admin/AdminQuarantine.jsx'));
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit.jsx'));
const AdminAnalytics = lazy(() => import('./pages/admin/AdminAnalytics.jsx'));
const AdminSimulator = lazy(() => import('./pages/admin/AdminSimulator.jsx'));
const AdminShieldAI = lazy(() => import('./pages/admin/AdminShieldAI.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

export default function App() {
  return (
    <Routes>
      {/* Landing and legal pages: public for everyone, signed in or not. */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
      </Route>

      {/* Public share page: no account, no auth guard, never uses the signed-in token. */}
      <Route path="/s/:token" element={<PublicShare />} />

      <Route element={<PublicOnly />}>
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Route>
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/app" element={<Dashboard />} />
          <Route path="/app/files" element={<Files />} />
          <Route path="/app/files/:id" element={<FileDetails />} />
          <Route path="/app/shares" element={<Shares />} />
          <Route path="/app/activity" element={<Activity />} />
          <Route path="/app/security" element={<Security />} />
          <Route path="/app/assistant" element={<Assistant />} />
          <Route element={<RequireRole role="admin" />}>
            <Route path="/admin" element={<AdminOverview />} />
            <Route path="/admin/incidents" element={<AdminIncidents />} />
            <Route path="/admin/incidents/:id" element={<AdminIncidentDetails />} />
            <Route path="/admin/alerts" element={<AdminAlerts />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/files" element={<AdminFiles />} />
            <Route path="/admin/quarantine" element={<AdminQuarantine />} />
            <Route path="/admin/recovery" element={<AdminRecovery />} />
            <Route path="/admin/detection" element={<AdminDetection />} />
            <Route path="/admin/analytics" element={<AdminAnalytics />} />
            <Route path="/admin/simulator" element={<AdminSimulator />} />
            <Route path="/admin/shield-ai" element={<AdminShieldAI />} />
            <Route path="/admin/audit" element={<AdminAudit />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
