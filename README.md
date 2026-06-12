# lime-crm

Lime Trading CRM — built with React 19 + Vite 8 + Supabase.

## User Management

### Superuser Setup

Designate a permanent superuser by setting `VITE_SUPERUSER_EMAIL` in both `.env` (local) and Vercel environment variables (production):

```
VITE_SUPERUSER_EMAIL=rkim@limex.com
```

To add in Vercel: **Dashboard → Project → Settings → Environment Variables**.

The superuser always has `admin` access regardless of their database role. They cannot be deactivated or demoted via the UI.

### Inviting Users

1. Go to **Settings → Users → Invite User**
2. Enter the invitee's email and select their role
3. Copy the generated invite link and send it to them
4. The invitee clicks the link, authenticates via Google OAuth
5. Their role is automatically assigned based on the invitation

Roles available when inviting: `admin`, `partner`, `sales`, `operations`, `compliance`, `analyst`.

### Default Role for New Signups

Users who sign up without a valid invitation receive the `pending` role and are immediately shown a holding page. They cannot access any CRM data until an admin promotes them via **Settings → Users**.

### Pending Approvals

When a pending user exists, admins see:
- A red badge on the **Settings** nav section
- A dismissible amber banner at the top of every page
- The pending user in **Settings → Users → Pending Approval**

To approve: select their role from the dropdown and click **Activate**.

### Deactivating Users

In **Settings → Users**, use the **⋯** action menu on any user row to deactivate them. Deactivated users are immediately signed out on their next request and redirected to the login page with a "deactivated" message.

---

## Development

```bash
npm install
npm run dev
```

Requires `.env` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_SUPERUSER_EMAIL`.

## Database Migrations

Migrations are in `supabase/migrations/`. Run them in order against your Supabase project via the SQL editor or Supabase CLI.
