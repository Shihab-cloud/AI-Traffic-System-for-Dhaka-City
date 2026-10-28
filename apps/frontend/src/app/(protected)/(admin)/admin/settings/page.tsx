import { RedirectType, redirect } from 'next/navigation';

import { RouteUrls } from '@/lib/routes/route.config';

export default function Page() {
  return redirect(RouteUrls.admin.settings.appConfig, RedirectType.replace);
}
