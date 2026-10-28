import { SubSidebarSectionType } from './index.routes';
import { RouteUrls } from './route.config';
import { Icons } from '@/lib/icons';

export const SystemConfigurationSubSections: SubSidebarSectionType[] = [
  {
    title: 'Roles & Permissions',
    link: RouteUrls.system.roles,
    subtitle: 'Manage your roles and permissions',
    icon: Icons.roles,
  },
];
