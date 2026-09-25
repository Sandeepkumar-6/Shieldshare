import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '../components/ui/Button.jsx';
import { Input } from '../components/ui/Field.jsx';
import { Notice } from '../components/ui/States.jsx';
import { useAuth } from '../state/AuthContext.jsx';

export default function Login() {
  const { login, endedReason } = useAuth();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const sessionNotice = location.state?.reason || endedReason;

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(form); // PublicOnly redirects once signed in
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  const update = (field) => (event) => setForm((values) => ({ ...values, [field]: event.target.value }));

  return (
    <>
      <h1 className="text-title font-semibold text-fg">Sign in</h1>
      <p className="mt-1 text-body text-fg-secondary">Use the account you registered with ShieldShare.</p>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        {sessionNotice && !error && <Notice tone="info">{sessionNotice}</Notice>}
        {error && <Notice tone="critical" title="Couldn't sign in">{error.message}</Notice>}
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={update('email')}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={form.password}
          onChange={update('password')}
        />
        <Button type="submit" variant="primary" loading={busy} className="mt-1 w-full justify-center">
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-body text-fg-secondary">
        New to ShieldShare?{' '}
        <Link to="/register" className="font-medium text-accent hover:underline hover:underline-offset-2">
          Create an account
        </Link>
      </p>
    </>
  );
}
