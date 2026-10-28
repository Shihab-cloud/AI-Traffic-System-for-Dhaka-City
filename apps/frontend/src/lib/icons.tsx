/**
 * Every icon the app draws, named for what it means rather than what it looks like, so one meaning
 * has one glyph everywhere and a glyph changes in one place. Lucide only (`lucide-react`), plus the
 * brand marks below; lint refuses icon imports anywhere else.
 *
 * Several meanings may share a glyph, and a page's header always takes the same icon as the
 * sidebar link that leads to it.
 */
import {
  ArrowLeft,
  ArrowRightLeft,
  AtSign,
  Ban,
  Bell,
  BellOff,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleQuestionMark,
  CircleUserRound,
  Copy,
  Download,
  Ellipsis,
  EllipsisVertical,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Flag,
  GripVertical,
  Headset,
  House,
  IdCard,
  Info,
  KeyRound,
  Lock,
  LogIn,
  LogOut,
  LucideProvider,
  Mail,
  Megaphone,
  MessageCircleQuestionMark,
  MessageSquare,
  MonitorX,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  RotateCcwKey,
  Save,
  Scale,
  Search,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  ShieldOff,
  ShieldUser,
  ShieldX,
  SlidersHorizontal,
  Sun,
  TicketPlus,
  Trash2,
  UserCheck,
  Users,
  X,
  Banknote,
  Camera,
  Car,
  CarFront,
  Cctv,
  ChartColumn,
  Clock,
  CreditCard,
  Film,
  Gauge,
  History,
  LayoutDashboard,
  MapPin,
  Play,
  Receipt,
  RefreshCw,
  Route,
  ScanLine,
  Sparkles,
  Square,
  TriangleAlert,
  Undo2,
  Upload,
  Video,
  WandSparkles,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode, SVGProps } from 'react';

export type IconType = LucideIcon;

/**
 * Sizes every icon to `1em` unless it says otherwise, so an icon without a `size` follows the text
 * beside it. Lucide's own default is a fixed 24px, which an unsized icon in a button or a caption
 * would outgrow.
 */
export function IconProvider({ children }: { children: ReactNode }) {
  // The provider's type says number, but it only forwards `size` to each icon's width and height,
  // which take any CSS length — as an icon's own `size` prop is typed to.
  return <LucideProvider size={'1em' as unknown as number}>{children}</LucideProvider>;
}

export const Icons = {
  // ─── Destinations: each sidebar link and the header of the page it opens ───
  support: Headset,
  faq: MessageCircleQuestionMark,
  appSettings: Settings,
  profile: CircleUserRound,
  security: Lock,
  roles: ShieldUser,
  users: Users,
  notifications: Bell,
  notificationPreferences: SlidersHorizontal,
  /** It broadcasts an announcement. */
  notificationComposer: Megaphone,

  // ─── Actions ───
  add: Plus,
  edit: Pencil,
  delete: Trash2,
  close: X,
  /** Takes one item out of a list, rather than closing a surface. */
  remove: X,
  save: Save,
  copy: Copy,
  download: Download,
  attach: Paperclip,
  view: Eye,
  search: Search,
  dragHandle: GripVertical,
  more: Ellipsis,
  moreVertical: EllipsisVertical,

  // ─── Navigation ───
  home: House,
  back: ArrowLeft,
  chevronRight: ChevronRight,
  expand: ChevronDown,
  sidebarCollapse: PanelLeftClose,
  sidebarExpand: PanelLeftOpen,

  // ─── Status ───
  check: Check,
  error: CircleAlert,
  info: Info,
  question: CircleQuestionMark,
  /** Behind a page the user's role does not open. */
  noAccess: ShieldX,
  verified: ShieldCheck,

  // ─── Account and security ───
  login: LogIn,
  logout: LogOut,
  key: KeyRound,
  lock: Lock,
  resetPassword: RotateCcwKey,
  /** Signs a user out of every device. */
  revokeSessions: MonitorX,
  mfaOn: ShieldCheck,
  mfaOff: ShieldOff,
  ban: Ban,
  unban: UserCheck,
  email: Mail,
  emailSent: Send,
  phone: Phone,
  username: AtSign,
  idCard: IdCard,
  /** A group of permissions in the role editor. */
  permissions: Shield,
  visible: Eye,
  hidden: EyeOff,
  lightMode: Sun,
  darkMode: Moon,

  // ─── Notifications and support ───
  notification: Bell,
  notificationsOff: BellOff,
  announcement: Megaphone,
  message: MessageSquare,
  assigned: UserCheck,
  priority: Flag,
  statusChange: ArrowRightLeft,
  ticketCreated: TicketPlus,

  // ─── Content ───
  file: FileText,
  spreadsheet: FileSpreadsheet,
  legal: Scale,

  // ─── Traffic enforcement ───
  overview: ChartColumn,
  dashboard: LayoutDashboard,
  violation: TriangleAlert,
  surveillance: Cctv,
  track: Route,
  cases: FileText,
  reviews: Scale,
  camera: Camera,
  vehicle: Car,
  /** The passed-vehicle list: every vehicle a camera saw pass. */
  passedVehicles: CarFront,
  fines: Banknote,
  payments: CreditCard,
  receipt: Receipt,
  audit: History,
  speed: Gauge,
  plate: ScanLine,
  location: MapPin,
  time: Clock,
  /** Explanation written by the vision-language model. */
  ai: Sparkles,
  start: Play,
  stop: Square,
  upload: Upload,
  video: Video,
  videoFile: Film,
  ipCamera: Wifi,
  refresh: RefreshCw,
  undo: Undo2,
  /** Zones learned automatically from traffic. */
  autoZones: WandSparkles,
} as const satisfies Record<string, IconType>;

type MarkProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & { size?: number | string };

/** Google's "G", in its own colours — a brand mark, so not recoloured with the text. */
function GoogleMark({ size = '1em', ...props }: MarkProps) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden {...props}>
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

/**
 * Dhaka Traffic's mark: Lucide's traffic cone on a road-sign amber tile, the same as the home page's.
 * Fixed colours, so it reads on light and dark backgrounds alike.
 */
function AppMark({ size = '1em', ...props }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden {...props}>
      <rect width={24} height={24} rx={6} fill="#f5a524" />
      <g
        transform="translate(3.6 3.4) scale(0.7)"
        fill="none"
        stroke="#1a1405"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M16.05 10.966a5 2.5 0 0 1-8.1 0" />
        <path d="m16.923 14.049 4.48 2.04a1 1 0 0 1 .001 1.831l-8.574 3.9a2 2 0 0 1-1.66 0l-8.574-3.91a1 1 0 0 1 0-1.83l4.484-2.04" />
        <path d="M16.949 14.14a5 2.5 0 1 1-9.9 0L10.063 3.5a2 2 0 0 1 3.874 0z" />
        <path d="M9.194 6.57a5 2.5 0 0 0 5.61 0" />
      </g>
    </svg>
  );
}

/** Marks that are someone's logo rather than an icon: drawn exactly, never swapped for a glyph. */
export const BrandMarks = { google: GoogleMark, app: AppMark };
