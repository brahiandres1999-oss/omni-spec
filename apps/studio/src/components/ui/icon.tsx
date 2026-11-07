/**
 * The only module allowed to import lucide-react (DS-12): one stroke width for the whole app and two sizes.
 * `size` is a literal type, so any other value fails `tsc --noEmit`.
 */
import type { LucideIcon } from 'lucide-react';

export type IconSize = 16 | 18;

export interface IconProps {
  icon: LucideIcon;
  size?: IconSize;
  /** Accessible name; without it the icon is decorative and hidden from assistive technology. */
  label?: string;
  className?: string;
}

export function Icon({ icon: Glyph, size = 16, label, className }: IconProps) {
  return (
    <Glyph
      size={size}
      strokeWidth={1.75}
      className={className ? `shrink-0 ${className}` : 'shrink-0'}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  );
}

export type { LucideIcon };
export {
  Activity,
  Archive,
  ArchiveRestore,
  ArrowDownWideNarrow,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Columns2,
  Copy,
  Ellipsis,
  File,
  FilePlus,
  FileDiff,
  Files,
  Folder,
  FolderOpen,
  FolderPlus,
  Gauge,
  GitBranch,
  Hammer,
  History,
  KanbanSquare,
  LayoutPanelLeft,
  LayoutGrid,
  ListTree,
  MessageSquare,
  MessageSquarePlus,
  Network,
  Pencil,
  PanelRight,
  Plus,
  Radar,
  RefreshCw,
  RotateCcw,
  Rows3,
  ScanSearch,
  Search,
  SendHorizontal,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  SquareTerminal,
  TerminalSquare,
  X,
  Zap,
} from 'lucide-react';
