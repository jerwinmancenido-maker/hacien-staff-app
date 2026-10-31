// Small grey line icons (inline SVG, no icon library).

type P = { size?: number };
const base = (size = 16) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const HomeIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>
);
export const UsersIcon = ({ size }: P) => (
  <svg {...base(size)}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.4 3.6 5.2" /></svg>
);
export const TruckIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M2 6h12v10H2zM14 10h4l4 3v3h-8" /><circle cx="6" cy="18" r="1.8" /><circle cx="18" cy="18" r="1.8" /></svg>
);
export const GearIcon = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 14H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 20.4 10H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></svg>
);
export const FileIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M14 3H6v18h12V7z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></svg>
);
export const CartIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M3 4h2l2.4 11h10.2L20 7H6.2" /><circle cx="9" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" /></svg>
);
export const BoxIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></svg>
);
export const CoinIcon = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="8.5" /><path d="M9 9h4.5a2 2 0 0 1 0 4H9V8v8M8 11h8" /></svg>
);
export const BookIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z" /><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20" /></svg>
);
export const ListIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg>
);
export const SearchIcon = ({ size }: P) => (
  <svg {...base(size)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const PlusIcon = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>
);
export const InboxIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M5.5 5h13L21 13v6H3v-6z" /></svg>
);
export const LogoutIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M15 4h4v16h-4M10 17l5-5-5-5M15 12H3" /></svg>
);
export const CopyIcon = ({ size }: P) => (
  <svg {...base(size)}><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
);
export const CheckIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M20 6 9 17l-5-5" /></svg>
);
export const MailIcon = ({ size }: P) => (
  <svg {...base(size)}><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
);
export const PhoneIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
);
export const DotsHorizontalIcon = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /><circle cx="5" cy="12" r="1.5" /></svg>
);
export const ChevronDownIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="m6 9 6 6 6-6" /></svg>
);
export const CardViewIcon = ({ size }: P) => (
  <svg {...base(size)}><rect width="18" height="6" x="3" y="4" rx="2" /><rect width="18" height="6" x="3" y="14" rx="2" /></svg>
);
export const CompactViewIcon = ({ size }: P) => (
  <svg {...base(size)}><line x1="3" x2="21" y1="6" y2="6" /><line x1="3" x2="21" y1="12" y2="12" /><line x1="3" x2="21" y1="18" y2="18" /></svg>
);
export const GridViewIcon = ({ size }: P) => (
  <svg {...base(size)}><rect width="7" height="7" x="3" y="3" rx="1.5" /><rect width="7" height="7" x="14" y="3" rx="1.5" /><rect width="7" height="7" x="14" y="14" rx="1.5" /><rect width="7" height="7" x="3" y="14" rx="1.5" /></svg>
);
export const BellIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
);
export const AlertTriangleIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" x2="12" y1="9" y2="13" /><line x1="12" x2="12.01" y1="17" y2="17" /></svg>
);
export const ClockIcon = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
);
export const MenuIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
export const CloseIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const ChevronLeftIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="m15 6-6 6 6 6" /></svg>
);
export const ChevronRightIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="m9 6 6 6-6 6" /></svg>
);

