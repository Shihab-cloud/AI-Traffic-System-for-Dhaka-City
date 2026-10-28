'use client';

import {
  Box,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  ListItemText,
  MenuItem,
  Select,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { Controller, useFormContext } from 'react-hook-form';
import FaqCategorySelect from '@/components/common/help/FaqCategorySelect';
import useFaqAction from '@/hooks/actions/useFaqAction';
import { CreateFaqRequest } from '@/lib/dtos/request/faq.req';
import { FAQ_AUDIENCE_OPTIONS, FaqAudienceEnum } from '@/lib/enums/faq.enum';

interface FaqFormProps {
  onSubmit?: () => void;
}

export default function FaqForm({ onSubmit }: FaqFormProps) {
  const {
    control,
    formState: { errors },
  } = useFormContext<CreateFaqRequest>();

  const { useFaqCategoriesQuery } = useFaqAction();
  const { data: categories = [] } = useFaqCategoriesQuery();

  const audienceLabelLookup = FAQ_AUDIENCE_OPTIONS.reduce<Record<string, string>>((acc, opt) => {
    acc[opt.value] = opt.label;
    return acc;
  }, {});

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
      className="flex flex-col gap-4"
    >
      <Controller
        name="question"
        control={control}
        render={({ field }) => (
          <TextField
            {...field}
            label="Question"
            fullWidth
            error={!!errors.question}
            helperText={errors.question?.message}
          />
        )}
      />
      <Controller
        name="answer"
        control={control}
        render={({ field }) => (
          <TextField
            {...field}
            label="Answer"
            fullWidth
            multiline
            rows={6}
            error={!!errors.answer}
            helperText={errors.answer?.message ?? 'Plain text. Line breaks are preserved.'}
          />
        )}
      />
      <Controller
        name="category"
        control={control}
        render={({ field }) => (
          <FormControl fullWidth error={!!errors.category}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
              Category
            </Typography>
            <FaqCategorySelect
              inputId="faq-category"
              value={field.value ?? ''}
              onChange={field.onChange}
              options={['General', ...categories]}
            />
            {errors.category?.message && <FormHelperText>{errors.category.message}</FormHelperText>}
          </FormControl>
        )}
      />

      <Controller
        name="audience"
        control={control}
        render={({ field }) => {
          const value: FaqAudienceEnum[] = field.value ?? [];
          return (
            <FormControl fullWidth error={!!errors.audience}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
                Visibility
              </Typography>
              <Select
                multiple
                value={value}
                onChange={(e) => {
                  const raw = e.target.value;
                  const next = (
                    typeof raw === 'string' ? raw.split(',') : raw
                  ) as FaqAudienceEnum[];
                  const wasPublic = value.includes(FaqAudienceEnum.PUBLIC);
                  const hasPublic = next.includes(FaqAudienceEnum.PUBLIC);
                  let normalized: FaqAudienceEnum[];
                  if (hasPublic && !wasPublic) {
                    normalized = [FaqAudienceEnum.PUBLIC];
                  } else if (hasPublic && next.length > 1) {
                    normalized = next.filter((v) => v !== FaqAudienceEnum.PUBLIC);
                  } else {
                    normalized = next;
                  }
                  field.onChange(normalized);
                }}
                renderValue={(selected) =>
                  (selected as FaqAudienceEnum[])
                    .map((s) => audienceLabelLookup[s] ?? s)
                    .join(', ') || 'Select audience'
                }
                displayEmpty
              >
                {FAQ_AUDIENCE_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    <Checkbox checked={value.includes(opt.value)} />
                    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <ListItemText primary={opt.label} sx={{ my: 0 }} />
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ whiteSpace: 'normal' }}
                      >
                        {opt.description}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>
                {errors.audience?.message ??
                  'Pick one or more roles. Include “Public” to show this FAQ to everyone, including guests.'}
              </FormHelperText>
            </FormControl>
          );
        }}
      />

      <Controller
        name="isPublished"
        control={control}
        render={({ field }) => (
          <FormControlLabel
            control={
              <Switch checked={!!field.value} onChange={(e) => field.onChange(e.target.checked)} />
            }
            label="Published"
          />
        )}
      />
    </form>
  );
}
