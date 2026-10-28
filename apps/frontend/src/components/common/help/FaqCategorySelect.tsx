'use client';

import { useTheme } from '@mui/material';
import CreatableSelect from 'react-select/creatable';
import type { StylesConfig } from 'react-select';

interface FaqCategoryOption {
  value: string;
  label: string;
}

interface FaqCategorySelectProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  inputId?: string;
}

export default function FaqCategorySelect({
  value,
  onChange,
  options,
  placeholder = 'Select or create a category',
  inputId,
}: FaqCategorySelectProps) {
  const theme = useTheme();

  const selectOptions: FaqCategoryOption[] = Array.from(new Set(options)).map((c) => ({
    value: c,
    label: c,
  }));

  const selected: FaqCategoryOption | null = value ? { value, label: value } : null;

  const styles: StylesConfig<FaqCategoryOption, false> = {
    control: (base, state) => ({
      ...base,
      minHeight: 56,
      borderRadius: theme.shape.borderRadius,
      borderColor: state.isFocused ? theme.palette.primary.main : theme.palette.divider,
      boxShadow: state.isFocused ? `0 0 0 1px ${theme.palette.primary.main}` : 'none',
      backgroundColor: theme.palette.background.paper,
      '&:hover': {
        borderColor: theme.palette.primary.main,
      },
    }),
    menu: (base) => ({
      ...base,
      backgroundColor: theme.palette.background.paper,
      zIndex: theme.zIndex.modal + 1,
    }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isSelected
        ? theme.palette.primary.main
        : state.isFocused
          ? theme.palette.action.hover
          : 'transparent',
      color: state.isSelected ? theme.palette.primary.contrastText : theme.palette.text.primary,
      cursor: 'pointer',
    }),
    singleValue: (base) => ({ ...base, color: theme.palette.text.primary }),
    input: (base) => ({ ...base, color: theme.palette.text.primary }),
    placeholder: (base) => ({ ...base, color: theme.palette.text.secondary }),
  };

  return (
    <CreatableSelect<FaqCategoryOption>
      inputId={inputId}
      isClearable
      options={selectOptions}
      value={selected}
      placeholder={placeholder}
      formatCreateLabel={(input) => `Create "${input}"`}
      onChange={(option) => onChange(option?.value ?? '')}
      onCreateOption={(input) => onChange(input.trim())}
      styles={styles}
    />
  );
}
