# AI Team V3 — وظيفة كل جزء في البرنامج

مرجع معماري: كل ملف ووظيفته. (V3 يقود 7+ واجهات AI ويب عبر Electron webviews بأمان.)

## `src/core/` — المنطق الأساسي (لا Electron)

| الملف | الوظيفة |
|---|---|
| `orchestrator.js` | قلب الغرفة: يدير دورة النقاش، يشغّل كل provider بالتسلسل، يعزل الأعطال، يجمع التقرير النهائي (transcript + diagnostics + traces + quota + health + reasoning). |
| `provider-actor.js` | آلة الحالة لكل provider: IDLE→PREPARING→BUDGET_CHECK→SENDING→VERIFIED→WAITING→CAPTURED→COOLDOWN. كل انتقال مسجّل. يفصل الإجابة عن التفكير، يخزّن التفكير منفصلًا. |
| `prompt-builder.js` | يبني الـ prompt: briefing مرة وحدة لكل provider، بعدها delta-only. يدوّر أهداف الجولات (تحليل→تحدّي→خلاصة) عبر الدورات. |
| `prompt-ledger.js` | يتتبّع: هل أُرسل briefing لهذا الـ provider؟ آخر turn مُسلّم؟ يضمن briefing-once و delta-only. |
| `budget-guard.js` | يمنع إرسال أي prompt يتجاوز السقف **قبل** الإرسال (منع حرق quota). |
| `quota-guard.js` | يعدّ المحاولات/الفشل/الحروف، يعطّل provider بعد 3 فشل متتالٍ أو عند limit. |
| `response-normalizer.js` | الـ firewall: يقبل الإجابة النظيفة فقط، يرفض (challenge/limit/error/prompt-echo/thinking-leak/secrets/duplicate). **يفصل التفكير عن الإجابة** ويرجع `{text, reasoning}`. |
| `transcript-store.js` | المحادثة العامة — **الإجابات النظيفة فقط** (لا تفكير، لا diagnostics). |
| `diagnostics-store.js` | مخزن منفصل للأعطال/الرفض — metadata فقط، لا يدخل الـ transcript. |
| `reasoning-store.js` | **(جديد)** مخزن منفصل لتفكير كل AI — مقروء لحاله، يُعرض في الواجهة، لا يدخل الـ transcript أبدًا. |
| `trace-store.js` | سجل انتقالات الحالة وأحداث budget/CDP — metadata فقط (لا prompt/response خام). |
| `redact.js` | مصدر وحيد لأنماط حجب الأسرار (cookies/tokens/emails/paths) عبر كل التقارير. |
| `provider-health.js` | يتتبّع صحة كل provider عبر الجولات (available/loggedIn/failures/captureReliability). |
| `provider-health-classifier.js` | **(جديد)** يصنّف صحة الـ provider الحية: READY/LOGIN_WALL/CHALLENGE/RATE_LIMITED/SELECTOR_DRIFT/SEND_FAILED/CAPTURE_TIMEOUT. |
| `model-classifier.js` | **(جديد)** يصنّف موديل الـ AI: POWERFUL (تفكير عميق) / FAST (سريع) / BALANCED، من اسم الموديل المعروض. |
| `problem-detector.js` | يحلل التقارير: نمو prompt، تلوث transcript، briefing مكرر، محاولات live ممنوعة. |
| `run-analyzer.js` | يفحص التقرير النهائي: هل الجولات مكتملة؟ هل في خلاصة؟ |
| `mode-definitions.js` | تعريف الـ 12 mode (debate/consensus/redTeam/silentJury/...) ومعايير القبول لكل واحد. |
| `dashboard-state.js` | يبني حالة الواجهة من الملفات المحلية + يبني `conversation[]` (إجابة + تفكير مقترنين). |
| `report-viewer.js` | يولّد عارض تقارير HTML محلي — يمرّ كل شي على الـ redactor. |
| `approval-gate-manager.js` | بوابات الموافقة على الأفعال الحية (doctor/smoke/discussion) — تتطلب env + تأكيد بشري. |
| `settings-store.js` | إعدادات آمنة افتراضيًا — لا live auto-send، allowedProviders=qwen/kimi. |
| `event-bus.js` | ناقل أحداث داخلي بسيط. |

