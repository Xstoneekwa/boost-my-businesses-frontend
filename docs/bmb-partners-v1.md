# BMB_PARTNERS_V1 — preview validation dossier

## Baseline and safety

- Exact production and candidate parent: `3a871e7b1c1db77aaabdeb39d2cd16582fd1af02`.
- Production / rollback deployment: `dpl_D8SFPduxGLMbwunnpCTKmdMSUAKH` (READY).
- Production branch: `codex/homepage-premium-visual-upgrade-v1`.
- Candidate branch: `codex/bmb-partners-v1`.
- Dedicated worktree started clean with no uncommitted changes.
- Active task inspected: PHONE FARM 20 + STRIPE 10 (backend/restriction preflight).
- Worktrees, recent commits and Vercel deployments rechecked before shared-footer edits and finalization. No overlapping marketing edits; production unchanged.
- No production promotion authorized by this dossier. Owner visual approval is required after Preview.

## Scope and source of truth

New /partners page, two original image assets, language hook shared by marketing pages, one Partners link in each required footer.

Read-only commercial evidence: `lib/commercial/agency.ts`, canonical catalogue, `lib/instagram-client/client-agency-overview-helpers.ts`, and existing commercial pricing snapshot tests. The page describes existing multi-account plans/statuses and volume programme without replicating thresholds or calculations. No Stripe, billing, checkout, API, Supabase, Worker or BotApp changes.

Full white-label is explicitly unavailable in V1. Illustrations contain no client performance numbers. No partner dashboard or new capabilities are implemented.

## Design

INTEGRATED_VISUAL_COMPOSITION=YES
NO_PROPULSE_COPY=YES
ORIGINAL_BMB_EXECUTION=YES
NO_FIGMA_ASSET_REUSE=YES

Hero copy, agency/operations annotations and photographic scene form one composition. The responsibilities section overlays the two poles within a shared scene. The multi-account scene is explicitly illustrative, not a fabricated live dashboard. Mobile uses a dedicated portrait composition to preserve both agency and phones. Text remains HTML for accessibility and translation.

Owner lighting follow-up: reduced dark scene overlays; image presentation brightness 1.18 for hero and 1.35 for responsibilities; localized text backing retains readability without dimming the entire photograph. Desktop and mobile rechecked.

KEEP_AS_PRINCIPLE: clear hierarchy, contextual annotations, realistic demonstration and reassurance close to conversion.
BMB_ADAPTATION: agency relationship layer connected to managed real-phone operation; BMB charcoal and amber palette.
DO_NOT_COPY: all Propulse assets, wording, numbers, distinctive layouts and branding.

React review: no API calls, lightweight language subscription with cleanup, native FAQ details/summary, accessible language buttons, scoped responsive CSS, reduced-motion treatment. The shared hook avoids importing the whole homepage into Partners.

## Language

`bmb_lang` is canonical; `boost_ai_landing_lang_v1` remains a backwards-compatible fallback and is written alongside it. Partners, homepage and AI Automation share the hook. Existing Instagram Growth JS already reads/writes bmb_lang and is unchanged.

## Checks before Preview

- Targeted lint and git diff --check: PASS.
- 5 Partners source contract tests: PASS.
- 24 existing commercial pricing snapshot tests: PASS.
- Local full Next production build: PASS (including Next TypeScript phase).
- Standalone repository typecheck has diagnostics in existing tests; its 346-line output is byte-for-byte identical to the baseline output. No diagnostic in modified files.
- Local browser: FR desktop/mobile390, EN desktop/mobile390, persisted FR reload, FAQ opens, canonical Calendly destination, pricing anchor, homepage/AI Automation/South Africa smoke: PASS.
- Production remains unchanged. Preview checks and exact candidate/deployment identifiers will be recorded in the delivery report.

## Image provenance

Built-in imagegen, original generation, no external image/asset reuse.
Saved assets:
- `public/partners/assets/agency-operations-v1.jpg`
- `public/partners/assets/agency-operations-mobile-v1.jpg`

Desktop prompt:
Use case: ads-marketing. Asset type: original premium BMB partners website scene, wide 16:9. Create a polished photoreal editorial composite of an agency powering several clients through a supervised real-phone operation. One coherent architectural scene, not panels or cards. Left middle: warmly lit agency creative studio with two professionals reviewing client content at a large desk. Centre: an elegant smoked-glass architectural bridge carrying fine amber light paths from the agency toward the right. Right middle: credible upright smartphones on a refined physical charging rack, discrete realistic social media photo grids without readable text, and a human operator at a monitor behind them. The agency must feel the foreground relationship layer, the phone operation its supporting infrastructure. Show depth, authentic materials, natural human proportions, illuminated faces and equipment. Charcoal and midnight background, champagne gold and amber lighting with very restrained violet accents. Upper third mostly quiet dark negative space for live HTML headline, bottom edge quiet for captions. Crisp commercial studio finish, not sci-fi fantasy. No text, letters, logos, numbers, fake statistics, card borders, watermarks, glowing brains, robots or circuit-board clichés. Image should remain clearly readable, not underexposed.

Mobile prompt:
Use case: ads-marketing. Create an original portrait 3:4 photographic editorial scene for a premium agency partners mobile landing page. The agency relationship and managed phone operation must both be clearly visible in ONE coherent realistic studio. At upper left a male and female agency professional reviewing client social media content at a desk; at lower right a neat compact bank of four realistic smartphones with photographic social media grids on a workstation and a human operations specialist just behind. A fine ribbon of warm amber light links the two work areas diagonally, representing a partnership. Dark charcoal professional studio, warm gold illumination, restrained violet reflected highlights, realistic hands and faces, extremely legible well-lit people and equipment, high-end advertising photography and subtle compositing, not sci-fi or generic AI. No lettering, logos, statistics, text, watermarks, card frames, robots, brains. No empty black upper half: fill the portrait with the scene, since HTML text will sit above it.

## Release decision

OWNER_VISUAL_APPROVAL_REQUIRED=YES
FINAL_VERDICT=HOLD
NEXT_ACTION=Validate the Partners Preview visually before any production promotion; repeat production SHA and parallel-file gates at that time.
