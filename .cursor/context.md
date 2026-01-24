# Project Context

## Overview
A SaaS starter template built with React Router and Cloudflare Workers. Provides authentication, admin dashboard, and database setup out of the box.

## Tech Stack
- **Framework**: React Router v7 (SSR on Cloudflare Workers)
- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite) with Drizzle ORM
- **Auth**: Better Auth
- **API**: tRPC for type-safe API routes
- **Styling**: Tailwind CSS v4, shadcn/ui components
- **Package Manager**: Bun

## Architecture
- **Repository Pattern**: Data access via `app/repositories/` - pure functions with `(db, input)` signature
- **tRPC Routes**: API layer in `app/trpc/routes/` - validates input, calls repositories
- **Server Loaders**: Use `context.trpc` for server-side data fetching
- **Client Hooks**: Use `api.routeName.useQuery/useMutation` for client-side

## Features

### Authentication
- Email/password auth via Better Auth
- User roles: `user`, `admin`
- Ban system with reason and expiration
- Session management with impersonation support
- **Key files**: `app/auth/`, `app/routes/authentication/`

### Admin Dashboard
- Protected admin routes at `/admin`
- User management table
- Interactive charts and analytics
- **Key files**: `app/routes/admin/`

### File Upload
- R2 bucket integration for file storage
- **Key files**: `app/components/file-upload.tsx`, `app/routes/api/upload-file.ts`

## API Routes
- `admin.getUsers` - List all users (admin only)
- Auth endpoints via Better Auth at `/api/auth/*`
- tRPC endpoints at `/api/trpc/*`

## Database
- **user**: Core user table with roles, ban status
- **session**: Auth sessions with impersonation support
- **account**: OAuth/credential accounts
- **verification**: Email verification tokens

## Recent Changes
<!-- Add recent changes here, most recent first -->
