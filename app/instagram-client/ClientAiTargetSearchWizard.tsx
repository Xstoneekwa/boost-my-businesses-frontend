"use client";

import { useEffect, useMemo, useState } from "react";
import { buildOpenStreetMapEmbedUrl } from "@/lib/geocoding/osm-embed";
import {
  hasIneligibleAiTargetSelection,
  type AiTargetEligibilityReasonCode,
} from "@/lib/instagram-client/target-ai-eligibility";
import { targetAiCopy, targetAiEligibilityLabel, type TargetAiLang } from "@/lib/instagram-client/target-ai-copy";
import type { TargetAiErrorCode } from "@/lib/instagram-client/target-ai-config";
import { TargetAiRequestError, targetAiErrorMessage } from "@/lib/instagram-client/target-ai-errors";
import type { TargetAiSearchCandidate } from "@/lib/instagram-client/target-ai-search-service";

type GeocodedPlace = {
  id: string;
  label: string;
  lat: number;
  lon: number;
};

type ClientAiTargetSearchWizardProps = {
  open: boolean;
  onClose: () => void;
  lang: TargetAiLang;
  accountId: string;
  onValidated: (message: string) => Promise<void>;
};

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: string; error_code?: TargetAiErrorCode };

async function readApiResponse<T>(
  response: Response,
  lang: TargetAiLang,
  fallbackCode: TargetAiErrorCode = "target_ai_provider_error",
): Promise<T> {
  const text = await response.text();
  let payload: ApiEnvelope<T> | null = null;
  if (text.trim()) {
    try {
      payload = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      throw new TargetAiRequestError(fallbackCode, targetAiErrorMessage(lang, fallbackCode));
    }
  }
  if (!payload || typeof payload !== "object" || !("ok" in payload)) {
    throw new TargetAiRequestError(fallbackCode, targetAiErrorMessage(lang, fallbackCode));
  }
  if (payload.ok) return payload.data;
  const code = payload.error_code || fallbackCode;
  throw new TargetAiRequestError(code, targetAiErrorMessage(lang, code));
}

function formatFollowers(value: number | null, lang: TargetAiLang) {
  if (value == null) return "—";
  return value.toLocaleString(lang === "fr" ? "fr-FR" : "en-US");
}

