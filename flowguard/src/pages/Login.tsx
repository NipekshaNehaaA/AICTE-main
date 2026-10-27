import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  KeyRound,
  Users,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import aicteLogo from '../assets/aicte-logo.png';

type Step = 'CREDENTIALS' | 'TOTP_VERIFY' | 'TOTP_SETUP';

const QUICK_DEMO_ACCOUNTS = [
  { label: 'Applicant (Institute A)', loginId: 'applicant.demo', pass: 'Applicant@2026', role: 'Principal' },
  { label: 'Scrutiny Officer', loginId: 'scrutiny.officer', pass: 'Official@2026', role: 'Scrutiny Committee' },
  { label: 'Re-Scrutiny Officer', loginId: 'rescrutiny.officer', pass: 'Official@2026', role: 'Re-Scrutiny' },
  { label: 'Regional Officer', loginId: 'regional.officer', pass: 'Official@2026', role: 'Regional Office' },
  { label: 'EVC Member', loginId: 'evc.member', pass: 'Official@2026', role: 'Expert Visit' },
  { label: 'SHC Member', loginId: 'shc.member', pass: 'Official@2026', role: 'Hearing Committee' },
  { label: 'System Admin', loginId: 'sys.admin', pass: 'Official@2026', role: 'Administrator' },
];

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
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);

  // Status & error
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleWorkspaceRedirect(ws: string) {
    nav(ws === 'INSTITUTION' ? '/' : ws === 'GOVERNANCE' ? '/official/rules' : '/official', { replace: true });
  }

  async function submitCredentials(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResetSuccess(null);
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

  async function handleResetCurrentTotp() {
    if (!challengeToken) return;
    setBusy(true);
    setError(null);
    try {
      const res: any = await api.post('/api/auth/reset-totp', { challengeToken });
      if (res?.requireTotpSetup) {
        setChallengeToken(res.challengeToken);
        setQrCodeDataUrl(res.qrCodeDataUrl);
        setTotpSecret(res.secret);
        setActiveUserLabel(res.fullName || res.loginId);
        setTotpCode('');
        setStep('TOTP_SETUP');
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to reset QR code. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleResetAllAccounts() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/reset-all-totp');
      setResetSuccess('All accounts have been reset. Signing in will now present a fresh QR code.');
      setTimeout(() => setResetSuccess(null), 5000);
    } catch (err: any) {
      setError(err.message ?? 'Failed to reset all accounts.');
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

  function selectDemoAccount(acc: typeof QUICK_DEMO_ACCOUNTS[0]) {
    setLoginId(acc.loginId);
    setPassword(acc.pass);
    setError(null);
    setResetSuccess(null);
  }

  const field =
    'block w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none transition';

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-[460px] rounded-3xl bg-white p-8 shadow-xl shadow-slate-200/50 border border-slate-200/80">
        <div className="mb-6 flex items-center justify-center gap-3">
          <img src={aicteLogo} alt="AICTE Logo" className="h-12 w-12 object-contain" />
          <div>
            <div className="text-[11px] font-bold tracking-[0.2em] uppercase text-slate-500">AICTE FlowGuard</div>
            <div className="text-xl font-extrabold text-navy-900">Unified Approval Portal</div>
          </div>
        </div>

        {step === 'CREDENTIALS' && (
          <>
            <h1 className="text-center text-xl font-bold tracking-tight text-neutral-900">Sign in to your account</h1>
            <p className="mt-1 mb-6 text-center text-sm text-neutral-500">
              Enter your credentials to continue with 2FA verification
            </p>

            {resetSuccess && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800">
                <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>{resetSuccess}</span>
              </div>
            )}

            <form onSubmit={submitCredentials} noValidate className="space-y-4">
              <div>
                <label htmlFor="login-id" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-neutral-600">
                  User ID / Login ID
                </label>
                <input
                  id="login-id"
                  type="text"
                  autoComplete="username"
                  className={field}
                  placeholder="e.g. applicant.demo"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  disabled={busy}
                />
              </div>

              <div>
                <label htmlFor="pw" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-neutral-600">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="pw"
                    type={show ? 'text' : 'password'}
                    autoComplete="current-password"
                    className={`${field} pr-12`}
                    placeholder="Enter password"
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
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-900 py-3.5 text-sm font-semibold text-white transition hover:bg-indigo-800 disabled:opacity-60 cursor-pointer shadow-md shadow-indigo-950/20"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? 'Verifying credentials…' : 'Sign In with 2FA'}
              </button>

              {/* Quick demo roles */}
              <div className="pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-indigo-600" /> Demo Roles & Rights:
                  </span>
                  <button
                    type="button"
                    onClick={handleResetAllAccounts}
                    disabled={busy}
                    className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 hover:underline"
                    title="Reset all demo accounts to show new QR codes on next login"
                  >
                    <RefreshCw className="w-2.5 h-2.5" /> Reset All QR Codes
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  {QUICK_DEMO_ACCOUNTS.map((acc, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => selectDemoAccount(acc)}
                      className={`text-left px-2.5 py-1.5 rounded-lg border text-[11px] transition-all ${
                        loginId === acc.loginId
                          ? 'border-indigo-600 bg-indigo-50/80 text-indigo-950 font-semibold'
                          : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/80 text-slate-700'
                      }`}
                    >
                      <div className="truncate font-medium">{acc.label}</div>
                      <div className="text-[10px] text-slate-400 font-mono truncate">{acc.loginId}</div>
                    </button>
                  ))}
                </div>
              </div>
            </form>
          </>
        )}

        {step === 'TOTP_VERIFY' && (
          <>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h1 className="text-center text-xl font-bold tracking-tight text-neutral-900">Two-Factor Authentication</h1>
            <p className="mt-1 mb-6 text-center text-xs text-neutral-500">
              Enter the 6-digit code from your authenticator app for <strong className="text-neutral-800">{activeUserLabel}</strong>
            </p>

            <form onSubmit={submitTotp} noValidate className="space-y-4">
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
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={busy || totpCode.length !== 6}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-900 py-3.5 text-sm font-semibold text-white transition hover:bg-indigo-800 disabled:opacity-60 cursor-pointer shadow-md"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? 'Validating code…' : 'Verify & Sign In'}
              </button>

              <div className="pt-3 border-t border-slate-100 flex flex-col items-center gap-2 text-center">
                <button
                  type="button"
                  onClick={handleResetCurrentTotp}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                >
                  <RefreshCw className="h-3 w-3" /> Need a new QR code? Reset & Re-scan
                </button>
                <button
                  type="button"
                  onClick={resetToCredentials}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-900"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to User ID / Password
                </button>
              </div>
            </form>
          </>
        )}

        {step === 'TOTP_SETUP' && (
          <>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">
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
                  Open Google Authenticator, Microsoft Authenticator, or Aegis on your phone and scan:
                </p>
                {qrCodeDataUrl && (
                  <div className="mt-2.5 flex justify-center">
                    <div className="rounded-xl border border-neutral-200 bg-white p-2.5 shadow-sm">
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
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={busy || totpCode.length !== 6}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-900 py-3.5 text-sm font-semibold text-white transition hover:bg-indigo-800 disabled:opacity-60 cursor-pointer shadow-md"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? 'Activating 2FA…' : 'Activate 2FA & Sign In'}
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={resetToCredentials}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-900"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to User ID / Password
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
