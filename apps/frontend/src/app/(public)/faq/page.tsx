'use client';

import FaqViewLayout from '@/components/common/help/FaqViewLayout';
import useFaqAction from '@/hooks/actions/useFaqAction';

export default function FaqPage() {
  const { useFaqListQuery } = useFaqAction();
  const { data, isFetching } = useFaqListQuery({ page: 1, limit: 1000 });
  const items = data?.data || [];

  return <FaqViewLayout items={items} isFetching={isFetching} contactCta={{ kind: 'signin' }} />;
}
