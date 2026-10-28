'use client';

import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import { usePathname } from 'next/navigation';
import { Icons, type IconType } from '@/lib/icons';

interface SettingsPageMeta {
  title: string;
  subtitle?: string;
  icon?: IconType;
}

const META_BY_SLUG: Record<string, SettingsPageMeta> = {
  'app-config': {
    title: 'App Settings',
    subtitle: 'Platform-wide configuration for this workspace.',
    icon: Icons.appSettings,
  },
};

const DEFAULT_META: SettingsPageMeta = { title: 'Settings', icon: Icons.appSettings };

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const slug = pathname.split('/').filter(Boolean).pop() ?? '';
  const meta = META_BY_SLUG[slug] ?? DEFAULT_META;

  return (
    <div className="flex flex-col">
      <PageHeader title={meta.title} subtitle={meta.subtitle} icon={meta.icon} />
      <PageBody>{children}</PageBody>
    </div>
  );
}
