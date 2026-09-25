import { PageHeader } from '../../components/ui/Layout.jsx';
import { ShieldAIWorkspace } from '../../features/shieldai/ShieldAIWorkspace.jsx';

export default function AdminShieldAI() {
  return (
    <>
      <PageHeader title="Shield AI" description="Investigate stored security evidence with controlled tools. Actions always require your confirmation." />
      <ShieldAIWorkspace />
    </>
  );
}
