import { RedirectType, redirect } from 'next/navigation';

import { SystemConfigurationSubSections } from '@/lib/routes/system-configuration.routes';

export default function Page() {
  return redirect(SystemConfigurationSubSections[0].link, RedirectType.replace);
}
