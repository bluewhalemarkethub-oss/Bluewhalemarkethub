import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  X,
  ShieldCheck,
  Mail,
  Lock,
  Globe,
  Phone,
  User,
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Upload,
  FileText,
  Trash2,
} from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { ApiRequestError, apiRequest } from '../lib/apiClient';
import { CRYPTO_WALLETS, SUPPORTED_COUNTRIES, type CryptoCurrencyCode } from '../data/shippingCatalog';
import { submitFirebaseRegistrationPayment } from '../services/firestoreMarketplace';
import { QrCodeCanvas } from './QrCodeCanvas';
import { processRegistrationScreenshotFile } from './RegistrationVerificationView';
import {
  getActivationBlockedMessage,
  getPaymentStatus,
  getSimpleAccountStatus,
  hasDashboardAccess,
  REGISTRATION_FEE_USD,
  SUPPORT_EMAIL,
  type EmailNotification,
  type UserAccount,
} from '../types/marketplace';

type AuthTab =
  | 'login'
  | 'register'
  | 'forgot'
  | 'verify-email'
  | 'registration-payment'
  | 'registration-pending';

interface AuthModalProps {
  isOpen: boolean;
  initialTab?: 'login' | 'register';
  initialMessage?: string;
  onClose: () => void;
  onJwtSuccess: (payload: {
    token: string;
    user: UserAccount;
    emailDispatch?: EmailNotification;
    verificationPreviewCode?: string;
  }) => void;
  onGoogleSuccess: (extraProfile: {
    fullName: string;
    username: string;
    country: string;
    phoneNumber: string;
  }) => Promise<UserAccount | void>;
}

