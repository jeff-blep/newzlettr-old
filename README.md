# Newzlettr (Plex Newsletter)

Web UI (Vite + React) + Node/Express API for generating & emailing Plex newsletters using Tautulli stats.

## Quick Start (dev)
```bash
npm install
PUBLIC_ORIGIN="http://127.0.0.1:3001" PORT=3001 npm run dev:all
# Frontend: http://localhost:5173
# Backend:  http://127.0.0.1:3001
First run
	1.	Open the UI → Settings.
	2.	Enter Plex URL/Token, Tautulli URL/API Key, SMTP creds.
	3.	Click Test for each → should show OK → Save.
	4.	Create a Template, create a Newsletter, add Recipients, Send.

Reset to a clean slate (dev)
printf '{\n  "smtpHost": "",\n  "smtpPort": 587,\n  "smtpSecure": false,\n  "smtpUser": "",\n  "smtpPass": "",\n  "fromAddress": "",\n  "plexUrl": "",\n  "plexToken": "",\n  "tautulliUrl": "",\n  "tautulliApiKey": "",\n  "lookbackDays": 0,\n  "ownerRecommendation": {},\n  "lastTest": { "plex": "unknown", "tautulli": "unknown", "smtp": "unknown" }\n}\n' > server/config.json
printf '[]\n' > server/emailtemplates.json
printf '[]\n' > server/newsletters.json
printf '[]\n' > server/recipients.json
: > .env
echo 'VITE_API_ORIGIN=http://127.0.0.1:3001' > .env.development
Notes
	•	The app only pulls data after Plex and Tautulli tests pass.
	•	Email banner (Manual/Scheduled send) is removed in production emails.
	•	History window in the UI defaults to blank unless you set a number.
