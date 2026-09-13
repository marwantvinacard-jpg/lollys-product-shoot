# Privacy Policy

> **⚠️ TEMPLATE — NOT LEGAL ADVICE.** This describes what the current codebase
> actually does with data, as a starting point — it is not a compliant
> privacy policy on its own. Depending on where your users are, you likely
> need to address GDPR (EU), CCPA/CPRA (California), and similar regimes
> explicitly, appoint a data protection contact if required, and have a
> lawyer review this before publishing it. Do not publish this as-is.

**Last updated:** 2026-09-12

## 1. Who we are

**LB Solutions** ("we", "us") — currently an unregistered individual/sole
proprietorship, not yet a formed legal entity — operates **Lolly's Product
Shoot App** (the "Service"). This policy explains what data the Service
collects and how it's used, based on the Service's actual current
implementation.

## 2. Data we collect

| Data | Purpose | Where it's stored |
|---|---|---|
| Email address, password (hashed by Firebase Auth) | Account creation and sign-in | Firebase Authentication |
| Uploaded product/model photos | Sent to AI providers to generate imagery/video | Not persisted server-side beyond the generation request; results are stored in Firebase Storage under your account |
| Generated images/videos | The Service's core output | Firebase Storage, access-controlled to your account |
| Usage records (feature used, estimated cost, timestamp) | Usage tracking, rate limiting, abuse prevention | Firestore (`lollys_api_usage_history`) |
| Support ticket contents (your message, email, account ID) | Responding to help requests | Firestore (`support_tickets`), visible only to you and the operator |
| Uncaught client error reports (error message, stack trace, page context — no photo/prompt content) | Diagnosing bugs | Firestore (`client_errors`); also sent to Sentry if `VITE_SENTRY_DSN` is configured |
| [Add: analytics, payment data if/when billing is added] | | |

We do **not** currently sell personal data to third parties.

## 3. Third parties that process your data

Generating content necessarily sends your prompts and uploaded images to:

- **Google** (Gemini image generation, Veo video generation)
- **fal.ai**, which in turn routes to **ByteDance** (Seedance) and **Kling**'s
  model providers, when those engines are used

Each has its own privacy policy governing how they handle content submitted
to their APIs. [Link to each provider's current data processing terms once
you've reviewed them, and confirm whether they train on submitted data by
default.]

Infrastructure: **Google Cloud / Firebase** (Authentication, Firestore,
Storage, Cloud Functions) hosts and processes all of the above. **Sentry**
(if configured) processes error reports; **Stripe** (if/when billing is
enabled) would process payment data — we would never see full card numbers.

## 4. Content you generate

Photos and videos you upload or generate may depict real people (including,
via the model-face-blending feature, a face you provide). You are responsible
for having the right to use any likeness you upload. [State your actual
retention/deletion policy for uploaded and generated media once decided.]

## 5. Data retention

- Usage history records are **append-only and never deleted** (see
  `firestore.rules`) — kept for audit purposes.
- [PLACEHOLDER — state actual retention for generated media, account data
  after account deletion, support tickets, and error reports.]

## 6. Your rights

Depending on your location, you may have rights to access, correct, delete,
or export your data. [Describe your actual process for handling these
requests, and reference GDPR Art. 15-22 / CCPA rights explicitly if
applicable to your user base.]

## 7. Children's privacy

The Service is not directed at children under 18. [State your actual
compliance approach, e.g. COPPA, if you expect users under 18 despite the
Terms of Service's account age minimum.]

## 8. Changes to this policy

[Describe your actual notice process for policy changes.]

## 9. Contact

Questions about this policy or your data: marwan.tvinacard@gmail.com.
