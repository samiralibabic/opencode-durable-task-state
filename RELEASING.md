# Releasing

## Before every release

1. Confirm `package.json` contains the intended version and supported OpenCode range.
2. Run `npm ci`, `npm test`, and `npm run pack:check`.
3. Confirm the release tag will be exactly `v<package version>`.
4. Push the commit, then push the release tag.
5. Verify the package from the npm registry before creating the matching GitHub release.

The `publish.yml` workflow validates that the tag matches `package.json`, reruns all tests against the packed artifact and released OpenCode binary, and publishes with provenance.

## First publish only

npm Trusted Publishing cannot create an unclaimed package. The package was bootstrapped with a temporary granular npm token stored as the `NPM_TOKEN` Actions secret. npm turned that first `v0.1.0` publish of a new package into a staged publish: it created the public `0.0.0-stage` placeholder, but the staged `0.1.0` never appeared for approval and later publishes of `0.1.0` are rejected as "previously staged". `0.1.0` is therefore unavailable, and `0.1.1` is the first release.

Remaining one-time steps after the first release is verified from the public registry:

1. In the package settings on npmjs.com, configure GitHub Actions as a Trusted Publisher for `samiralibabic/opencode-durable-task-state` and workflow filename `publish.yml`. Under Allowed Actions, explicitly permit direct `npm publish`.
2. Delete the `NPM_TOKEN` repository secret and revoke the temporary npm token.
3. Restrict traditional token publishing in the npm package settings after the OIDC publisher has been verified.

## Later publishes

Push the release tag with no `NPM_TOKEN` secret configured. npm CLI detects GitHub's OIDC environment and uses the Trusted Publisher configured for `publish.yml`.

Do not submit ecosystem listings until the first registry package has been installed and tested successfully.
