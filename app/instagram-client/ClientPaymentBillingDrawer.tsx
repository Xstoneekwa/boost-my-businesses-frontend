"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClientBillingView, ClientSafeInvoice } from "@/lib/commercial/stripe/client-billing-types";
import { clientBillingCopy, paymentMethodScopeLabel } from "@/lib/commercial/stripe/client-billing-copy";

type Lang = "fr" | "en";

type AccountCopy = {
  billingTitle: string;
  managePayment: string;
  billingNoMethod: string;
  billingSoon: string;
  billingInvoicesSoon: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  accountCopy: AccountCopy;
};

function invoiceDocumentPath(invoiceRef: string, kind: "hosted" | "pdf") {
  return `/api/instagram-client/billing/invoices/${encodeURIComponent(invoiceRef)}/document?kind=${kind}`;
}

function InvoiceRow({
  invoice,
  lang,
}: {
  invoice: ClientSafeInvoice;
  lang: Lang;
}) {
  const t = clientBillingCopy(lang);
  return (
    <article className="cd-billing-invoice">
      <div className="cd-billing-invoice-main">
        <div className="cd-billing-invoice-top">
          <strong>{invoice.serviceLabel}</strong>
          <span className={`cd-billing-status is-${invoice.status}`}>{invoice.statusLabel}</span>
        </div>
        <div className="cd-billing-invoice-meta">
          <span>{new Date(invoice.dateIso).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US")}</span>
          <span>{invoice.amountLabel}</span>
          {invoice.accountUsername ? <span>@{invoice.accountUsername}</span> : null}
        </div>
      </div>
      <div className="cd-billing-invoice-actions">
        {invoice.canView ? (
          <a className="cd-btn cd-btn-soft" href={invoiceDocumentPath(invoice.invoiceRef, "hosted")} target="_blank" rel="noreferrer">
            {t.viewInvoice}
          </a>
        ) : null}
        {invoice.canDownloadPdf ? (
          <a className="cd-btn cd-btn-soft" href={invoiceDocumentPath(invoice.invoiceRef, "pdf")} target="_blank" rel="noreferrer">
            {t.downloadPdf}
          </a>
        ) : (
          <span className="cd-billing-pdf-unavailable">{t.pdfUnavailable}</span>
        )}
      </div>
    </article>
  );
}

export function ClientPaymentBillingDrawer({ open, onClose, lang, accountCopy }: Props) {
  const t = clientBillingCopy(lang);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ClientBillingView | null>(null);
  const [portalPending, setPortalPending] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const loadBilling = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/instagram-client/billing?lang=${lang}`, { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; data?: ClientBillingView; error?: string };
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error || t.billingUnavailable);
      }
      setData(payload.data);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : t.billingUnavailable);
    } finally {
      setLoading(false);
    }
  }, [lang, t.billingUnavailable]);

  useEffect(() => {
    if (!open) return;
    void loadBilling();
  }, [open, loadBilling]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  async function openPortal() {
    setPortalPending(true);
    setPortalError(null);
    try {
      const response = await fetch("/api/commercial/stripe/billing-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json() as { ok?: boolean; data?: { redirect_url?: string }; error?: string };
      if (!response.ok || !payload.ok || !payload.data?.redirect_url) {
        throw new Error(payload.error || t.portalUnavailable);
      }
      window.location.assign(payload.data.redirect_url);
    } catch (portalFailure) {
      setPortalError(portalFailure instanceof Error ? portalFailure.message : t.portalUnavailable);
      setPortalPending(false);
    }
  }

  const paymentMethod = data?.defaultPaymentMethod;
  const scopeText = paymentMethod ? paymentMethodScopeLabel(paymentMethod.scope, lang) : "";

  return (
    <>
      <div className={`cd-dwr-scrim${open ? " open" : ""}`} onClick={onClose} />
      <aside className={`cd-dwr cd-billing-dwr${open ? " open" : ""}`} aria-hidden={!open}>
        <header className="cd-dwr-hd">
          <div className="cd-dwr-hd-l">
            <div>
              <div className="cd-dwr-kicker">{accountCopy.managePayment}</div>
              <div className="cd-dwr-title">{t.managePaymentDrawerTitle}</div>
            </div>
          </div>
          <button className="cd-dwr-x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width={17} height={17} stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>
        <div className="cd-dwr-body">
          {loading ? <p className="cd-setup-note">{t.loading}</p> : null}
          {error ? <section className="cd-card cd-setup-required"><p className="cd-setup-note">{error}</p></section> : null}

          {!loading && !error && data ? (
            <>
              {data.mode === "agency" ? (
                <section className="cd-card">
                  <div className="cd-s-title">{t.agencyPaymentsTitle}</div>
                  <h2>{paymentMethod?.displayLabel || accountCopy.billingNoMethod}</h2>
                  {scopeText ? <p className="cd-setup-note">{scopeText}</p> : null}
                  {data.globalNextBillingLabel ? (
                    <p className="cd-setup-note">{t.globalNextBilling}: {data.globalNextBillingLabel}</p>
                  ) : null}
                </section>
              ) : (
                <section className="cd-card">
                  <div className="cd-s-title">{t.paymentMethodTitle}</div>
                  <h2>{paymentMethod?.displayLabel || accountCopy.billingNoMethod}</h2>
                  {scopeText ? <p className="cd-setup-note">{scopeText}</p> : null}
                </section>
              )}

              {data.portal.available ? (
                <button
                  type="button"
                  className="cd-btn cd-btn-primary"
                  disabled={portalPending}
                  onClick={() => void openPortal()}
                >
                  {portalPending ? t.loading : t.updatePaymentMethod}
                </button>
              ) : (
                <section className="cd-card cd-setup-required">
                  <p className="cd-setup-note">{t.portalUnavailable}</p>
                </section>
              )}
              {portalError ? <p className="cd-setup-note">{portalError}</p> : null}

              {data.mode === "standard" ? (
                <section className="cd-card">
                  <div className="cd-s-title">{t.invoicesTitle}</div>
                  {data.recentInvoices.length ? data.recentInvoices.map((invoice) => (
                    <InvoiceRow key={invoice.invoiceRef} invoice={invoice} lang={lang} />
                  )) : (
                    <p className="cd-setup-note">{data.billingProfileAvailable ? t.noInvoices : accountCopy.billingInvoicesSoon}</p>
                  )}
                </section>
              ) : (
                <>
                  {data.accounts.map((account) => (
                    <section className="cd-card cd-billing-account" key={account.accountId}>
                      <div className="cd-s-title">@{account.username}</div>
                      <p className="cd-setup-note">{account.planLabel} · {account.subscriptionStatusLabel}</p>
                      <p className="cd-setup-note">{account.priceLabel} · {account.billingCadenceLabel}</p>
                      {account.nextBillingLabel ? (
                        <p className="cd-setup-note">{t.nextBilling}: {account.nextBillingLabel}</p>
                      ) : null}
                      <p className="cd-setup-note">{account.paymentMethod.displayLabel}</p>
                      {paymentMethodScopeLabel(account.paymentMethod.scope, lang) ? (
                        <p className="cd-setup-note">{paymentMethodScopeLabel(account.paymentMethod.scope, lang)}</p>
                      ) : null}
                      <div className="cd-s-title">{t.accountInvoices}</div>
                      {account.invoices.length ? account.invoices.map((invoice) => (
                        <InvoiceRow key={invoice.invoiceRef} invoice={invoice} lang={lang} />
                      )) : (
                        <p className="cd-setup-note">{t.noInvoices}</p>
                      )}
                    </section>
                  ))}
                  {data.unassignedInvoices.length ? (
                    <section className="cd-card">
                      <div className="cd-s-title">{t.unassignedInvoicesTitle}</div>
                      {data.unassignedInvoices.map((invoice) => (
                        <InvoiceRow key={invoice.invoiceRef} invoice={invoice} lang={lang} />
                      ))}
                    </section>
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </div>
      </aside>
    </>
  );
}
