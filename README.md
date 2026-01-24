# Welcome to React Router!

A modern, production-ready template for building full-stack React applications using React Router.

## Features

- 🚀 Server-side rendering
- ⚡️ Hot Module Replacement (HMR)
- 📦 Asset bundling and optimization
- 🔄 Data loading and mutations
- 🔒 TypeScript by default
- 🎉 TailwindCSS for styling
- 🔐 Better Auth integration
- 🗄️ Drizzle ORM with D1 Database
- 📡 tRPC API
- 📖 [React Router docs](https://reactrouter.com/)

---

## Getting Started

### First-Time Setup (Recommended)

The easiest way to get started is using our automated setup script. This interactive wizard will configure your entire Cloudflare infrastructure in minutes.

```bash
bun run scripts/first-time-setup.ts
```

**What the setup script does:**

1. **Verifies Wrangler Authentication** - Checks you're logged into Cloudflare CLI
2. **Handles Multiple Accounts** - Prompts you to select an account if you have multiple
3. **Creates Cloudflare Resources:**
   - D1 Database (`{project-name}-db`)
   - R2 Bucket (`{project-name}-bucket`)
   - KV Namespace (optional)
4. **Generates Secure Secrets** - Creates `BETTER_AUTH_SECRET` automatically
5. **Creates Configuration Files:**
   - `wrangler.jsonc` with your resource IDs
   - `.env` with authentication secrets
6. **Installs Dependencies** - Runs `bun install`
7. **Runs Database Migrations** - Applies schema to local and remote databases
8. **Deploys to Cloudflare** - Your app is live immediately!

**Prerequisites:**
```bash
# Install Wrangler CLI and login
bun add -g wrangler
wrangler login
```

### Manual Installation

If you prefer manual setup:

```bash
bun install
```

### Development

Start the development server with HMR:

```bash
bun run dev
```

Your application will be available at `http://localhost:5173`.

### Authentication Setup

This project uses [Better Auth](https://better-auth.com/) for authentication. The authentication secret is stored in `.env` for local development.

For production deployment, set the secret using Wrangler:

```bash
# Generate a new secret
openssl rand -base64 32

# Set the secret in Cloudflare
wrangler secret put BETTER_AUTH_SECRET
```

The authentication API is available at `/api/auth/*`.

### MCP Server Setup (Optional)

This project includes optional Model Context Protocol (MCP) server integrations for enhanced AI capabilities in Cursor. See [`.cursor/MCP_SETUP.md`](.cursor/MCP_SETUP.md) for detailed setup instructions.

**Quick setup:**
```bash
cp .cursor/mcp.template.json .cursor/mcp.json
# Edit .cursor/mcp.json and add your API keys
```

---

## UI/UX Team Guide: Kitchen Sink

The Kitchen Sink is a comprehensive showcase of all available UI components in this project. It's designed to help UI/UX team members explore, test, and understand the design system.

### Accessing the Kitchen Sink

1. Start the development server: `bun run dev`
2. Navigate to: `http://localhost:5173/admin/kitchen-sink`

### Available Component Categories

#### Layout Components
| Component | Description | Use Case |
|-----------|-------------|----------|
| **Accordion** | Collapsible content sections | FAQs, settings panels |
| **Collapsible** | Simple show/hide content | Expandable sections |
| **AspectRatio** | Maintains aspect ratio for content | Images, videos, embeds |
| **Empty State** | Placeholder for empty data | No results, empty lists |

#### Form Components
| Component | Description | Use Case |
|-----------|-------------|----------|
| **Button** | Primary action buttons | Submit, cancel, actions |
| **ButtonGroup** | Grouped action buttons | Toolbars, segmented controls |
| **Input** | Text input field | Forms, search |
| **InputGroup** | Input with addons | Email with icon, currency |
| **InputOTP** | One-time password input | Verification codes |
| **Textarea** | Multi-line text input | Comments, descriptions |
| **Select** | Dropdown selection | Single choice from list |
| **NativeSelect** | Native HTML select | Simple dropdowns |
| **Checkbox** | Boolean selection | Toggles, multi-select |
| **RadioGroup** | Single selection from options | Exclusive choices |
| **Switch** | Toggle switch | On/off settings |
| **Slider** | Range selection | Volume, price range |
| **Toggle** | Icon toggle button | Formatting buttons |
| **ToggleGroup** | Grouped toggle buttons | Text formatting toolbar |

#### Feedback Components
| Component | Description | Use Case |
|-----------|-------------|----------|
| **Alert** | Inline notification | Warnings, info messages |
| **Progress** | Progress indicator | Loading, upload progress |
| **Skeleton** | Loading placeholder | Content loading states |
| **Spinner** | Loading spinner | Async operations |
| **Toast** | Temporary notification | Success/error messages |

#### Data Display
| Component | Description | Use Case |
|-----------|-------------|----------|
| **Avatar** | User profile image | User representation |
| **Badge** | Status indicator | Tags, counts, status |
| **Separator** | Visual divider | Section separation |

#### Overlays & Navigation
| Component | Description | Use Case |
|-----------|-------------|----------|
| **Dialog** | Modal window | Forms, confirmations |
| **Drawer** | Slide-in panel | Mobile menus, details |
| **Sheet** | Side panel | Settings, filters |
| **AlertDialog** | Confirmation dialog | Destructive actions |
| **Popover** | Floating content | Rich tooltips |
| **Tooltip** | Simple hover info | Icon explanations |
| **HoverCard** | Preview on hover | User profiles |
| **ContextMenu** | Right-click menu | Actions menu |
| **DropdownMenu** | Click dropdown | User menu, actions |
| **Menubar** | Application menu | File, Edit, View menus |
| **Breadcrumb** | Navigation path | Page hierarchy |
| **Pagination** | Page navigation | Lists, tables |
| **Tabs** | Tabbed content | Organized sections |
| **Table** | Data table | Data display |
| **Calendar** | Date picker | Date selection |
| **Carousel** | Sliding content | Image galleries |
| **Command** | Command palette | Search, shortcuts |
| **ScrollArea** | Custom scrollbar | Scrollable containers |

### Using the Kitchen Sink for Design Review

1. **Component Discovery**: Browse all available components to understand what's already built
2. **Consistency Check**: Ensure your designs use existing components before requesting new ones
3. **State Testing**: Interact with components to see hover, focus, and active states
4. **Responsive Testing**: Resize the browser to see how components adapt
5. **Dark Mode**: Toggle dark mode to verify component appearance (if implemented)

---

## Cursor Click-to-Edit Tutorial

Cursor IDE has a powerful feature that allows you to click on any element in your running application and jump directly to its source code. This is incredibly useful for UI/UX designers and developers working together.

### How to Use Click-to-Edit

#### Step 1: Start the Development Server
```bash
bun run dev
```

#### Step 2: Open in Cursor's Browser
Instead of using Chrome/Safari, use Cursor's built-in browser:
1. In Cursor, open the Command Palette (`Cmd+Shift+P` on Mac, `Ctrl+Shift+P` on Windows/Linux)
2. Type "Simple Browser: Open" and select it
3. Enter `http://localhost:5173`

#### Step 3: Enable Click-to-Source
1. In the Simple Browser panel, look for the inspection/click icon in the toolbar
2. Click it to enable "click to source" mode
3. Now click on any UI element in your app

#### Step 4: Jump to Component Code
When you click on an element:
- Cursor will automatically open the file containing that component
- Your cursor will be positioned at the exact line where that element is defined
- You can immediately start editing!

### Practical Examples for UI/UX Team

#### Example 1: Changing Button Text
1. Navigate to the Kitchen Sink page
2. Enable click-to-source mode
3. Click on any "Default" button
4. Cursor opens `kitchen-sink.tsx` at the button definition
5. Change `<Button>Default</Button>` to `<Button>Primary Action</Button>`
6. Save - see the change instantly with HMR!

#### Example 2: Modifying Component Styles
1. Click on a Card component
2. Cursor opens the card in `kitchen-sink.tsx`
3. Add or modify Tailwind classes directly
4. Example: Add `className="shadow-lg"` to increase shadow

#### Example 3: Finding Reusable Components
1. Click on an element you want to reuse
2. Look at the import statement at the top of the file
3. Example: `import { Button } from "@/components/ui/button"`
4. Navigate to that file to see all available variants and props

### Tips for UI/UX Collaboration

1. **Point and Discuss**: During screen shares, use click-to-source to show exactly which component you're discussing

2. **Quick Prototyping**: UI designers can click elements and make small tweaks to test ideas

3. **Component Discovery**: Click on elements you like to find their source and reuse them

4. **Style Debugging**: If something looks wrong, click it to find where the styles are defined

5. **Variant Exploration**: After clicking a component, check its source file for available `variant` props

### Common Component Customizations

#### Button Variants
```tsx
<Button variant="default">Default</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="destructive">Destructive</Button>
```

#### Badge Variants
```tsx
<Badge>Default</Badge>
<Badge variant="secondary">Secondary</Badge>
<Badge variant="outline">Outline</Badge>
<Badge variant="destructive">Destructive</Badge>
```

#### Alert Variants
```tsx
<Alert>Default info alert</Alert>
<Alert variant="destructive">Error alert</Alert>
```

### Working with the Design System

All UI components are located in `app/components/ui/`. Each file exports a component that follows these patterns:

- **Consistent API**: Components use similar prop patterns (`variant`, `size`, etc.)
- **Tailwind Styling**: All styles use Tailwind CSS classes
- **Radix Primitives**: Many components are built on accessible Radix UI primitives
- **shadcn/ui Based**: Components follow the shadcn/ui design system

To add new components:
```bash
bunx shadcn@latest add [component-name]
```

---

## Drizzle Studio: Database Management

Drizzle Studio is a visual database management tool that lets you view, edit, and manage your database directly. This is useful for development tasks like promoting users to admin.

### Starting Drizzle Studio

```bash
bun run db:studio
```

This will start Drizzle Studio and open it in your browser (typically at `https://local.drizzle.studio`).

### Tutorial: Promoting a User to Admin

Follow these steps to upgrade a user account to admin role:

#### Step 1: Start Drizzle Studio
```bash
bun run db:studio
```

#### Step 2: Navigate to the User Table
1. In the left sidebar, click on the **user** table
2. You'll see a list of all registered users

#### Step 3: Find the User
1. Look through the table to find the user you want to promote
2. You can identify users by their `email` or `name` columns
3. Use the search/filter if you have many users

#### Step 4: Edit the User's Role
1. Click on the row of the user you want to edit
2. Find the `role` column (it will show `user` for regular users)
3. Click on the cell to edit it
4. Change the value from `user` to `admin`
5. Press Enter or click away to confirm

#### Step 5: Save Changes
1. Click the **Save Changes** button (or press `Cmd+S` / `Ctrl+S`)
2. The change is immediately applied to your local database

### User Table Schema Reference

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Unique user identifier (primary key) |
| `name` | text | User's display name |
| `email` | text | User's email address (unique) |
| `emailVerified` | boolean | Whether email has been verified |
| `image` | text | Profile image URL |
| `role` | text | User role: `user` or `admin` |
| `banned` | boolean | Whether user is banned |
| `banReason` | text | Reason for ban (if banned) |
| `banExpires` | timestamp | When ban expires (if temporary) |
| `createdAt` | timestamp | Account creation date |
| `updatedAt` | timestamp | Last update date |

### Common Database Tasks

#### View All Admins
1. Open the `user` table
2. Click the filter icon
3. Add filter: `role` equals `admin`

#### Ban a User
1. Find the user in the `user` table
2. Set `banned` to `true` (or `1`)
3. Optionally set `banReason` to explain why
4. Optionally set `banExpires` for a temporary ban
5. Save changes

#### Delete a User
1. Find the user in the `user` table
2. Click the row to select it
3. Click the delete button (trash icon)
4. Confirm the deletion

> **Note:** Deleting a user will cascade delete their sessions and accounts due to foreign key constraints.

### Working with Remote Database

By default, Drizzle Studio connects to your local D1 database. To work with your production database:

1. First, ensure you have the remote database ID in your `wrangler.jsonc`
2. Use Wrangler to interact with remote data:

```bash
# Execute SQL on remote database
bunx wrangler d1 execute YOUR_DB_NAME --remote --command "SELECT * FROM user WHERE role = 'admin'"

# Update a user to admin on remote
bunx wrangler d1 execute YOUR_DB_NAME --remote --command "UPDATE user SET role = 'admin' WHERE email = 'user@example.com'"
```

### Alternative: Seed Script for Test Admin

For development, you can also use the seed script to create a test admin:

```bash
bun run scripts/seed-test-admin.ts
```

This creates a pre-configured admin account for testing purposes.

---

## Previewing the Production Build

Preview the production build locally:

```bash
bun run preview
```

## Building for Production

Create a production build:

```bash
bun run build
```

## Deployment

Deployment is done using the Wrangler CLI.

To build and deploy directly to production:

```bash
bun run deploy
```

To deploy a preview URL:

```bash
bunx wrangler versions upload
```

You can then promote a version to production after verification or roll it out progressively.

```bash
bunx wrangler versions deploy
```

## Styling

This template comes with [Tailwind CSS](https://tailwindcss.com/) already configured for a simple default starting experience. You can use whatever CSS framework you prefer.

---

Built with ❤️ using React Router.
