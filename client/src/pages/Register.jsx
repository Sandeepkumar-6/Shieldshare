import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../components/ui/Button.jsx';
import { Input } from '../components/ui/Field.jsx';
import { Notice } from '../components/ui/States.jsx';
import { useAuth } from '../state/AuthContext.jsx';

const MIN_PASSWORD = 8; // mirrors the server rule; the server stays authoritative

export default function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const passwordTooShort = form.password.length > 0 && form.password.length < MIN_PASSWORD;

  async function onSubmit(event) {
    event.preventDefault();
    setTouched(true);
    if (form.password.length < MIN_PASSWORD) return;
    setBusy(true);
    setError(null);
    try {
      await register(form); // PublicOnly redirects to the workspace
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  const update = (field) => (event) => setForm((values) => ({ ...values, [field]: event.target.value }));

  return (
    <>
      <h1 className="text-title font-semibold text-fg">Create your account</h1>
      <p className="mt-1 text-body text-fg-secondary">Your workspace starts with a Home folder.</p>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        {error && <Notice tone="critical" title="Couldn't create the account">{error.message}</Notice>}
        <Input label="Name" autoComplete="name" required maxLength={100} value={form.name} onChange={update('name')} />
        <Input label="Email" type="email" autoComplete="email" required value={form.email} onChange={update('email')} />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={form.password}
          onChange={update('password')}
          hint={`At least ${MIN_PASSWORD} characters.`}
          error={(touched || passwordTooShort) && form.password.length < MIN_PASSWORD
            ? `Use at least ${MIN_PASSWORD} characters.`
            : null}
        />
        <p className="text-meta text-fg-muted">
          By creating an account you accept the{' '}
          <Link to="/terms" className="text-accent hover:underline">terms of service</Link> and confirm you have read the{' '}
          <Link to="/privacy" className="text-accent hover:underline">privacy policy</Link>, including how file activity is monitored.
        </p>
        <Button type="submit" variant="primary" loading={busy} className="mt-1 w-full justify-center">
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-body text-fg-secondary">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-accent hover:underline hover:underline-offset-2">
          Sign in
        </Link>
      </p>
    </>
  );
}