export function AuthModal({
  isOpen,
  initialTab = 'login',
  initialMessage = '',
  onClose,
  onJwtSuccess,
  onGoogleSuccess,
}: AuthModalProps) {
  const [tab, setTab] = useState<AuthTab>(initialTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoBanner, setInfoBanner] = useState('');
  const [registrationSuccessEmail, setRegistrationSuccessEmail] = useState('');

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [needs2FA, setNeeds2FA] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');

  // Registration fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [country, setCountry] = useState<string>('United States');
  const [regPassword, setRegPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [humanChecked, setHumanChecked] = useState(false);
  const [spamAnswer, setSpamAnswer] = useState('');

  const spamChallenge = useMemo(() => ({ a: 4, b: 3, sum: 7 }), []);

  // Registration $10 USD Payment Proof state
  const [regPaymentMode, setRegPaymentMode] = useState<'jwt' | 'firebase'>('jwt');
  const [regPaymentToken, setRegPaymentToken] = useState<string | null>(null);
  const [regPaymentUser, setRegPaymentUser] = useState<UserAccount | null>(null);
  const [regFeeUsd, setRegFeeUsd] = useState<number>(REGISTRATION_FEE_USD);
  const [regCrypto, setRegCrypto] = useState<CryptoCurrencyCode>('USDT_TRC20');
  const [regPayAmount, setRegPayAmount] = useState<string>(String(REGISTRATION_FEE_USD));
  const [regTxId, setRegTxId] = useState('');
  const [regReceiptUrl, setRegReceiptUrl] = useState('');
  const [regReceiptName, setRegReceiptName] = useState('');
  const [regProcessingFile, setRegProcessingFile] = useState(false);
  const [regCopiedAddr, setRegCopiedAddr] = useState(false);
  const [regSubmittedPaymentStatus, setRegSubmittedPaymentStatus] = useState<string>('pending_verification');
  const [loginPaymentPromptToken, setLoginPaymentPromptToken] = useState<string | null>(null);
  const regFileInputRef = useRef<HTMLInputElement | null>(null);

  // Email verification state
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<UserAccount | null>(null);
  const [verificationCodeInput, setVerificationCodeInput] = useState('');
  const [previewVerificationCode, setPreviewVerificationCode] = useState('');

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [newResetPassword, setNewResetPassword] = useState('');
  const [previewResetCode, setPreviewResetCode] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      setError(initialMessage || '');
      setInfoBanner('');
      setNeeds2FA(false);
      setLoginPaymentPromptToken(null);
      setRegPaymentToken(null);
      setRegPaymentUser(null);
      setRegTxId('');
      setRegReceiptUrl('');
      setRegReceiptName('');
      setRegFeeUsd(REGISTRATION_FEE_USD);
      setRegPayAmount(String(REGISTRATION_FEE_USD));
    }
  }, [isOpen, initialTab, initialMessage]);

  if (!isOpen) return null;

  const activeRegWallet = CRYPTO_WALLETS.find((w) => w.code === regCrypto) || CRYPTO_WALLETS[0];

  function handleCloseModal() {
    if (regPaymentMode === 'firebase' && tab === 'registration-payment') {
      void signOut(auth).catch(() => {});
    }
    onClose();
  }

  async function handleGoogleAuth() {
    setError('');
    setInfoBanner('');
    setLoading(true);
    try {
      await setPersistence(
        auth,
        rememberMe ? browserLocalPersistence : browserSessionPersistence,
      );
      const result = await signInWithPopup(auth, googleProvider);
      const displayName = result.user.displayName || 'BlueWhale Member';
      const fallbackUser = (result.user.email || 'member').split('@')[0].replace(/[^a-zA-Z0-9_.-]/g, '');
      const typedName = `${firstName} ${lastName}`.trim();
      const profile = await onGoogleSuccess({
        fullName: typedName || displayName,
        username: username.trim() || fallbackUser,
        country,
        phoneNumber: phoneNumber.trim() || '+1-555-0100',
      });
      if (profile && !hasDashboardAccess(profile)) {
        const acctStatus = getSimpleAccountStatus(profile);
        const payStatus = getPaymentStatus(profile);
        if (
          (payStatus === 'unpaid' || payStatus === 'rejected') &&
          acctStatus !== 'rejected' &&
          acctStatus !== 'suspended'
        ) {
          setRegistrationSuccessEmail(profile.email);
          setRegPaymentMode('firebase');
          setRegPaymentUser(profile);
          setRegPaymentToken(null);
          setRegFeeUsd(REGISTRATION_FEE_USD);
          setRegPayAmount(String(REGISTRATION_FEE_USD));
          setTab('registration-payment');
          return;
        }
        await signOut(auth).catch(() => {});
        setError(getActivationBlockedMessage(profile));
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in was cancelled or failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfoBanner('');
    if (regPassword !== confirmPassword) {
      setError('Password and Confirm Password do not match.');
      return;
    }
    if (!humanChecked || Number(spamAnswer) !== spamChallenge.sum) {
      setError('Please complete the anti-spam security check correctly.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest<{
        registered?: boolean;
        requiresApproval?: boolean;
        requiresPayment?: boolean;
        registrationFeeUsd?: number;
        registrationPaymentToken?: string;
        account_status?: string;
        payment_status?: string;
        message?: string;
        token?: string;
        user: UserAccount;
        verificationPreviewCode?: string;
        emailDispatch?: EmailNotification;
      }>('/api/auth/register', {
        method: 'POST',
        body: {
          firstName,
          lastName,
          username,
          email: regEmail,
          phoneNumber,
          country,
          password: regPassword,
          confirmPassword,
          antiSpamVerified: true,
          rememberMe,
        },
      });
      if (res.requiresApproval || !res.token) {
        const fee = Number(res.registrationFeeUsd || REGISTRATION_FEE_USD);
        setRegistrationSuccessEmail(regEmail.trim());
        setLoginEmail(regEmail.trim());
        setRegPassword('');
        setConfirmPassword('');
        setHumanChecked(false);
        setSpamAnswer('');
        setRegPaymentMode('jwt');
        setRegPaymentUser(res.user);
        setRegPaymentToken(res.registrationPaymentToken || null);
        setRegFeeUsd(fee);
        setRegPayAmount(String(fee));
        if (res.registrationPaymentToken) {
          setTab('registration-payment');
        } else {
          setRegSubmittedPaymentStatus(res.payment_status || 'unpaid');
          setTab('registration-pending');
        }
        return;
      }
      onJwtSuccess({
        token: res.token,
        user: res.user,
        emailDispatch: res.emailDispatch,
        verificationPreviewCode: res.verificationPreviewCode,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegScreenshotSelected(file: File | null | undefined) {
    if (!file) return;
    setError('');
    setRegProcessingFile(true);
    try {
      const processed = await processRegistrationScreenshotFile(file);
      setRegReceiptUrl(processed.dataUrl);
      setRegReceiptName(processed.fileName);
    } catch (err) {
      setRegReceiptUrl('');
      setRegReceiptName('');
      setError(err instanceof Error ? err.message : 'Unable to process payment screenshot.');
    } finally {
      setRegProcessingFile(false);
      if (regFileInputRef.current) regFileInputRef.current.value = '';
    }
  }

  async function handleSubmitRegistrationPayment(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const numericAmt = Number(regPayAmount);
    if (Number.isNaN(numericAmt) || numericAmt < regFeeUsd) {
      setError(`Minimum registration fee payment is $${regFeeUsd.toFixed(2)} USD.`);
      return;
    }
    if (regTxId.trim().length < 8) {
      setError('Please enter a valid Transaction ID (TXID).');
      return;
    }
    if (!regReceiptUrl || !regReceiptName) {
      setError('Please upload a payment screenshot before submitting.');
      return;
    }

    setLoading(true);
    try {
      if (regPaymentMode === 'firebase' && regPaymentUser) {
        await submitFirebaseRegistrationPayment({
          user: regPaymentUser,
          amount: numericAmt,
          currency: activeRegWallet.code,
          walletAddress: activeRegWallet.address,
          txId: regTxId.trim(),
          receiptDataUrl: regReceiptUrl,
          receiptFileName: regReceiptName,
        });
        await signOut(auth).catch(() => {});
        setRegSubmittedPaymentStatus('pending_verification');
        setTab('registration-pending');
      } else if (regPaymentToken) {
        const res = await apiRequest<{ user: UserAccount; message?: string }>(
          '/api/jwt/registration-payment',
          {
            method: 'POST',
            jwtToken: regPaymentToken,
            body: {
              amount: numericAmt,
              currency: activeRegWallet.code,
              txId: regTxId.trim(),
              receiptDataUrl: regReceiptUrl,
              receiptFileName: regReceiptName,
            },
          },
        );
        setRegPaymentUser(res.user);
        setRegPaymentToken(null);
        setRegSubmittedPaymentStatus(res.user.payment_status || 'pending_verification');
        setTab('registration-pending');
      } else {
        throw new Error('Registration payment session expired. Please sign in again to submit proof.');
      }
      setRegTxId('');
      setRegReceiptUrl('');
      setRegReceiptName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit registration payment.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingToken) return;
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ user: UserAccount }>('/api/auth/verify-email', {
        method: 'POST',
        jwtToken: pendingToken,
        body: { code: verificationCodeInput },
      });
      onJwtSuccess({ token: pendingToken, user: res.user });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoginPaymentPromptToken(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        token?: string;
        user?: UserAccount;
        requires2FA?: boolean;
        message?: string;
      }>('/api/auth/login', {
        method: 'POST',
        body: {
          email: loginEmail,
          password: loginPassword,
          twoFactorCode: needs2FA ? twoFactorCode : undefined,
          rememberMe,
        },
      });
      if (res.requires2FA) {
        setNeeds2FA(true);
        setInfoBanner(res.message || 'Two-factor authentication code required.');
        setLoading(false);
        return;
      }
      if (res.token && res.user) {
        onJwtSuccess({ token: res.token, user: res.user });
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
      if (err instanceof ApiRequestError && err.status === 403 && err.payload.canSubmitPayment) {
        const payTok = err.payload.registrationPaymentToken;
        if (typeof payTok === 'string' && payTok.length > 0) {
          setLoginPaymentPromptToken(payTok);
          setRegFeeUsd(Number(err.payload.registrationFeeUsd || REGISTRATION_FEE_USD));
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{
        dispatched: boolean;
        resetPreviewCode?: string;
      }>('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: forgotEmail },
      });
      setResetSent(true);
      if (res.resetPreviewCode) {
        setPreviewResetCode(res.resetPreviewCode);
      }
      setInfoBanner('Email dispatched with subject "Reset Your Password".');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to process reset request.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: {
          email: forgotEmail,
          code: resetCode,
          newPassword: newResetPassword,
        },
      });
      setResetSent(false);
      setTab('login');
      setLoginEmail(forgotEmail);
      setInfoBanner('Password updated. You can now sign in with your new password.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 my-8">
        <button
          type="button"
          onClick={handleCloseModal}
          aria-label="Close authentication modal"
          className="absolute top-5 right-5 p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-6 pr-8">
          <h2 id="auth-modal-title" className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            {tab === 'login' && 'Sign in to BlueWhale Markethub'}
            {tab === 'register' && 'Create your business account'}
            {tab === 'forgot' && 'Reset your password'}
            {tab === 'verify-email' && 'Verify your email address'}
            {tab === 'registration-payment' && `Registration Fee: $${regFeeUsd} USD`}
            {tab === 'registration-pending' && 'Registration Payment Submitted'}
          </h2>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            Access verified Personal, Business, and Corporate accounts with crypto wallet funding.
          </p>
        </div>

        {(tab === 'login' || tab === 'register') && (
          <>
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg mb-5">
              <button
                type="button"
                onClick={() => {
                  setTab('login');
                  setError('');
                  setInfoBanner('');
                }}
                className={`py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  tab === 'login'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('register');
                  setError('');
                  setInfoBanner('');
                }}
                className={`py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  tab === 'register'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Create Account
              </button>
            </div>

            <button
              type="button"
              onClick={handleGoogleAuth}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
                />
              </svg>
              <span>Continue with Google Cloud Auth</span>
            </button>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200 dark:border-slate-800" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white dark:bg-slate-900 px-3 text-slate-500">
                  Or use email credentials
                </span>
              </div>
            </div>
          </>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-sm text-rose-700 dark:text-rose-300 space-y-2.5">
            <div>{error}</div>
            {loginPaymentPromptToken && tab === 'login' && (
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setRegistrationSuccessEmail(loginEmail.trim());
                  setRegPaymentMode('jwt');
                  setRegPaymentToken(loginPaymentPromptToken);
                  setRegPayAmount(String(regFeeUsd));
                  setLoginPaymentPromptToken(null);
                  setTab('registration-payment');
                }}
                className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors"
              >
                Submit ${regFeeUsd} USD Registration Payment Proof
              </button>
            )}
          </div>
        )}

        {infoBanner && (
          <div className="mb-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-sm text-blue-800 dark:text-blue-200">
            {infoBanner}
          </div>
        )}

        {tab === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  inputMode="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="operations@company.com"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setTab('forgot');
                    setError('');
                    setInfoBanner('');
                  }}
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>Remember me (stay signed in)</span>
              </label>
            </div>

            {needs2FA && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Two-Factor Authentication Code
                </label>
                <div className="relative">
                  <ShieldCheck className="w-4 h-4 text-blue-600 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value)}
                    placeholder="123456"
                    className="w-full pl-9 pr-3 py-2.5 text-sm font-mono tracking-widest bg-white dark:bg-slate-950 border border-blue-500 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors"
            >
              <span>{loading ? 'Authenticating...' : needs2FA ? 'Verify & Sign In' : 'Sign In'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        {tab === 'register' && (
          <form onSubmit={handleRegister} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  First Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Michael"
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Last Name
                </label>
                <input
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Thompson"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="mthompson"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Phone Number
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    required
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+1 512 555 0194"
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Country
                </label>
                <div className="relative">
                  <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {SUPPORTED_COUNTRIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat password"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            {/* Anti-Spam Protection */}
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={humanChecked}
                  onChange={(e) => setHumanChecked(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>Anti-Spam Protection: I am not a robot</span>
              </label>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500 font-mono">
                  Verify {spamChallenge.a} + {spamChallenge.b} =
                </span>
                <input
                  type="number"
                  required
                  value={spamAnswer}
                  onChange={(e) => setSpamAnswer(e.target.value)}
                  placeholder="?"
                  className="w-14 px-2 py-1 text-xs font-mono text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded"
                />
              </div>
            </div>

            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs text-blue-800 dark:text-blue-200 space-y-1">
              <div className="font-semibold">Registration Fee: ${REGISTRATION_FEE_USD} USD</div>
              <div>
                New accounts start with <strong>pending</strong> approval and <strong>unpaid</strong> payment status. Dashboard access activates once an administrator approves your account and verifies your registration payment.
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors"
            >
              <span>{loading ? 'Creating Account...' : 'Create Account'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        {tab === 'registration-payment' && (
          <form onSubmit={handleSubmitRegistrationPayment} className="space-y-4">
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-1">
              <div className="font-semibold">
                Account Created · Registration Fee: ${regFeeUsd} USD
              </div>
              <div>
                Send <strong>${regFeeUsd}.00 USD</strong> to activate review, then submit your TXID and payment screenshot below. Your dashboard opens after admin approves your user account and verifies payment.
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Select Cryptocurrency
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {CRYPTO_WALLETS.map((w) => {
                  const active = w.code === regCrypto;
                  return (
                    <button
                      key={w.code}
                      type="button"
                      onClick={() => setRegCrypto(w.code)}
                      className={`px-2.5 py-2 rounded-lg border text-left transition-colors ${
                        active
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="text-[11px] font-semibold truncate">{w.name}</div>
                      <div className="text-[10px] text-slate-500">{w.symbol}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center gap-3">
              <div className="flex-1 min-w-0 w-full space-y-1.5">
                <div className="text-[11px] font-medium text-slate-500">
                  Official {activeRegWallet.networkLabel} Address
                </div>
                <div className="flex items-center gap-1.5">
                  <code className="flex-1 px-2.5 py-1.5 text-[11px] font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100 break-all">
                    {activeRegWallet.address}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(activeRegWallet.address).then(() => {
                        setRegCopiedAddr(true);
                        setTimeout(() => setRegCopiedAddr(false), 1600);
                      });
                    }}
                    className="px-2.5 py-1.5 text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded inline-flex items-center gap-1 shrink-0"
                  >
                    {regCopiedAddr ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{regCopiedAddr ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
              <QrCodeCanvas
                value={activeRegWallet.address}
                size={96}
                label={activeRegWallet.symbol}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Amount (USD)
                </label>
                <input
                  type="number"
                  min={regFeeUsd}
                  step="0.01"
                  required
                  value={regPayAmount}
                  onChange={(e) => setRegPayAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Transaction ID (TXID)
                </label>
                <input
                  type="text"
                  required
                  minLength={8}
                  value={regTxId}
                  onChange={(e) => setRegTxId(e.target.value)}
                  placeholder="Paste blockchain TXID / hash"
                  className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Payment Screenshot (Required)
              </label>
              <input
                ref={regFileInputRef}
                id="modal-reg-screenshot"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                onChange={(e) => void handleRegScreenshotSelected(e.target.files?.[0])}
                className="sr-only"
              />
              {!regReceiptUrl ? (
                <label
                  htmlFor="modal-reg-screenshot"
                  className="flex items-center justify-center gap-2 px-4 py-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:border-blue-500 cursor-pointer text-xs text-slate-700 dark:text-slate-200"
                >
                  <Upload className="w-4 h-4 text-blue-600" />
                  <span>
                    {regProcessingFile ? 'Processing screenshot...' : 'Upload payment receipt screenshot (PNG/JPG/WEBP/PDF)'}
                  </span>
                </label>
              ) : (
                <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {regReceiptUrl.startsWith('data:application/pdf') ? (
                      <FileText className="w-5 h-5 text-blue-600 shrink-0" />
                    ) : (
                      <img src={regReceiptUrl} alt="Receipt" className="w-9 h-9 rounded object-cover shrink-0" />
                    )}
                    <span className="text-xs font-medium truncate text-slate-800 dark:text-slate-200">
                      {regReceiptName}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRegReceiptUrl('');
                      setRegReceiptName('');
                    }}
                    className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="submit"
                disabled={loading || regProcessingFile || !regReceiptUrl}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
              >
                <span>{loading ? 'Submitting Payment Proof...' : 'Submit Payment Proof'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleCloseModal}
                className="px-3.5 py-2.5 text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              >
                Pay Later
              </button>
            </div>
          </form>
        )}

        {tab === 'registration-pending' && (
          <div className="space-y-5">
            <div className="p-5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-3">
              <div className="flex items-center gap-2.5 text-emerald-800 dark:text-emerald-200 font-display text-base font-bold">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <span>Registration Payment Under Review</span>
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                Your payment is under review. Dashboard access will be activated after payment verification.
              </p>
              <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                Your account is awaiting administrator approval.
              </p>
              {registrationSuccessEmail && (
                <div className="pt-2 border-t border-emerald-200/80 dark:border-emerald-800/80 flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Email: <strong>{registrationSuccessEmail}</strong> · Account: <strong>{regPaymentUser?.account_status || 'pending'}</strong> · Payment: <strong>{regSubmittedPaymentStatus}</strong>
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setInfoBanner('');
                  setTab('login');
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <span>Back to Sign In</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleCloseModal}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {tab === 'verify-email' && pendingUser && (
          <form onSubmit={handleVerifyEmail} className="space-y-4">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2 text-sm">
              <div className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-600" />
                <span>Welcome to BlueWhale Markethub</span>
              </div>
              <p className="text-slate-600 dark:text-slate-300 text-xs leading-relaxed">
                Verification code sent to <strong>{pendingUser.email}</strong>.
                {previewVerificationCode && (
                  <span className="block mt-1.5 font-mono text-blue-700 dark:text-blue-300">
                    Verification Code: <strong>{previewVerificationCode}</strong>
                  </span>
                )}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                6-Digit Verification Code
              </label>
              <input
                type="text"
                required
                maxLength={6}
                value={verificationCodeInput}
                onChange={(e) => setVerificationCodeInput(e.target.value)}
                placeholder="Enter 6-digit code"
                className="w-full px-3 py-2.5 text-sm font-mono tracking-widest bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                {loading ? 'Verifying...' : 'Verify Email'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (pendingToken && pendingUser) {
                    onJwtSuccess({ token: pendingToken, user: pendingUser });
                    onClose();
                  }
                }}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                Verify Later
              </button>
            </div>
          </form>
        )}

        {tab === 'forgot' && !resetSent && (
          <form onSubmit={handleForgotSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Registered Email Address
              </label>
              <input
                type="email"
                required
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full px-3 py-2.5 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                {loading ? 'Sending...' : 'Send Reset Code'}
              </button>
              <button
                type="button"
                onClick={() => setTab('login')}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                Back
              </button>
            </div>
          </form>
        )}

        {tab === 'forgot' && resetSent && (
          <form onSubmit={handleResetConfirm} className="space-y-4">
            {previewResetCode && (
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-700 dark:text-slate-200">
                Reset Code: <strong>{previewResetCode}</strong>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                6-Digit Reset Code
              </label>
              <input
                type="text"
                required
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                placeholder="Enter reset code"
                className="w-full px-3 py-2.5 text-sm font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                New Password
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={newResetPassword}
                onChange={(e) => setNewResetPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full px-3 py-2.5 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              {loading ? 'Updating Password...' : 'Update Password'}
            </button>
          </form>
        )}

        <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
          Need help signing in or verifying? Email{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
        </div>
      </div>
    </div>
  );
}
