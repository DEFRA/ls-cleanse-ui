# Cleanse: test Entra setup and user management

## 1. First-time setup

### Entra configuration

1. Sign in to the [Entra admin centre](https://entra.microsoft.com/) and select
   your test tenant. Confirm it supports group-based application assignment
   (Entra P1/P2) and that you can manage groups and applications.
2. Under **Groups**, create a **Security** group named `Cleanse-Test-Users`,
   with membership type **Assigned**. Add Kris Dyson as both **Owner** and
   **Member**.
3. Under **App registrations > New registration**:
   - Name: `Cleanse Local Test`.
   - Account type: **Accounts in this organizational directory only**.
   - Platform: **Web**.
   - Redirect URI: `http://localhost:3000/auth/entra/callback`.
   - Add `http://localhost:3000/login` as a second Web redirect URI for the
     post-logout return.
4. Record the **Directory (tenant) ID** and **Application (client) ID**.
   Add Kris as an app-registration owner.
5. Under **Certificates & secrets**, create a client secret. Save its **value**
   securely and set a reminder before its expiry. Never commit it to Git.
6. Under **Enterprise applications**, open `Cleanse Local Test`:
   - In **Properties**, set **Assignment required? Yes**.
   - In **Users and groups**, assign only `Cleanse-Test-Users`.
   - Do not add direct user assignments or other groups.
7. Leave implicit grants and public-client flows disabled. No group claims,
   app roles or Graph directory permissions are required. The application will
   request `openid profile`; grant consent if your tenant requires it.

### Local application configuration

Run `.\dev-docker-up.ps1` once to create the ignored local `.env` file, then fill
in the Entra values below and run it again. Generated local secrets are saved in
`.env`; keep this file private.

| Setting                          | Value                                       |
| -------------------------------- | ------------------------------------------- |
| `AUTH_MODE`                      | `entra`                                     |
| `ENTRA_TENANT_ID`                | Your test tenant ID                         |
| `ENTRA_CLIENT_ID`                | Your test application ID                    |
| `ENTRA_CLIENT_SECRET`            | The client secret value                     |
| `ENTRA_REDIRECT_URI`             | `http://localhost:3000/auth/entra/callback` |
| `ENTRA_POST_LOGOUT_REDIRECT_URI` | `http://localhost:3000/login`               |

The startup script and Compose pass these settings from `.env` into the local
Docker container. If using a different browser-facing port, update the URLs in
both Entra and the application.

Verify that a group member can sign in and an ordinary non-member is rejected by
Entra.

## 2. Ongoing usage

### Add a user

1. Ensure the user exists in the test tenant; invite them as a guest if needed
   and permitted.
2. Open **Groups > Cleanse-Test-Users > Members > Add members**.
3. Add the user directly, not through a nested group.
4. Allow time for the change to propagate, then ask them to sign in to Cleanse.
   After their first successful sign-in, the user directory records
   their identity, full name and last-logon time for use in assignment.

### Remove a user

1. Open **Groups > Cleanse-Test-Users > Members**.
2. Select the user and choose **Remove**.
3. Once Entra has applied the change, new sign-ins will be refused. An existing
   Cleanse session may remain valid until its four-hour expiry.
4. Reassign any outstanding issues. Previously recorded user information and
   assignments are retained; removing membership does not delete them.
