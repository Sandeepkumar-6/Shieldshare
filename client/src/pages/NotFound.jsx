import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/States.jsx';

export default function NotFound() {
  return (
    <EmptyState
      icon="alertCircle"
      title="Page not found"
      titleAs="h1"
      description="The address may be mistyped, or the page no longer exists."
      action={<Button to="/app" icon="arrowLeft">Back to overview</Button>}
    />
  );
}
