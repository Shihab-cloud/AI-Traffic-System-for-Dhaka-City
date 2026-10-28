import { Box, Typography } from '@mui/material';

interface SectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: string;
}

export default function SectionHeader({
  title,
  subtitle,
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <Box className={className} {...props}>
      <Typography
        variant="h6"
        sx={{ fontSize: '1.125rem', fontWeight: 500, color: 'text.primary' }}
      >
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {subtitle}
        </Typography>
      )}
    </Box>
  );
}
