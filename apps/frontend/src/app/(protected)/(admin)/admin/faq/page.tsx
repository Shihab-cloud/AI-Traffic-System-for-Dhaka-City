'use client';

import FaqViewLayout from '@/components/common/help/FaqViewLayout';
import { useFaqAdminControls } from '@/components/common/help/useFaqAdminControls';
import useFaqAction from '@/hooks/actions/useFaqAction';
import { RouteUrls } from '@/lib/routes/route.config';

export default function SuperAdminFaqPage() {
  const { useFaqListAllQuery } = useFaqAction();
  const { data, isFetching } = useFaqListAllQuery({ page: 1, limit: 1000 });
  const serverItems = data?.data ?? [];

  const { items, setLocalItems, openCreate, handleEdit, handleDelete, modals, reorderBar } =
    useFaqAdminControls(serverItems);

  return (
    <FaqViewLayout
      items={items}
      isFetching={isFetching}
      contactCta={{ kind: 'support-link', href: RouteUrls.admin.support.index }}
      canManage
      onCreateClick={openCreate}
      onEdit={handleEdit}
      onDelete={handleDelete}
      onItemsChange={setLocalItems}
      reorderBar={reorderBar}
      modals={modals}
    />
  );
}
