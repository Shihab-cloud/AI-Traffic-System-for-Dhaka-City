import { Avatar } from '@mui/material';
import { twMerge } from 'tailwind-merge';
import { type IconType } from '@/lib/icons';

export interface LogWrapperProps {
  children?: React.ReactNode;
  icon: IconType;
  startIconProps?: { className?: string };
}

export default function LogWrapper({ children, icon: Icon, startIconProps }: LogWrapperProps) {
  return (
    <div className="flex items-start">
      <Avatar
        sx={{
          bgcolor: 'white',
          width: 32,
          height: 32,
          borderWidth: 1,
          borderColor: 'divider',
          color: 'primary.main',
          mt: '12px',
          ml: '16px',
          flexShrink: 0,
        }}
      >
        <Icon className={twMerge('h-4 w-4', startIconProps?.className)} />
      </Avatar>
      <div
        style={{
          width: 16,
          height: 2,
          backgroundColor: '#d1d5db',
          marginTop: 27,
          flexShrink: 0,
        }}
      />
      {children}
    </div>
  );
}
