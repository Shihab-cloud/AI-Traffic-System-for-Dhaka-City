export enum FaqAudienceEnum {
  PUBLIC = 'PUBLIC',
  MEMBER = 'MEMBER',
  ADMIN = 'ADMIN',
}

export interface FaqAudienceOption {
  value: FaqAudienceEnum;
  label: string;
  description: string;
}

export const FAQ_AUDIENCE_OPTIONS: FaqAudienceOption[] = [
  {
    value: FaqAudienceEnum.PUBLIC,
    label: 'Public',
    description: 'Visible to everyone, including guests who are not logged in',
  },
  {
    value: FaqAudienceEnum.MEMBER,
    label: 'Member',
    description: 'Visible to all signed-in members',
  },
  {
    value: FaqAudienceEnum.ADMIN,
    label: 'Admin',
    description: 'Visible to administrators',
  },
];
