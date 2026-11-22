# Security policy

## Report a vulnerability in private

Do not open a public issue or pull request for a security hole.

Use GitHub private vulnerability reporting: open the repository's **Security** tab, choose **Report a vulnerability**, or go straight to
<https://github.com/SeanningTatum/cf-saas-starter-react-router/security/advisories/new>.

Only you and the maintainers can see the report until a fix ships.

## What to include

- What is wrong and where (file, route, procedure or workflow).
- Steps to reproduce, or a short proof of concept.
- What an attacker gains: whose data, which action, which permission.
- The commit or release you tested.

## What the maintainer will do

- Acknowledge the report and ask for detail if the steps do not reproduce.
- Fix the hole on `main`, and publish an advisory once the fix is out.
- Credit you in the advisory, unless you ask to stay unnamed.

This is a one-person project. No response time is promised.

## Supported version

The `main` branch. Fixes land there; older releases do not get backports.

## If you forked this starter

Replace the repository path in the link above with your own, and turn on private vulnerability reporting: see [`docs/ci/supply-chain.md`](docs/ci/supply-chain.md).