function AiResultAvatar({ username, avatarUrl }: { username: string; avatarUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  const initial = username.replace(/^@+/, "").charAt(0).toUpperCase() || "?";
  if (avatarUrl && !failed) {
    return (
      <span className="cd-ai-av cd-ai-av-img">
        <img src={avatarUrl} alt="" width={40} height={40} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      </span>
    );
  }
  return <span className="cd-ai-av"><i>{initial}</i></span>;
}

export default function ClientAiTargetSearchWizard({
  open,
  onClose,
  lang,
  accountId,
  onValidated,
}: ClientAiTargetSearchWizardProps) {
  const copy = useMemo(() => targetAiCopy(lang), [lang]);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [niche, setNiche] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<GeocodedPlace[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<GeocodedPlace | null>(null);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [searching, setSearching] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [candidates, setCandidates] = useState<TargetAiSearchCandidate[]>([]);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setNiche("");
    setLocationQuery("");
    setLocationSuggestions([]);
    setSelectedLocation(null);
    setSearching(false);
    setValidating(false);
    setError("");
    setStatusMessage("");
    setCandidates([]);
  }, [open]);

  useEffect(() => {
    if (!open || step !== 2) return;
    const query = locationQuery.trim();
    if (query.length < 2) {
      setLocationSuggestions([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoadingLocations(true);
      try {
        const data = await readApiResponse<{ places: GeocodedPlace[] }>(
          await fetch(`/api/instagram-client/accounts/${encodeURIComponent(accountId)}/targets/location?q=${encodeURIComponent(query)}`, {
            headers: { Accept: "application/json" },
          }),
          lang,
          "location_unavailable",
        );
        setLocationSuggestions(Array.isArray(data.places) ? data.places : []);
      } catch {
        setLocationSuggestions([]);
      } finally {
        setLoadingLocations(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [accountId, lang, locationQuery, open, step]);

  const selectedCandidates = candidates;
  const ineligiblePresent = hasIneligibleAiTargetSelection(selectedCandidates);
  const eligibleUsernames = selectedCandidates.filter((row) => row.eligible).map((row) => row.username);
  const canValidate = selectedCandidates.length > 0 && !ineligiblePresent && eligibleUsernames.length > 0 && !validating;

  function closeWizard() {
    if (searching || validating) return;
    onClose();
  }

  async function launchSearch() {
    setSearching(true);
    setError("");
    setStatusMessage("");
    setStep(3);
    try {
      const data = await readApiResponse<{
        candidates: TargetAiSearchCandidate[];
      }>(
        await fetch(`/api/instagram-client/accounts/${encodeURIComponent(accountId)}/targets/ai-search`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            niche: niche.trim(),
            location: selectedLocation
              ? { label: selectedLocation.label, lat: selectedLocation.lat, lon: selectedLocation.lon }
              : null,
          }),
        }),
        lang,
        "target_ai_provider_error",
      );
      setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      if (!data.candidates?.length) {
        setStatusMessage(targetAiErrorMessage(lang, "no_candidates_found"));
      }
    } catch (e) {
      setCandidates([]);
      if (e instanceof TargetAiRequestError) {
        if (e.code === "no_candidates_found") {
          setStatusMessage(e.message);
          setError("");
        } else {
          setError(e.message);
          setStatusMessage("");
        }
      } else {
        setError(targetAiErrorMessage(lang, "target_ai_provider_error"));
      }
    } finally {
      setSearching(false);
    }
  }

  async function validateSelection() {
    if (!canValidate) return;
    setValidating(true);
    setError("");
    try {
      await readApiResponse(
        await fetch(`/api/instagram-client/accounts/${encodeURIComponent(accountId)}/targets`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            usernames: eligibleUsernames,
            import_source: "ai_discovery",
          }),
        }),
        lang,
        "target_ai_provider_error",
      );
      await onValidated(copy.validateSuccess(eligibleUsernames.length));
      onClose();
    } catch (e) {
      setError(e instanceof TargetAiRequestError ? e.message : copy.validateError);
    } finally {
      setValidating(false);
    }
  }

  function removeCandidate(username: string) {
    setCandidates((rows) => rows.filter((row) => row.username !== username));
  }

  if (!open) return null;

  const mapUrl = selectedLocation ? buildOpenStreetMapEmbedUrl(selectedLocation.lat, selectedLocation.lon) : null;

  return (
    <>
      <div className="cd-ai-scrim open" onClick={closeWizard} role="presentation" />
      <section className="cd-ai-modal" role="dialog" aria-modal="true" aria-labelledby="cd-ai-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="cd-ai-hd">
          <div>
            <div className="cd-ai-step">{copy.stepLabel(step)}</div>
            <h2 id="cd-ai-title" className="cd-ai-title">
              {step === 1 ? copy.step1Title : step === 2 ? copy.step2Title : searching ? copy.loadingTitle : copy.step3Title}
            </h2>
            <p className="cd-ai-body">
              {step === 1 ? copy.step1Body : step === 2 ? copy.step2Body : searching ? copy.loadingBody : copy.step3Body}
            </p>
          </div>
          <button type="button" className="cd-dwr-x" onClick={closeWizard} aria-label={copy.close}>
            <svg viewBox="0 0 24 24" width={17} height={17} stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </header>

        {error ? <p className="cd-ai-error">{error}</p> : null}

        {step === 1 ? (
          <div className="cd-ai-panel">
            <label className="cd-ai-label">{copy.nicheLabel}</label>
            <input
              type="text"
              className="cd-dwr-in"
              value={niche}
              onChange={(event) => setNiche(event.target.value)}
              placeholder={copy.nichePlaceholder}
              autoFocus
            />
            <div className="cd-ai-actions">
              <span />
              <button type="button" className="cd-dwr-import" disabled={niche.trim().length < 2} onClick={() => setStep(2)}>
                {copy.continue}
              </button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="cd-ai-panel">
            <label className="cd-ai-label">{copy.locationLabel}</label>
            <input
              type="text"
              className="cd-dwr-in"
              value={locationQuery}
              onChange={(event) => {
                setLocationQuery(event.target.value);
                setSelectedLocation(null);
              }}
              placeholder={copy.locationPlaceholder}
            />
            {loadingLocations ? <p className="cd-ai-hint">{lang === "fr" ? "Recherche de lieux…" : "Searching places…"}</p> : null}
            {locationSuggestions.length > 0 ? (
              <div className="cd-ai-suggest">
                {locationSuggestions.map((place) => (
                  <button
                    key={place.id}
                    type="button"
                    className={`cd-ai-suggest-row${selectedLocation?.id === place.id ? " on" : ""}`}
                    onClick={() => {
                      setSelectedLocation(place);
                      setLocationQuery(place.label);
                      setLocationSuggestions([]);
                    }}
                  >
                    {place.label}
                  </button>
                ))}
              </div>
            ) : null}
            {locationQuery.trim().length >= 2 && !loadingLocations && locationSuggestions.length === 0 && !selectedLocation ? (
              <p className="cd-ai-hint">{copy.locationEmpty}</p>
            ) : null}
            {mapUrl ? (
              <div className="cd-ai-map">
                <iframe title={copy.locationLabel} src={mapUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
              </div>
            ) : null}
            <div className="cd-ai-actions">
              <button type="button" className="cd-ai-back" onClick={() => setStep(1)}>{copy.back}</button>
              <button type="button" className="cd-dwr-import" onClick={() => void launchSearch()}>{copy.launchSearch}</button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="cd-ai-panel">
            {searching ? (
              <div className="cd-ai-loading">
                <span className="cd-ai-spinner" aria-hidden="true" />
                <p>{copy.loadingBody}</p>
              </div>
            ) : (
              <>
                {ineligiblePresent ? <p className="cd-ai-warning">{copy.blockedValidation}</p> : null}
                {statusMessage ? <p className="cd-ai-hint">{statusMessage}</p> : null}
                <div className="cd-ai-results">
                  {selectedCandidates.length === 0 && !statusMessage ? (
                    <p className="cd-ai-hint">{copy.emptySelection}</p>
                  ) : selectedCandidates.map((row) => (
                    <div key={row.username} className={`cd-ai-row${row.eligible ? "" : " ineligible"}`}>
                      <AiResultAvatar username={row.username} avatarUrl={row.avatarUrl} />
                      <div className="cd-ai-row-main">
                        <div className="cd-ai-row-top">
                          <a href={row.profileUrl} target="_blank" rel="noopener noreferrer" className="cd-ai-handle">@{row.username}</a>
                          <span className={`cd-ai-pill${row.eligible ? " ok" : " bad"}`}>
                            {row.eligible ? copy.eligible : copy.ineligible}
                          </span>
                        </div>
                        <div className="cd-ai-row-meta">
                          <span>{formatFollowers(row.followersCount, lang)} {copy.followers}</span>
                          {!row.eligible && row.ineligibleReasonCode ? (
                            <span>{targetAiEligibilityLabel(lang, row.ineligibleReasonCode as AiTargetEligibilityReasonCode)}</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="cd-ai-row-actions">
                        <a href={row.profileUrl} target="_blank" rel="noopener noreferrer" className="cd-ai-link" title={copy.openInstagram}>
                          ↗
                        </a>
                        <button type="button" className="cd-ai-remove" onClick={() => removeCandidate(row.username)} title={copy.remove}>
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="cd-ai-actions">
                  <button type="button" className="cd-ai-back" onClick={() => setStep(2)} disabled={validating}>{copy.back}</button>
                  <button type="button" className="cd-dwr-import" disabled={!canValidate} onClick={() => void validateSelection()}>
                    {copy.validate}
                  </button>
                </div>
                <button type="button" className="cd-ai-secondary" onClick={() => { setStep(1); setCandidates([]); setStatusMessage(""); setError(""); }}>
                  {copy.newSearch}
                </button>
              </>
            )}
          </div>
        ) : null}
      </section>
    </>
  );
}
