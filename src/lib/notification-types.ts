/** S-57: notification section shapes — pure, safe to import from client components. */
export type NotificationItem = { label: string; href: string };
export type NotificationSection = {
  key: string;
  label: string;
  count: number;
  href: string;
  items: NotificationItem[];
};

export function notificationBadgeTotal(sections: readonly NotificationSection[]): number {
  return sections.reduce((n, s) => n + s.count, 0);
}
