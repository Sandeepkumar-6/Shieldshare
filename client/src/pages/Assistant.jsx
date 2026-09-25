import { Navigate } from 'react-router';
import { PageHeader } from '../components/ui/Layout.jsx';
import { ShieldAIWorkspace } from '../features/shieldai/ShieldAIWorkspace.jsx';
import { useAuth } from '../state/AuthContext.jsx';

export default function Assistant() {
  // The server gives administrators Shield AI on every /api/ai route; keep one entry point for it.
  const { user } = useAuth();
  if (user?.role === 'admin') return <Navigate to="/admin/shield-ai" replace />;
  return (
    <>
      <PageHeader
        title="Assistant"
        description="Ask about your files, sharing links, recent activity, or account status. The assistant can only read records you are allowed to see."
      />
      <ShieldAIWorkspace context={{ page: 'assistant' }} />
    </>
  );
}
