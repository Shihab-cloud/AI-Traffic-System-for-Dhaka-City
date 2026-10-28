import type { Metadata } from 'next';

import LegalDocument, { type LegalSection } from '@/components/common/legal/LegalDocument';
import { LegalList, LegalParagraph } from '@/components/common/legal/LegalText';
import { LEGAL_CONFIG } from '@/lib/constants/legal.config';
import { RouteUrls } from '@/lib/routes/route.config';

const { product, operator, contactEmail, governingLaw } = LEGAL_CONFIG;

export const metadata: Metadata = { title: `Terms & Conditions · ${product}` };

const SECTIONS: LegalSection[] = [
  {
    id: 'agreement',
    title: 'Agreement to these terms',
    content: (
      <LegalParagraph>
        These terms govern your use of {product} (the “service”), operated by {operator} (“we”,
        “us”). By creating an account, signing in or using the service you agree to them. If you use
        it on behalf of an organisation, you confirm you are authorised to accept them for that
        organisation.
      </LegalParagraph>
    ),
  },
  {
    id: 'your-account',
    title: 'Your account',
    content: (
      <LegalList
        items={[
          'Give accurate information when you create your account, and keep it up to date.',
          'Keep your password private and do not share your account with anyone.',
          'Use two-step verification where it is offered or required.',
          `Tell us at ${contactEmail} straight away if you think your account has been used without your permission.`,
          'You are responsible for what is done through your account until you report a problem.',
        ]}
      />
    ),
  },
  {
    id: 'acceptable-use',
    title: 'Acceptable use',
    content: (
      <>
        <LegalParagraph>When using the service, you must not:</LegalParagraph>
        <LegalList
          items={[
            'upload content you have no right to share, or that is unlawful or harmful;',
            'try to reach accounts, data or parts of the service you have not been given access to;',
            'interfere with the service, test its security without our written permission, or overload it;',
            'copy, resell or reverse engineer the service, except where the law allows it.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'your-content',
    title: 'Your content',
    content: (
      <LegalParagraph>
        The content you add to the service remains yours. You give us permission to store and
        process it only to provide the service. How we handle personal information is described in
        the <a href={RouteUrls.privacyPolicy}>Privacy Policy</a>.
      </LegalParagraph>
    ),
  },
  {
    id: 'availability',
    title: 'Availability and changes',
    content: (
      <LegalParagraph>
        We work to keep the service available and reliable, but it may sometimes be unavailable, for
        example during maintenance. We may change, add or remove features over time, and will give
        notice of changes that significantly affect how you use the service.
      </LegalParagraph>
    ),
  },
  {
    id: 'suspension',
    title: 'Suspension and termination',
    content: (
      <LegalParagraph>
        We may suspend or close your account if these terms are broken, or to protect the service
        and its users. You may stop using the service at any time. Sections that by their nature
        should survive termination continue to apply.
      </LegalParagraph>
    ),
  },
  {
    id: 'disclaimers',
    title: 'Disclaimers',
    content: (
      <LegalParagraph>
        To the extent the law allows, the service is provided “as is” and “as available”, without
        warranties of any kind, including fitness for a particular purpose and uninterrupted or
        error-free operation.
      </LegalParagraph>
    ),
  },
  {
    id: 'liability',
    title: 'Limitation of liability',
    content: (
      <LegalParagraph>
        To the extent the law allows, we are not liable for indirect, incidental or consequential
        losses, or for loss of profits, revenue or data, arising from your use of the service.
        Nothing in these terms limits liability that cannot be limited by law.
      </LegalParagraph>
    ),
  },
  {
    id: 'governing-law',
    title: 'Governing law',
    content: (
      <LegalParagraph>
        These terms are governed by the laws of {governingLaw}, and disputes will be handled by the
        courts that have jurisdiction there.
      </LegalParagraph>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    content: (
      <LegalParagraph>
        We may update these terms. The date at the top shows when they last changed. If you keep
        using the service after a change takes effect, the updated terms apply.
      </LegalParagraph>
    ),
  },
  {
    id: 'contact',
    title: 'Contact us',
    content: (
      <LegalParagraph>
        Questions about these terms can be sent to {operator} at {contactEmail}.
      </LegalParagraph>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms & Conditions"
      summary={`The rules for using ${product}, and what you and we are each responsible for.`}
      sections={SECTIONS}
      related={{ label: 'Privacy Policy', href: RouteUrls.privacyPolicy }}
    />
  );
}
