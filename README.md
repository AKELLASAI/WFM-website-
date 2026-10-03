# WFM-WEBSITE

## Layout

- `server.js` — Node server (no dependencies), API and static file host. Lives at the project root.
- `New fsds /` — the web front end (`wfm.html`, `wfm.js`, `wfm.css`) served by the server.
- `test/` — API integration tests. `wfm-data.json` — role and user store (created on first change, git-ignored).

## Start locally

```sh
npm start
```

Open http://localhost:8000. Sign in with email and password, or create an account from the sign-up page (new accounts get the Employee role). The seeded Super Admin is `cxo@finsol.com`; its password is `WFM_ADMIN_PASSWORD`, or `Admin@123` outside production. Other seeded users have no password until an admin sets one in User master.

Run the API integration tests with `npm test`.

Production mode (`NODE_ENV=production`) uses secure, HTTP-only session cookies and requires `WFM_ADMIN_PASSWORD`; serve it over HTTPS.

## Account and access administration

The Role master controls the Overview, Request queue, Create requests, Update status and ETA, Assign requests, Reports, Role master, and User master functions. Every role must be granted at least one screen. The User master stores each user’s name, work email, mobile number, department, and role; only active accounts can request an OTP.

Roles and users are persisted in `wfm-data.json`, which is created when the masters are first changed and is excluded from source control. Sessions are held in memory and expire after eight hours, so restarting the server signs users out. This file-backed setup is intended for a single-process deployment/test environment; a multi-instance production deployment should use a shared database and session store.
