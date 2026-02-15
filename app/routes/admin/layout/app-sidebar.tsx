import * as React from "react"
import {
  IconCamera,
  IconChartBar,
  IconDashboard,
  IconDatabase,
  IconFileAi,
  IconFileDescription,
  IconFileWord,
  IconFolder,
  IconHelp,
  IconInnerShadowTop,
  IconListDetails,
  IconReport,
  IconSearch,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react"

import { NavDocuments } from "./nav-documents"
import { NavMain } from "./nav-main"
import { NavSecondary } from "./nav-secondary"
import { NavUser } from "./nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation("common")
  const { t: ta } = useTranslation("admin")

  const data = {
    user: {
      name: "shadcn",
      email: "m@example.com",
      avatar: "/avatars/shadcn.jpg",
    },
    navMain: [
      {
        title: t("nav.home"),
        url: "/admin/",
        icon: IconDashboard,
      },
      {
        title: t("nav.users"),
        url: "/admin/users",
        icon: IconUsers,
      },
      {
        title: t("nav.docs"),
        url: "/admin/docs",
        icon: IconFileDescription,
      },
      {
        title: t("nav.kitchen_sink"),
        url: "/admin/kitchen-sink",
        icon: IconSettings,
      },
    ],
    navClouds: [
      {
        title: ta("sidebar.capture"),
        icon: IconCamera,
        isActive: true,
        url: "#",
        items: [
          {
            title: ta("sidebar.active_proposals"),
            url: "#",
          },
          {
            title: ta("sidebar.archived"),
            url: "#",
          },
        ],
      },
      {
        title: ta("sidebar.proposal"),
        icon: IconFileDescription,
        url: "#",
        items: [
          {
            title: ta("sidebar.active_proposals"),
            url: "#",
          },
          {
            title: ta("sidebar.archived"),
            url: "#",
          },
        ],
      },
      {
        title: ta("sidebar.prompts"),
        icon: IconFileAi,
        url: "#",
        items: [
          {
            title: ta("sidebar.active_proposals"),
            url: "#",
          },
          {
            title: ta("sidebar.archived"),
            url: "#",
          },
        ],
      },
    ],
    navSecondary: [
      {
        title: t("nav.settings"),
        url: "#",
        icon: IconSettings,
      },
      {
        title: t("nav.get_help"),
        url: "#",
        icon: IconHelp,
      },
      {
        title: t("nav.search"),
        url: "#",
        icon: IconSearch,
      },
    ],
    documents: [
      {
        name: ta("sidebar.data_library"),
        url: "#",
        icon: IconDatabase,
      },
      {
        name: ta("sidebar.reports"),
        url: "#",
        icon: IconReport,
      },
      {
        name: ta("sidebar.word_assistant"),
        url: "#",
        icon: IconFileWord,
      },
    ],
  }

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <Link to="/admin/">
                <IconInnerShadowTop className="size-5!" />
                <span className="text-base font-semibold">{t("company_name")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        {/* <NavDocuments items={data.documents} /> */}
        {/* <NavSecondary items={data.navSecondary} className="mt-auto" /> */}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
