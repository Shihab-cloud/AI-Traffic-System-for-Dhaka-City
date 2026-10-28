import type { Metadata } from 'next';

import LegalDocument, { type LegalSection } from '@/components/common/legal/LegalDocument';
import { LegalList, LegalParagraph } from '@/components/common/legal/LegalText';
import { LEGAL_CONFIG } from '@/lib/constants/legal.config';
import { RouteUrls } from '@/lib/routes/route.config';

const { product, operator, contactEmail } = LEGAL_CONFIG;

export const metadata: Metadata = { title: `Privacy Policy · ${product}` };

const SECTIONS: LegalSection[] = [
  {
    id: 'who-we-are',
    title: 'Who we are',
    content: (
      <LegalParagraph>
        {product} is operated by {operator} (“we”, “us”). This policy explains what information the
        service holds about the people who use it, why, and what choices they have.
      </LegalParagraph>
    ),
  },
  {
    id: 'information-we-collect',
    title: 'Information we collect',
    content: (
      <>
        <LegalParagraph>We collect only what the service needs to work:</LegalParagraph>
        <LegalList
          items={[
            <>
              <strong>Account details</strong> — your name, email address and username, and anything
              you choose to add to your profile, such as a phone number, date of birth, gender or a
              profile picture.
            </>,
            <>
              <strong>Sign-in and security data</strong> — a one-way hash of your password (never
              the password itself), the two-step verification methods you set up, devices you choose
              to trust, and your sign-in sessions.
            </>,
            <>
              <strong>Content you add</strong> — the files you upload, and the support tickets and
              messages you send us.
            </>,
            <>
              <strong>Notifications</strong> — your notification preferences and, if you allow push
              notifications, a device token for your browser.
            </>,
            <>
              <strong>Activity logs</strong> — technical records of requests made to the service,
              such as the time, the page or action, and the signed-in user, kept to run and secure
              the service.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'how-we-use-it',
    title: 'How we use it',
    content: (
      <LegalList
        items={[
          'To provide the service and the features you use.',
          'To keep accounts secure: signing you in, verifying it is you, and detecting misuse.',
          'To communicate with you: invitations, password resets, notifications you have switched on, and replies to support requests.',
          'To operate and improve the service: diagnosing errors and understanding how it performs.',
        ]}
      />
    ),
  },
  {
    id: 'sharing',
    title: 'Who we share it with',
    content: (
      <>
        <LegalParagraph>
          We do not sell personal information or use it for advertising. We share it only with
          providers that help run the service, under agreements that limit their use of it to that
          purpose:
        </LegalParagraph>
        <LegalList
          items={[
            'Cloud hosting, database and file storage providers, which hold the service’s data.',
            'An email delivery provider, which sends account and notification emails.',
            'A push notification provider, if you switch push notifications on.',
            'An avatar service, which receives your display name to draw a picture of your initials when you have not uploaded one.',
          ]}
        />
        <LegalParagraph>
          We will also disclose information where the law requires it, or to protect the rights,
          safety and security of our users and the service.
        </LegalParagraph>
      </>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies',
    content: (
      <LegalParagraph>
        The service uses cookies to keep you signed in, to remember devices you have chosen to
        trust, and to remember display preferences such as the theme. We do not use advertising or
        cross-site tracking cookies.
      </LegalParagraph>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    content: (
      <LegalParagraph>
        We keep account information for as long as your account exists, and the content you add for
        as long as it is needed to provide the service or the law requires us to keep it. Activity
        logs are kept for a limited period and then deleted. When an account is closed, we delete or
        anonymise its personal information unless we must keep it for a legal reason.
      </LegalParagraph>
    ),
  },
  {
    id: 'security',
    title: 'How we protect it',
    content: (
      <LegalParagraph>
        Information is encrypted in transit, passwords are stored only as one-way hashes, access is
        limited by role, and two-step verification is available on every account. No system is
        perfectly secure; if we become aware of a breach affecting your information, we will tell
        you as the law requires.
      </LegalParagraph>
    ),
  },
  {
    id: 'your-rights',
    title: 'Your choices and rights',
    content: (
      <LegalParagraph>
        You can view and correct your profile at any time from your account settings. Depending on
        where you are, you may also have the right to request a copy of your information, ask us to
        delete it, or object to how it is used. To make a request, contact us at {contactEmail}.
      </LegalParagraph>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    content: (
      <LegalParagraph>
        We may update this policy as the service changes. The date at the top shows when it last
        changed, and we will give notice of significant changes within the service or by email.
      </LegalParagraph>
    ),
  },
  {
    id: 'contact',
    title: 'Contact us',
    content: (
      <LegalParagraph>
        Questions about this policy or about your information can be sent to {operator} at{' '}
        {contactEmail}.
      </LegalParagraph>
    ),
  },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      summary={`What ${product} holds about the people who use it, and why.`}
      sections={SECTIONS}
      related={{ label: 'Terms & Conditions', href: RouteUrls.terms }}
    />
  );
}
