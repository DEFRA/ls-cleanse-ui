# Cleanse: test Entra setup and user management

## 1. First-time setup

### Entra configuration

1. Sign in to the [Entra admin centre](https://entra.microsoft.com/) and select
   your test tenant. Confirm it supports group-based application assignment
   (Entra P1/P2) and that you can manage groups and applications.
2. Under **Groups**, create two **Security** groups with membership type
   **Assigned**: `Cleanse-Test-Users` and `Cleanse-Test-Admins`. Add Kris Dyson
   to each as both **Owner** and **Member**.
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
   Locally there is no CDP STS token, so the secret stands in for the
   federated credential the production registration uses.
6. Under **App roles**, create two roles, each with allowed member types
   **Users/Groups** and enabled:
   - display name `Cleanse user`, value `cleanse-user`, description
     `Can sign in to Cleanse and work on issues`;
   - display name `Cleanse admin`, value `cleanse-admin`, description
     `Can sign in to Cleanse and use its admin area`.
7. Under **Enterprise applications**, open `Cleanse Local Test`:
   - In **Properties**, set **Assignment required? Yes**.
   - In **Users and groups**, assign `Cleanse-Test-Users` the role `Cleanse user`
     and `Cleanse-Test-Admins` the role `Cleanse admin`.
   - Do not add direct user assignments or other groups.
8. Leave implicit grants and public-client flows disabled. No group claims or
   Graph directory permissions are required: the ID token carries the app
   roles. The application requests `openid profile email`. Under **API
   permissions**, add the Microsoft Graph delegated permissions `openid`,
   `profile` and `email`, and grant consent if your tenant requires it. Cleanse
   uses the `email` claim, or `preferred_username` if `email` is missing, to
   link a first sign-in to a user who was added in advance.

### Local application configuration

Run `.\dev-docker-up.ps1` once to create the ignored local `.env` file, then fill
in the Entra values below and run it again. Generated local secrets are saved in
`.env`; keep this file private.

| Setting                          | Value                                       |
| -------------------------------- | ------------------------------------------- |
| `AUTH_MODE`                      | `entra`                                     |
| `ENTRA_TENANT_ID`                | Your test tenant ID                         |
| `ENTRA_CLIENT_ID`                | Your test application ID                    |
| `ENTRA_CLIENT_AUTH`              | `secret`                                    |
| `ENTRA_CLIENT_SECRET`            | The client secret value                     |
| `ENTRA_REDIRECT_URI`             | `http://localhost:3000/auth/entra/callback` |
| `ENTRA_POST_LOGOUT_REDIRECT_URI` | `http://localhost:3000/login`               |

The startup script and Compose pass these settings from `.env` into the local
Docker container. If using a different browser-facing port, update the URLs in
both Entra and the application.

Verify that a group member can sign in, an ordinary non-member is rejected by
Entra, and only a member of `Cleanse-Test-Admins` can open `/admin`.

## 2. Ongoing usage

### Add a user

1. Ensure the user exists in the test tenant; invite them as a guest if needed
   and permitted.
2. Open **Groups > Cleanse-Test-Users > Members > Add members**.
3. Add the user directly, not through a nested group.
4. Allow time for the change to propagate, then ask them to sign in to Cleanse.
   After their first successful sign-in, the user directory records
   their identity, full name and last-logon time for use in assignment.

To assign issues to someone before they first sign in, an admin can add their
email address in **Admin > Users > Add users**. When they first sign in, Cleanse
links them to that record by email address and replaces the name derived from
the email address with their Entra name. Adding someone there does not let them
sign in; access is still controlled by the groups above.

To make someone an admin, add them to `Cleanse-Test-Admins` in the same way.
Roles are read at sign-in, so a change applies from the user's next sign-in.

### Remove a user

1. Open **Groups > Cleanse-Test-Users > Members**, and `Cleanse-Test-Admins`
   if they are an admin.
2. Select the user and choose **Remove**.
3. Once Entra has applied the change, new sign-ins will be refused. An existing
   Cleanse session may remain valid until its four-hour expiry.
4. Reassign any outstanding issues. Previously recorded user information and
   assignments are retained; removing membership does not delete them.
