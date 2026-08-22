# Systemd deployment

Production releases use this layout:

```text
/var/www/cycleo.mcp/
├── current -> releases/<commit-sha>
└── releases/
    └── <commit-sha>/
```

The delivery workflow never edits a live release. It prepares a new directory,
switches `current` atomically, restarts the service and calls
`http://127.0.0.1:8787/healthz`. A failed restart or health check restores the
previous symlink and restarts the previous release.

## One-time server preparation

The service account and SSH deployment account should be separate. The service
account needs read access to `/var/www/cycleo.mcp`; the deployment account needs
write access to that directory and passwordless permission for only the service
restart command.

Node.js 20.6 or newer and npm must be installed on the server.

1. Create the `cycleo-mcp` system user if it does not already exist.
2. Ensure the SSH deployment user owns `/var/www/cycleo.mcp` and that directories
   are traversable by `cycleo-mcp`.
3. Store production variables in `/etc/cycleo-mcp/environment`, owned by root
   with mode `0600`. It must include at least:

   ```text
   MCP_AUTH_MODE=bearer
   MCP_HOST=127.0.0.1
   PORT=8787
   MCP_PUBLIC_URL=https://mcp.cycleo.com
   OAUTH_RESOURCE=https://mcp.cycleo.com
   OAUTH_ISSUER=https://www.cycleo.com
   CYCLEO_API_BASE_URL=https://www.cycleo.com/api/v1
   ```

4. Install [`ops/cycleo-mcp.service`](../ops/cycleo-mcp.service) as
   `/etc/systemd/system/cycleo-mcp.service` and run `systemctl daemon-reload`.
   Do not restart yet: the first deployment creates the `current` symlink. The
   deployment script refuses to proceed unless systemd's loaded `ExecStart`
   points to `/var/www/cycleo.mcp/current/src/server.mjs`.
5. Give the deployment user narrowly scoped sudo permission. Confirm the
   `systemctl` path with `command -v systemctl`; a typical sudoers entry is:

   ```text
   deploy-user ALL=(root) NOPASSWD: /usr/bin/systemctl restart cycleo-mcp.service
   ```

The public MCP URL should terminate HTTPS at the existing reverse proxy and
proxy to `127.0.0.1:8787`.

## GitHub production environment

Create a GitHub environment named `production`. Add these secrets:

- `SSH_HOST`
- `SSH_USER`
- `SSH_PRIVATE_KEY`
- `SSH_KNOWN_HOSTS`

Obtain `SSH_KNOWN_HOSTS` through a trusted server console or verify its
fingerprint out of band. The workflow uses strict host-key checking and will not
learn a host key automatically.

Optional GitHub environment variables:

- `SYSTEMD_SERVICE` defaults to `cycleo-mcp.service`;
- `SSH_PORT` defaults to `22`;
- `HEALTHCHECK_URL` defaults to `http://127.0.0.1:8787/healthz` and is restricted
  to a loopback URL.

Adding an approval rule to the `production` environment provides a manual gate
before GitHub opens the SSH connection.

## Release

For a tagged release, update `package.json` and `package-lock.json` to the same
version, then push the matching tag, for example `v0.2.0`. A mismatched tag is
rejected before deployment. The workflow can also be started manually from the
GitHub Actions page for a selected commit.

Old release directories are retained for auditing and manual rollback. They can
be pruned separately after confirming they are no longer needed.
