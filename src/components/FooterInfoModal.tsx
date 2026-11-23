import React, { useState } from 'react';
import { X, CheckCircle2, Send } from 'lucide-react';
import { FAQ_ITEMS, KNOWLEDGE_BASE_ARTICLES } from '../data/shippingCatalog';
import { apiRequest } from '../lib/apiClient';

export type FooterPageId =
  | 'about'
  | 'contact'
  | 'privacy'
  | 'terms'
  | 'refund'
  | 'aml'
  | 'faq'
  | 'support';

interface FooterInfoModalProps {
  page: FooterPageId | null;
  onClose: () => void;
  onOpenSupportCenter?: () => void;
}

export function FooterInfoModal({ page, onClose, onOpenSupportCenter }: FooterInfoModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sentRef, setSentRef] = useState('');
  const [err, setErr] = useState('');

  if (!page) return null;

  async function handleContactSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setSending(true);
    try {
      const res = await apiRequest<{ submitted: boolean; ticketRef: string }>('/api/contact', {
        method: 'POST',
        body: { name, email, subject, message },
      });
      setSentRef(res.ticketRef);
      setName('');
      setEmail('');
      setSubject('');
      setMessage('');
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to submit message.');
    } finally {
      setSending(false);
    }
  }

  const titles: Record<FooterPageId, string> = {
    about: 'About BlueWhale Markethub',
    contact: 'Contact BlueWhale Support & Operations',
    privacy: 'Privacy Policy',
    terms: 'Terms of Service',
    refund: 'Refund Policy',
    aml: 'Anti-Money Laundering (AML) Policy',
    faq: 'Frequently Asked Questions',
    support: 'Help Center & Knowledge Base',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="footer-page-title"
    >
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 my-8">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close page modal"
          className="absolute top-5 right-5 p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 id="footer-page-title" className="font-display text-xl font-bold text-slate-900 dark:text-white pr-8">
          {titles[page]}
        </h2>

        <div className="mt-5 space-y-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {page === 'about' && (
            <>
              <p>
                BlueWhale Markethub is a verified account marketplace where individuals, businesses, and corporate teams purchase ready-to-use Personal, Business, and Corporate accounts starting from $100 USD upward based on account tier and country.
              </p>
              <p>
                Supporting 14 primary jurisdictions, our platform provides verified accounts across UPS, FedEx, USPS, Royal Mail, ShipStation, EasyPost, EasyShip, and Stamps.com through a unified crypto-funded wallet.
              </p>
            </>
          )}

          {page === 'privacy' && (
            <>
              <p>
                We isolate personally identifiable information (email address, phone number, and IP audit records) inside strict access-controlled storage accessible only to the account owner and verified compliance administrators.
              </p>
              <p>
                All communications are protected via TLS encryption, CSRF verification, bcrypt credential hashing, and optional TOTP two-factor authentication.
              </p>
            </>
          )}

          {page === 'terms' && (
            <>
              <p>
                By creating an account on BlueWhale Markethub, you agree to submit accurate business registration details and legitimate blockchain transaction hashes when funding your wallet.
              </p>
              <p>
                Minimum wallet deposit is $100 USD equivalent. Account packages are priced from $100 USD upward based on Personal, Business, or Corporate tier and selected country availability.
              </p>
            </>
          )}

          {page === 'refund' && (
            <>
              <p>
                Account orders cancelled by administrators prior to credential delivery and activation are automatically refunded in full back to your BlueWhale Markethub wallet balance and recorded in your Transaction Ledger.
              </p>
              <p>
                Cryptocurrency deposits rejected during compliance review are never credited to wallet balances; contact support with your transaction hash for manual resolution.
              </p>
            </>
          )}

          {page === 'aml' && (
            <>
              <p>
                BlueWhale Markethub enforces strict anti-fraud and AML screening across all Bitcoin (BTC), Ethereum (ETH), and Tether (USDT ERC20/TRC20) deposits. Duplicate transaction hashes are automatically blocked, and every deposit undergoes compliance review before balance crediting.
              </p>
            </>
          )}

          {page === 'faq' && (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
              {FAQ_ITEMS.map((item) => (
                <div key={item.question} className="p-4">
                  <div className="font-semibold text-slate-900 dark:text-white">{item.question}</div>
                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">{item.answer}</div>
                </div>
              ))}
            </div>
          )}

          {page === 'support' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs text-blue-900 dark:text-blue-200">
                Direct Support Email:{' '}
                <a
                  href="mailto:Bluewhalemarkethub@gmail.com"
                  className="font-semibold underline hover:text-blue-700 dark:hover:text-blue-300"
                >
                  Bluewhalemarkethub@gmail.com
                </a>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {KNOWLEDGE_BASE_ARTICLES.map((art) => (
                  <div
                    key={art.title}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                  >
                    <div className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                      {art.category}
                    </div>
                    <div className="mt-1 font-semibold text-xs text-slate-900 dark:text-white">
                      {art.title}
                    </div>
                    <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">{art.summary}</p>
                  </div>
                ))}
              </div>
              {onOpenSupportCenter && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSupportCenter();
                  }}
                  className="px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                >
                  Open Live Chat & Support Tickets
                </button>
              )}
            </div>
          )}

          {page === 'contact' && (
            <form onSubmit={handleContactSubmit} className="space-y-3.5">
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
                Need direct assistance? Email support anytime at{' '}
                <a
                  href="mailto:Bluewhalemarkethub@gmail.com"
                  className="font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Bluewhalemarkethub@gmail.com
                </a>
              </div>
              {sentRef && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Inquiry received. Reference: {sentRef}</span>
                </div>
              )}
              {err && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
                  {err}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your Name"
                  className="px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Business Email"
                  className="px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </div>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject (e.g., UPS Business Account Inquiry)"
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              />
              <textarea
                rows={4}
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="How can our account provisioning and support team help?"
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              />
              <button
                type="submit"
                disabled={sending}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{sending ? 'Sending...' : 'Send Message'}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
