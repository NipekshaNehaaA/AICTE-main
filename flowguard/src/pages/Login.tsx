import { AlertCircle, ArrowLeft, Check, Copy, Eye, EyeOff, Loader2, ShieldCheck, Smartphone } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import aicteLogo from '../assets/aicte-logo.png';

type Step = 'CREDENTIALS' | 'TOTP_VERIFY' | 'TOTP_SETUP';

export default function Login() {
  const { login, verifyTotp } = useAuth();
  const nav = useNavigate();

  // Credentials state
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);

  // TOTP state
  const [step, setStep] = useState<Step>('CREDENTIALS');
  const [challengeToken, setChallengeToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [activeUserLabel, setActiveUserLabel] = useState('');
  const [copied, setCopied] = useState(false);

  // Status & error
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleWorkspaceRedirect(ws: string) {
    nav(ws === 'INSTITUTION' ? '/' : ws === 'GOVERNANCE' ? '/official/rules' : '/official', { replace: true });
  }

  async function submitCredentials(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!loginId.trim()) return setError('Please enter your assigned User ID.');
    if (!password) return setError('Please enter your password.');
    setBusy(true);
    try {
      const res = await login(loginId.trim(), password);
      if ('success' in res && res.success) {
        handleWorkspaceRedirect(res.workspace);
      } else if ('requireTotp' in res && res.requireTotp) {
        setChallengeToken(res.challengeToken);
        setActiveUserLabel(res.fullName || res.loginId);
        setTotpCode('');
        setStep('TOTP_VERIFY');
      } else if ('requireTotpSetup' in res && res.requireTotpSetup) {
        setChallengeToken(res.challengeToken);
        setQrCodeDataUrl(res.qrCodeDataUrl);
        setTotpSecret(res.secret);
        setActiveUserLabel(res.fullName || res.loginId);
        setTotpCode('');
        setStep('TOTP_SETUP');
      }
    } catch (err: any) {
      setError(err.message ?? 'Sign-in failed. Please check your credentials.');
    } finally {
      setBusy(false);
    }
  }

  async function submitTotp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const clean = totpCode.trim();
    if (!clean || clean.length !== 6 || !/^\d{6}$/.test(clean)) {
      return setError('Please enter a valid 6-digit verification code.');
    }
    setBusy(true);
    try {
      const ws = await verifyTotp(challengeToken, clean);
      handleWorkspaceRedirect(ws);
    } catch (err: any) {
      setError(err.message ?? 'Verification failed. Please check the code in your authenticator app.');
    } finally {
      setBusy(false);
    }
  }

  function copySecret() {
    if (!totpSecret) return;
    navigator.clipboard.writeText(totpSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function resetToCredentials() {
    setStep('CREDENTIALS');
    setTotpCode('');
    setError(null);
    setChallengeToken('');
    setQrCodeDataUrl('');
    setTotpSecret('');
  }

  const field =
    'w-full rounded-xl border border-neutral-300 bg-white px-4 py-3.5 text-[15px] text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none transition';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-12 text-neutral-900">
      <div className="w-full max-w-[460px] rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="mb-4 flex justify-center">
          <img src={aicteLogo} alt="AICTE" className="h-14 w-14 object-contain" />
        </div>

        {step === 'CREDENTIALS' && (
          <>
            <h1 className="text-center text-2xl font-bold tracking-tight text-neutral-900">AICTE Approval Portal</h1>
            <p className="mt-2 mb-8 text-center text-sm text-neutral-500">
              Unified Approval Workflow &amp; Compliance Management Portal
            </p>

            <form onSubmit={submitCredentials} noValidate className="space-y-5">
              <div>
                <label htmlFor="uid" className="mb-2 block text-sm font-semibold text-neutral-700">
                  User ID
                </label>
                <input
                  id="uid"
                  type="text"
                  autoComplete="username"
                  className={field}
                  placeholder="Enter your assigned User ID"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  disabled={busy}
                />
              </div>

              <div>
                <label htmlFor="pw" className="mb-2 block text-sm font-semibold text-neutral-700">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="pw"
                    type={show ? 'text' : 'password'}
                    autoComplete="current-password"
                    className={`${field} pr-12`}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    aria-label={show ? 'Hide password' : 'Show password'}
                    onClick={() => setShow((s) => !s)}
                    className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1.5 text-neutral-400 hover:text-neutral-700"
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 py-3.5 text-[15px] font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-60 cursor-pointer"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? 'Verifying credentials…' : 'Sign In'}
              </button>
            </form>
          </>
        )}

        {step === 'TOTP_VERIFY' && (
          <>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h1 className="text-center text-xl font-bold tracking-tight text-neutral-900">Two-Factor Authentication</h1>
            <p className="mt-1 mb-6 text-center text-sm text-neutral-500">
              Enter the 6-digit code from your authenticator app for <strong className="text-neutral-800">{activeUserLabel}</strong>
            </p>

            <form onSubmit={submitTotp} noValidate className="space-y-5">
              <div>
                <label htmlFor="totp-code" className="mb-2 block text-center text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  6-Digit Security Code
                </label>
                <input
                  id="totp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoFocus
                  placeholder="000000"
                  className="mx-auto block w-52 rounded-xl border-2 border-neutral-300 bg-neutral-50 py-3 text-center font-mono text-3xl font-bold tracking-[0.35em] text-neutral-900 placeholder:text-neutral-300 focus:border-neutral-900 focus:bg-white focus:outline-none"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  disabled={busy}
                />
              </div>

              {error && (
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={busy || totpCode.length !== 6}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 py-3.5 text-[15px] font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-60 cursor-pointer"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? 'Validating code…' : 'Verify & Sign In'}
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={resetToCredentials}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 cursor-pointer"
                >
                  <ArrowLeft className="h-4 w-4" /> Back to User ID / Password
                </button>
              </div>
            </form>
          </>
        )}

        {step === 'TOTP_SETUP' && (
          <>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-700">
              <Smartphone className="h-6 w-6" />
            </div>
            <h1 className="text-center text-xl font-bold tracking-tight text-neutral-900">Set Up Authenticator (TOTP)</h1>
            <p className="mt-1 mb-5 text-center text-xs text-neutral-500">
              Mandatory two-factor authentication for <strong className="text-neutral-800">{activeUserLabel}</strong>
            </p>

            <div className="space-y-4 rounded-xl border border-neutral-200 bg-neutral-50/70 p-4 text-xs text-neutral-600">
              <div>
                <span className="font-semibold text-neutral-800">1. Scan QR code</span>
                <p className="mt-0.5 text-neutral-500">
                  Open Google Authenticator, Microsoft Authenticator, or Aegis on your mobile device and scan this code:
                </p>
                {qrCodeDataUrl && (
                  <div className="mt-2.5 flex justify-center">
                    <div className="rounded-lg border border-neutral-200 bg-white p-2 shadow-xs">
                      <img src={qrCodeDataUrl} alt="TOTP QR Code" className="h-44 w-44 object-contain" />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <span className="font-semibold text-neutral-800">2. Or enter secret manually:</span>
                <div className="mt-1.5 flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-[11px] text-neutral-700">
                  <span className="select-all tracking-wider">{totpSecret.match(/.{1,4}/g)?.join(' ') || totpSecret}</span>
                  <button
                    type="button"
                    onClick={copySecret}
                    className="ml-2 inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-[11px] font-sans font-medium text-neutral-700 hover:bg-neutral-200 cursor-pointer"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>

            <form onSubmit={submitTotp} noValidate className="mt-5 space-y-4">
              <div>
                <label htmlFor="setup-totp-code" className="mb-1.5 block text-center text-xs font-semibold text-neutral-700">
                  3. Enter the 6-digit code shown in your app to activate:
                </label>
                <input
                  id="setup-totp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  className="mx-auto block w-52 rounded-xl border-2 border-neutral-300 bg-neutral-50 py-3 text-center font-mono text-3xl font-bold tracking-[0.35em] text-neutral-900 placeholder:text-neutral-300 focus:border-neutral-900 focus:bg-white focus:outline-none"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  disabled={busy}
                />
              </div>

              {error && (
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={busy || totpCode.length !== 6}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 py-3.5 text-[15px] font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-60 cursor-pointer"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? 'Activating 2FA…' : 'Activate 2FA & Sign In'}
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={resetToCredentials}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 cursor-pointer"
                >
                  <ArrowLeft className="h-4 w-4" /> Back to User ID / Password
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
