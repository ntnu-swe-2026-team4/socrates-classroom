import { LayoutDashboard, Megaphone, Users } from "lucide-react";

export const ADMIN_SECTIONS = [
  { tab: "overview", label: "admin_tab_overview", icon: LayoutDashboard },
  { tab: "users", label: "admin_tab_users", icon: Users },
  { tab: "notify", label: "admin_tab_notify", icon: Megaphone },
] as const;
export type AdminTab = (typeof ADMIN_SECTIONS)[number]["tab"];