## `src/electron/` — طبقة Electron / الأتمتة الحية

| الملف | الوظيفة |
|---|---|
| `main.js` | نقطة دخول Electron: النافذة الرئيسية (أعلام عزل كاملة)، IPC handlers، بوابة `provider:open` (تتطلب تأكيد + env). |
| `preload.js` | جسر آمن أدنى (3 دوال فقط) بين الواجهة والـ main. |
| `provider-window-manager.js` | ينشئ نوافذ الـ providers (WebContentsView، أعلام عزل، **backgroundThrottling:false**). |
| `send-controller.js` | يكتب الـ prompt (trusted typing + DOM-injection fallback) ويرسل (in-page click/Enter primary، focus-independent) ويتحقق (composer-clear OR response-count). |
| `dom-capture.js` | يلتقط رد الـ AI من الـ DOM، **يطرح التفكير من الإجابة**، يلتقط لوحة التفكير منفصلة، يكشف اسم الموديل. |
| `lifecycle-monitor.js` | ينتظر استقرار الرد (baseline + stability window + stop-signal)، يمرّر التفكير. |
| `cdp-monitor.js` | يراقب الشبكة عبر CDP — يحجب الـ headers/bodies (لا أسرار). |
| `file-upload-controller.js` | **(جديد)** يرفق ملف لواجهة الـ AI عبر CDP setFileInputFiles + فحص magic-bytes/حجم/مسار. |
| `room-file-share.js` | **(جديد)** يوزّع ملف واحد على كل الـ providers في الغرفة. |
| `edge-cookie-importer.js` | استيراد كوكيز Edge (allowlist فقط، لا قيم تُسجّل). |
| `localstorage-vault.js` | خزنة localStorage مشفّرة (safeStorage)، ترفض إنشاء plaintext جديد. |
| `wait-assertions.js` | انتظارات مبنية على شروط (مثل Playwright)، لا sleeps ثابتة كاستراتيجية أساسية. |
| `renderer.js` / `renderer.html` | الواجهة: بطاقات providers + **محادثة (إجابة + بلوك تفكير 🧠 منفصل)** + صحة + traces. |

## `src/providers/`

| الملف | الوظيفة |
|---|---|
| `webview-provider-adapter.js` | تعريفات الـ 11 provider (selectors، URLs، thinkingSelectors، redaction policy) + المحوّل الحي. |
| `provider-contract.js` | يتحقق من اكتمال تعريف الـ provider + allowlist الـ ladder (qwen/kimi) + forbidden (chatgpt/claude). |
| `provider-session-policy.js` | سياسة الـ live: كل provider مسموح ماعدا chatgpt/claude، الكل human-gated. |
| `base-provider.js` / `fake-provider.js` | الواجهة الأساسية + provider وهمي للاختبارات (12 mode عدائي). |

## `scripts/` — أدوات التشغيل

| السكربت | الأمر | الوظيفة |
|---|---|---|
| `selector-doctor.js` | `npm run doctor:provider -- qwen` | يتحقق من selectors الـ provider بدون إرسال. |
| `smoke-one-provider.js` | `npm run smoke:one-provider` | أول إرسال حي (qwen/kimi، آمن). |
| `health-check.js` | `npm run health:check` | **(جديد)** فحص صحة + موديل كل الـ providers (per-process). |
| `stress-suite.js` | `npm run stress:suite` | **(جديد)** ضغط offline: 60 جولة + chaos seeds + كل الـ modes. |
| `live-discussion.js` | `npm run live:discussion` | غرفة نقاش حية (بوابة أدلة + موافقة). |
| `manual-login.js` | `npm run login -- <provider>` | تسجيل دخول يدوي لأي provider مسموح. |

## التحقق
`npm run test:v3-all` = **42/42**. + stress + endurance + 12 modes + chaos + validate:offline-real.
