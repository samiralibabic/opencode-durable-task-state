# Releasing

## Before every release

1. Confirm `package.json` contains the intended version and supported OpenCode range.
2. Run `npm ci`, `npm test`, and `npm run pack:check`.
3. Confirm the release tag will be exactly `v<package version>`.
4. Push the commit, then push the release tag.
5. Verify the package from the npm registry before creating the matching GitHub release.

The `publish.yml` workflow validates that the tag matches `package.json`, reruns all tests against the packed artifact and released OpenCode binary, and publishes with provenance.

## First publish only

npm Trusted Publishing cannot create an unclaimed package. The package was bootstrapped with a temporary granular npm token stored as the `NPM_TOKEN` Actions secret. The token needs **Bypass 2FA**; otherwise publishing fails with `EOTP`.

For a new package, npm first published a public `0.0.0-stage` placeholder and held `0.1.0` for several minutes before it appeared on the registry; `0.1.1` was likewise visible about three minutes after its workflow succeeded. During that delay the version did not appear under Staged Packages, and re-publishing it failed with `409 Cannot publish over previously staged version`. Wait for the registry before retrying. `0.1.1` repeats `0.1.0` with no code changes.

After the bootstrap, the `NPM_TOKEN` secret was deleted, the temporary tokens were revoked, and GitHub Actions was configured as the Trusted Publisher with publish permission:

```sh
npm trust github opencode-durable-task-state \
  --repo samiralibabic/opencode-durable-task-state --file publish.yml --allow-publish
```

npm expires a new trust configuration that has not authorized a publish within 48 hours. `0.1.2`, which has no code changes, was the first OIDC publish and validated it. If the configuration ever has to be recreated, publish a release within 48 hours.

Remaining one-time step: restrict traditional token publishing in the npm package settings.

## Later publishes

Push the release tag with no `NPM_TOKEN` secret configured. npm CLI detects GitHub's OIDC environment and uses the Trusted Publisher configured for `publish.yml`.

Do not submit ecosystem listings until the first registry package has been installed and tested successfully.
