# Product

<!-- impeccable:product-schema 1 -->

This file describes the starter itself. In a fork, replace these answers or delete this file before you run `brand-init`: it takes an existing `PRODUCT.md` as settled and asks nothing.

## Platform

web

React Router v7 with server rendering on Cloudflare Workers. No native code.

## Users

Two kinds of people:

- **The developer who forks the starter** to build their own SaaS, often through a coding agent. They open the repo to get a working base and rules an agent can follow.
- **The end users of the SaaS that developer builds.** They sign up, use the dashboard and upload files. Admins manage users.

## Product Purpose

A SaaS starter that a developer forks and extends. It ships email and password auth, an admin area (user list, ban and unban, an analytics overview), file upload to R2, i18n (en, zh) and dark mode. It also ships the harness that keeps agents on track: issues as the plan, gates in `scripts/verify.sh`, sub-agents and workflows.

## Positioning

Harness-first and AI-first. The same Workers runtime runs on a laptop and at the edge. Other starters hand over code; this one also hands over the checks and the workflow that keep the code right as agents change it.

## Capabilities and Constraints

- Stack: Cloudflare Workers, React Router v7, tRPC, D1 with Drizzle, Better Auth, Effect TS, ShadCN and Tailwind.
- The screens are a base to build on, not a sample product. A feature belongs here when most forks would keep it.
- Lean is a constraint: a package, file or rule stays only while something uses it.

## Brand Commitments

The starter has a name and no brand. Its look is the neutral token set in `app/app.css`.

## Evidence on Hand

Two public apps built on the starter, listed in the README under "In the wild". No customers, testimonials, benchmarks or pricing exist; future work must not invent them.

## Product Principles

- The developer and their agent are both users. A flow that works only for one is not done.
- What ships to the end user stays small and fast.

## Accessibility & Inclusion

WCAG 2.1 AA as a floor: keyboard-operable, visible focus, 4.5:1 text contrast in light and dark, respects reduced motion. Bilingual (en, zh) from the start.
