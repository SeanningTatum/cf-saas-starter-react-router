import type * as React from "react";
import {
  IconCamera,
  IconDashboard,
  IconDatabase,
  IconFileAi,
  IconFileDescription,
  IconFileWord,
  IconHelp,
  IconInnerShadowTop,
  IconReport,
  IconSearch,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";

import { NavMain } from "./nav-main";
import { NavUser } from "./nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ROUTES } from "@/lib/constants/routes";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user: {
    name: string;
    email: string;
    image?: string | null;
  };
}

export function AppSidebar({ user, ...props }: AppSidebarProps) {
  const { t } = useTranslation("common");
  const { t: ta } = useTranslation("admin");

  const data = {
    navMain: [
      {
        title: t("nav.home"),
        url: `${ROUTES.admin}/`,
        icon: IconDashboard,
      },
      {
        title: t("nav.users"),
        url: ROUTES.adminUsers,
        icon: IconUsers,
      },
      {
        title: t("nav.kitchen_sink"),
        url: ROUTES.adminKitchenSink,
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
  };

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:p-1.5!">
              <Link to={`${ROUTES.admin}/`}>
                <IconInnerShadowTop className="size-5!" />
                <span className="text-base font-semibold">{t("company_name")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
